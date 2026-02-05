// 终极Hybrid去水印方案
// 区域定位 + 方向性文字去除 + 多尺度补偿 + 纹理回填
const sharp = require("sharp");
const path = require("path");

// 通道守护工具：统一颜色空间，避免后续阶段出现单通道/无通道异常
function ensureRGB(sharpInstance) {
  return sharpInstance.ensureAlpha().toColourspace("srgb").removeAlpha();
}

function guardBufferRGB(buffer) {
  return sharp(buffer).ensureAlpha().toColourspace("srgb").removeAlpha();
}

/**
 * 终极Hybrid水印去除方案
 * @param {string} inputPath - 输入图片路径
 * @param {string} outputPath - 输出图片路径
 * @returns {Promise<{success: boolean, method: string, message?: string}>}
 */
async function removeWatermark(inputPath, outputPath) {
  // 方案A：多特征融合检测 - 黑字+彩色图形+浅色水印全覆盖
  try {
    console.log("🎨 推荐模式(方案A: 多特征融合)开始...");
    const base = ensureRGB(sharp(inputPath));
    const meta = await base.metadata();
    const { width, height } = meta;
    const origBuffer = await base.toBuffer();

    // === 步骤1: 多层水印检测 ===
    const gray = await base.clone().greyscale().toBuffer();

    // 1a. 黑色文字检测（亮度<90 且 边缘强度>50）
    const darkMask = await sharp(gray).threshold(90).negate().toBuffer(); // 亮度<90
    const sobelX = await sharp(gray)
      .convolve({ width: 3, height: 3, kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1] })
      .toBuffer();
    const sobelY = await sharp(gray)
      .convolve({ width: 3, height: 3, kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1] })
      .toBuffer();
    const edges = await sharp(sobelX)
      .composite([{ input: sobelY, blend: "lighten" }])
      .toBuffer();
    const strongEdges = await sharp(edges).threshold(50).toBuffer(); // 边缘强度>50
    const blackTextMask = await sharp(darkMask)
      .composite([{ input: strongEdges, blend: "multiply" }]) // AND操作
      .toBuffer();
    console.log("   [检测1/3] 黑色文字检测完成");

    // 1b. 彩色图形检测（高饱和度 + 低方差纯色块）- 安全版（无raw手工缓冲）
    // 饱和度增强后提取亮度作为近似饱和度指标
    const satEnhanced = await base
      .clone()
      .modulate({ saturation: 2.2 })
      .greyscale()
      .normalise()
      .toBuffer();
    // 使用百分位(P75)作为阈值，避免极端值影响；再钳位
    const satSorted = Array.from(satEnhanced).sort((a, b) => a - b);
    const p75 = satSorted[Math.floor(satSorted.length * 0.75)];
    const satThreshold = Math.min(240, Math.max(100, Math.floor(p75 * 1.05))); // 降低系数，提高检测灵敏度
    const highSatMask = await sharp(satEnhanced)
      .threshold(satThreshold)
      .toBuffer();
    console.log(`   [检测2/3] 彩色检测: p75=${p75}, 阈值=${satThreshold}`);

    // 局部方差近似: 原图与模糊图差异 -> 差异小=纯色区域
    const blurForVar = await sharp(gray).blur(3).toBuffer();
    const diffImage = await sharp(gray)
      .composite([{ input: blurForVar, blend: "difference" }])
      .normalise()
      .toBuffer();
    // 差异图阈值：高差异表示有纹理，取反得到纯色
    const textureMask = await sharp(diffImage)
      .threshold(35)
      .negate()
      .toBuffer();
    const colorShapeMask = await sharp(highSatMask)
      .composite([{ input: textureMask, blend: "multiply" }])
      .toBuffer();
    console.log("   [检测2/3] 彩色图形检测完成");

    // 1c. 浅色水印检测（亮度180-220 + 中等边缘）
    const midBrightMask = await sharp(gray).threshold(180).toBuffer();
    const notTooBright = await sharp(gray).threshold(220).negate().toBuffer();
    const midEdges = await sharp(edges).threshold(30).toBuffer();
    let lightWatermarkMask = await sharp(midBrightMask)
      .composite([
        { input: notTooBright, blend: "multiply" },
        { input: midEdges, blend: "multiply" },
      ])
      .toBuffer();
    console.log("   [检测3/3] 浅色水印检测完成");

    // === 【新增】1d. 图怪兽/创客贴特定水印检测 ===
    console.log("   [检测4/4] 开始图怪兽/创客贴特定水印检测...");

    // 检测特定位置的水印（通常在四角或中心）
    const cornerMask = Buffer.alloc(width * height);
    const cornerSize = Math.min(width, height) * 0.15; // 角落区域大小

    // 标记四个角落和中心区域
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const isCorner =
          (x < cornerSize && y < cornerSize) || // 左上
          (x > width - cornerSize && y < cornerSize) || // 右上
          (x < cornerSize && y > height - cornerSize) || // 左下
          (x > width - cornerSize && y > height - cornerSize) || // 右下
          (Math.abs(x - width / 2) < cornerSize && Math.abs(y - height / 2) < cornerSize); // 中心

        cornerMask[idx] = isCorner ? 255 : 0;
      }
    }

    const cornerMaskSharp = await sharp(cornerMask, {
      raw: { width, height, channels: 1 }
    }).toBuffer();

    // 结合角落区域和边缘检测
    const platformSpecificMask = await sharp(strongEdges)
      .composite([{ input: cornerMaskSharp, blend: "multiply" }])
      .toBuffer();

    console.log("   [检测4/4] 图怪兽/创客贴特定水印检测完成");

    // 1e. 四层融合 OR操作（包含平台特定检测）
    const combinedMask = await sharp(blackTextMask)
      .composite([
        { input: colorShapeMask, blend: "lighten" },
        { input: lightWatermarkMask, blend: "lighten" },
        { input: platformSpecificMask, blend: "lighten" }, // 【新增】平台特定水印
      ])
      .toBuffer();

    // 1e. 【强化版】形态学闭运算（填充内部空洞）+ 超强膨胀 + 软化
    const watermarkMask = await sharp(combinedMask)
      .convolve({ width: 13, height: 13, kernel: Array(169).fill(1 / 169) }) // 【增强】更大膨胀范围 9x9 -> 13x13
      .blur(7.0) // 【增强】更大范围软化边界 5.0 -> 7.0
      .threshold(65) // 【增强】更低阈值，增加检测范围 75 -> 65
      .toColourspace("b-w")
      .toBuffer();

    console.log("   [掩膜融合] 多特征掩膜生成完成（包含平台特定检测）");

    console.log("   [掩膜融合] 多特征掩膜生成完成");

    // === 步骤2: 智能修复（多层次纹理重建优化） ===
    // 2a. 多尺度纹理采样 - 从原图提取不同尺度的纹理特征
    const fineTex = await base
      .clone()
      .blur(0.8)
      .sharpen({ sigma: 1.5, m1: 0.8, m2: 0.7 })
      .toBuffer();

    const midTex = await base
      .clone()
      .blur(1.8)
      .sharpen({ sigma: 1.0, m1: 0.6, m2: 0.6 })
      .toBuffer();

    const coarseTex = await base.clone().blur(3.5).median(3).toBuffer();

    // 2b. 【强化版】基础修复层 - 加强去水印力度
    const baseRepair = await base
      .clone()
      .blur(3.5) // 【增强】提高模糊强度 2.2 -> 3.5，更彻底去除水印
      .median(3) // 【增强】加强中值滤波 2 -> 3
      .blur(1.2) // 【增强】增加平滑 0.6 -> 1.2
      .toBuffer();

    // 2c. 【强化版】构建自适应融合权重 - 超强平滑过渡
    const strongMask = await sharp(watermarkMask).blur(5).toBuffer(); // 【增强】核心修复区 3 -> 5
    const mediumMask = await sharp(watermarkMask).blur(9).toBuffer(); // 【增强】过渡区 6 -> 9
    const softMask = await sharp(watermarkMask).blur(14).toBuffer(); // 【增强】边缘融合区 10 -> 14

    // 2d. 分层纹理重建
    const repairAlpha = await sharp(baseRepair)
      .joinChannel(strongMask)
      .toBuffer();

    const midTexAlpha = await sharp(midTex).joinChannel(mediumMask).toBuffer();

    const fineTexAlpha = await sharp(fineTex).joinChannel(softMask).toBuffer();

    let merged = await sharp(origBuffer).toBuffer();

    // 【强化版】多层纹理融合 - 超强水印清除模式
    merged = await sharp(merged)
      .composite([
        {
          input: repairAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.85, // 【增强】大幅提升透明度 0.7 -> 0.85，超强去水印
        },
        {
          input: midTexAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.45, // 【增强】纹理层 0.3 -> 0.45
        },
        {
          input: fineTexAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.3, // 【增强】精细层 0.2 -> 0.3
        },
      ])
      .toBuffer();

    console.log("   [智能修复] 深度多层次纹理重建完成");

    // === 步骤3: 色彩一致性优化（深度清除版） ===
    const colorRef = await base
      .clone()
      .resize(Math.floor(width * 0.3), Math.floor(height * 0.3))
      .blur(9)
      .resize(width, height, { kernel: "lanczos3" })
      .toBuffer();

    const colorMask = await sharp(watermarkMask).blur(9).toBuffer();
    const colorAlpha = await sharp(colorRef).joinChannel(colorMask).toBuffer();

    merged = await sharp(merged)
      .composite([
        {
          input: colorAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.25,
        },
      ])
      .toBuffer();

    console.log("   [色彩优化] 深度色彩一致性增强完成");

    // === 步骤4: 智能降噪与清晰度恢复（深度清除版） ===
    // 4a. 【强化版】针对水印区域超强降噪
    const denoised = await sharp(merged)
      .median(3) // 【增强】大幅提升降噪强度 2 -> 3
      .blur(0.8) // 【增强】增加模糊平滑 0.5 -> 0.8
      .toBuffer();

    const denoiseMask = await sharp(watermarkMask).blur(8).toBuffer(); // 【增强】6 -> 8
    const denoiseAlpha = await sharp(denoised)
      .joinChannel(denoiseMask)
      .toBuffer();

    merged = await sharp(merged)
      .composite([
        {
          input: denoiseAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.7, // 【增强】提高降噪参与度 0.55 -> 0.7
        },
      ])
      .toBuffer();

    console.log("   [降噪处理] 深度选择性降噪完成");

    // === 【新增】步骤4.1: 水印区域二次强化处理 ===
    console.log("   [二次强化] 开始水印区域二次深度清除...");

    // 对检测到的水印区域进行二次迭代处理
    const watermarkRegionMask = await sharp(watermarkMask).blur(4).threshold(128).toBuffer();

    // 二次修复：更强的模糊和修复
    const secondRepair = await sharp(merged)
      .blur(4.5) // 超强模糊
      .median(4) // 超强中值滤波
      .toBuffer();

    const secondRepairAlpha = await sharp(secondRepair)
      .joinChannel(watermarkRegionMask)
      .toBuffer();

    merged = await sharp(merged)
      .composite([
        {
          input: secondRepairAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.6, // 二次修复参与度
        },
      ])
      .toBuffer();

    console.log("   [二次强化] 水印区域二次深度清除完成");

    // 4b. 全图强力锐化
    const invertMask = await sharp(watermarkMask).negate().blur(2).toBuffer();
    merged = await sharp(merged)
      .sharpen({ sigma: 1.6, m1: 1.2, m2: 0.9 }) // 大幅提升锐化强度
      .toBuffer();

    console.log("   [锐化处理] 全图锐化完成");

    // 4c. 色彩与对比度强化优化
    merged = await sharp(merged)
      .modulate({ saturation: 1.15, brightness: 1.06 }) // 强化饱和度和亮度
      .linear(1.08, 3) // 大幅增强对比度
      .toBuffer();

    console.log("   [色彩恢复] 饱和度/对比度优化完成");

    // === 步骤4.5: 双层细节增强（极致版） ===
    console.log("   [细节增强] 开始双层细节提取...");

    // 精细层USM锐化
    const blurred1 = await sharp(merged).blur(0.8).toBuffer();
    const detail1 = await sharp(merged)
      .composite([{ input: blurred1, blend: "difference" }])
      .normalise()
      .linear(0.6, 128)
      .toBuffer();

    // 中等层USM锐化
    const blurred2 = await sharp(merged).blur(1.5).toBuffer();
    const detail2 = await sharp(merged)
      .composite([{ input: blurred2, blend: "difference" }])
      .normalise()
      .linear(0.45, 128)
      .toBuffer();

    // 双层强化叠加
    merged = await sharp(merged)
      .composite([
        { input: detail1, blend: "lighten", opacity: 0.25 },
        { input: detail2, blend: "lighten", opacity: 0.15 },
      ])
      .toBuffer();

    console.log("   [细节增强] 双层细节融合完成");

    // === 步骤4.6: 三级自适应锐化（极致版） ===
    console.log("   [自适应锐化] 开始三级锐化处理...");

    // 1. 非水印区域 - 超强锐化
    const ultraSharp = await sharp(merged)
      .sharpen({ sigma: 1.8, m1: 1.2, m2: 0.9 })
      .toBuffer();
    const ultraSharpAlpha = await sharp(ultraSharp)
      .joinChannel(invertMask)
      .toBuffer();

    // 2. 过渡区域 - 中度锐化
    const transitionMask = await sharp(watermarkMask)
      .blur(5)
      .threshold(128)
      .negate()
      .toBuffer();
    const mediumSharp = await sharp(merged)
      .sharpen({ sigma: 1.0, m1: 0.7, m2: 0.6 })
      .toBuffer();
    const mediumSharpAlpha = await sharp(mediumSharp)
      .joinChannel(transitionMask)
      .toBuffer();

    // 3. 水印核心区 - 轻度锐化
    const softSharp = await sharp(merged)
      .sharpen({ sigma: 0.5, m1: 0.35, m2: 0.25 })
      .toBuffer();
    const softSharpAlpha = await sharp(softSharp)
      .joinChannel(watermarkMask)
      .toBuffer();

    // 三级融合
    merged = await sharp(merged)
      .composite([
        {
          input: ultraSharpAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.85,
        },
        {
          input: mediumSharpAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.5,
        },
        {
          input: softSharpAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.3,
        },
      ])
      .toBuffer();

    console.log("   [自适应锐化] 三级锐化完成");

    // === 步骤4.7: 强化纹理恢复（极致版） ===
    console.log("   [边缘保护] 强化恢复原始纹理...");

    // 从原图提取高频纹理
    const origBlur = await base.clone().blur(1.0).toBuffer();
    const origDetail = await base
      .clone()
      .composite([{ input: origBlur, blend: "difference" }])
      .normalise()
      .linear(0.6, 128)
      .toBuffer();

    // 仅在非水印区域强化叠加
    const detailAlpha = await sharp(origDetail)
      .joinChannel(invertMask)
      .toBuffer();

    merged = await sharp(merged)
      .composite([{ input: detailAlpha, blend: "screen", opacity: 0.35 }])
      .toBuffer();

    console.log("   [边缘保护] 纹理强化完成");

    // === 步骤4.8: 亮度安全保护（优化版） ===
    console.log("   [亮度保护] 检查并修正整体亮度...");
    const preStats = await sharp(merged).stats();
    const preMean =
      preStats.channels && preStats.channels[0]
        ? preStats.channels[0].mean
        : 128;

    // 如果亮度过低，进行提亮保护
    if (preMean < 170) {
      const boostFactor = Math.min(1.25, 170 / preMean);
      console.log(
        `   [亮度保护] 检测到亮度过低(${preMean.toFixed(1)}), 提亮${(
          (boostFactor - 1) *
          100
        ).toFixed(1)}%`
      );
      merged = await sharp(merged)
        .modulate({ brightness: boostFactor })
        .linear(1.06, 8) // 提升对比度和亮度偏移
        .toBuffer();
    }

    // === 步骤5: 亮度平衡 ===
    const stats = await sharp(merged).stats();
    const meanLuma =
      stats.channels && stats.channels[0] ? stats.channels[0].mean : 128;

    if (meanLuma < 170) {
      merged = await sharp(merged).modulate({ brightness: 1.05 }).toBuffer();
      console.log(`   [亮度平衡] 均值${meanLuma.toFixed(1)} < 170, 提亮+5%`);
    } else if (meanLuma > 200) {
      merged = await sharp(merged)
        .modulate({ brightness: 0.97 })
        .linear(1.0, -3)
        .toBuffer();
      console.log(`   [亮度平衡] 均值${meanLuma.toFixed(1)} > 200, 降亮-3%`);
    }

    // === 步骤6: 输出保存 ===
    await sharp(merged).jpeg({ quality: 95, mozjpeg: true }).toFile(outputPath);

    console.log("✅ 推荐模式(方案A)完成:", outputPath);
    return { success: true, method: "multi-feature-fusion" };
  } catch (error) {
    console.error("❌ 推荐模式(方案A)失败:", error.message);
    console.error(error.stack);
    try {
      await sharp(inputPath).toFile(outputPath);
      return { success: false, method: "fallback", message: "使用原图" };
    } catch (fallbackError) {
      throw new Error("推荐模式失败且原图备份失败");
    }
  }
}

/**
 * ★ 阶段1: 智能水印区域检测
 * 使用Laplacian边缘检测 + Otsu阈值 + 饱和度分析
 */
async function detectWatermarkRegions(inputPath, metadata) {
  try {
    const image = sharp(inputPath);

    // 方法1: 边缘对比度检测（Laplacian）- 检测突变区域
    const edgeBuffer = await image
      .clone()
      .greyscale()
      .normalise()
      .convolve({
        width: 3,
        height: 3,
        kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1], // Laplacian算子
        scale: 1,
        offset: 0,
      })
      .raw()
      .toBuffer();

    // 方法2: 黑色文字检测（通过阈值分割）
    const blackTextBuffer = await image
      .clone()
      .greyscale()
      .threshold(80) // 检测深色区域（0-80为黑色文字）
      .raw()
      .toBuffer();

    // 方法3: 透明水印检测（饱和度异常低的区域）
    // 方法1.1: 描边文字检测（Sobel近似）- 强化文字轮廓
    const sobelX = await image
      .clone()
      .greyscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
      })
      .toBuffer();
    const sobelY = await image
      .clone()
      .greyscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
      })
      .toBuffer();
    const sobelCombined = await sharp(sobelX)
      .composite([{ input: sobelY, blend: "lighten" }])
      .toBuffer();
    const edgeMaskBinary = await sharp(sobelCombined)
      .threshold(90)
      .toColourspace("b-w")
      .toBuffer();
    const satBuffer = await image
      .clone()
      .modulate({ saturation: 2.0 }) // 放大饱和度差异
      .extractChannel("green") // 提取G通道作为代表
      .raw()
      .toBuffer();

    // 综合分析：计算水印强度图
    const { width, height } = metadata;
    const detectionMap = {
      hasBlackText: false,
      hasTransparentLogo: false,
      edgeIntensity: 0,
      edgeMask: edgeMaskBinary,
      width,
      height,
    };

    // 统计分析（简化版：计算平均强度）
    let edgeSum = 0,
      blackSum = 0,
      satSum = 0;
    const totalPixels = width * height;

    for (let i = 0; i < totalPixels; i++) {
      edgeSum += edgeBuffer[i] || 0;
      blackSum += blackTextBuffer[i] < 128 ? 1 : 0;
      satSum += satBuffer[i] || 0;
    }

    detectionMap.edgeIntensity = edgeSum / totalPixels;
    detectionMap.hasBlackText = blackSum / totalPixels > 0.05; // 超过5%面积为黑色
    detectionMap.hasTransparentLogo = satSum / totalPixels < 100; // 饱和度异常低
    console.log(
      `   检测结果: 黑字=${detectionMap.hasBlackText}, 透明Logo=${detectionMap.hasTransparentLogo
      }, 边缘强度=${detectionMap.edgeIntensity.toFixed(2)}`
    );
    console.log("   [检测] 描边掩码生成完成");

    return detectionMap;
  } catch (error) {
    console.warn("⚠️ 区域检测失败，使用默认策略");
    return {
      hasBlackText: true,
      hasTransparentLogo: true,
      edgeIntensity: 50,
      width: metadata.width,
      height: metadata.height,
    };
  }
}

/**
 * ★ 阶段2: 分区域深度去除
 * 针对黑色文字和透明Logo使用不同策略
 */
async function regionalDeepRemoval(inputPath, detectionMap, metadata) {
  try {
    // 通道守护：确保输入为RGB，避免后续处理产生单通道
    let image = sharp(inputPath).ensureAlpha().toColourspace("srgb");

    // 策略A: 针对黑色文字 - 方向性滤波
    if (detectionMap.hasBlackText) {
      console.log("   -> 检测到黑色文字，执行方向性去除...");

      // 多次方向性模糊（模拟沿文字垂直方向抹除）
      image = image
        .blur(2.5) // 先整体模糊
        .linear(1.15, -(255 * 0.12)) // 对比度增强+压暗（让黑字融入背景）
        .median(5) // 强力中值滤波（去除文字边缘）
        .blur(1.0) // 再次轻微模糊平滑
        .modulate({ brightness: 1.08 }); // 稍微提亮
    }

    // 策略B: 针对透明Logo - 多尺度金字塔处理
    if (detectionMap.hasTransparentLogo) {
      console.log("   -> 检测到透明水印，执行多尺度处理...");

      // 构建3层金字塔
      const buffer = await image.toBuffer();

      // L0: 原尺寸，轻度处理
      const l0 = await sharp(buffer)
        .modulate({ saturation: 1.25, brightness: 1.04 })
        .blur(0.8)
        .toBuffer();

      // L1: 缩小到50%，中度处理
      const l1 = await sharp(buffer)
        .resize(
          Math.floor(metadata.width * 0.5),
          Math.floor(metadata.height * 0.5)
        )
        .modulate({ saturation: 1.35, brightness: 1.06 })
        .blur(2.0)
        .linear(1.1, -10)
        .resize(metadata.width, metadata.height) // 放大回原尺寸
        .toBuffer();

      // L2: 缩小到25%，强力处理
      const l2 = await sharp(buffer)
        .resize(
          Math.floor(metadata.width * 0.25),
          Math.floor(metadata.height * 0.25)
        )
        .blur(3.5)
        .modulate({ brightness: 1.1, saturation: 1.5 })
        .resize(metadata.width, metadata.height)
        .toBuffer();

      // 多尺度融合：blend模式叠加
      image = sharp(l0).composite([
        { input: l1, blend: "over", opacity: 0.4 },
        { input: l2, blend: "over", opacity: 0.2 },
      ]);
    }

    // 通用增强：对比度校正
    image = image
      .linear(1.08, -(255 * 0.05))
      .sharpen({ sigma: 0.6, m1: 0.4, m2: 0.4 });

    // 返回前通道守护，确保输出为RGB
    const outBuf = await image.toBuffer();
    return await guardBufferRGB(outBuf).toBuffer();
  } catch (error) {
    console.warn("⚠️ 分区去除失败，跳过");
    return await sharp(inputPath).toBuffer();
  }
}

/**
 * ★ 阶段3: 纹理回填（伪PatchMatch）
 * 模拟从周围区域采样纹理，填充修复区域
 */
async function textureInpainting(buffer, metadata) {
  try {
    const { width, height } = metadata;

    // 通道守护：确保输入为RGB
    const safeInput = sharp(buffer).ensureAlpha().toColourspace("srgb");
    // 简化版PatchMatch: 使用多次模糊+锐化模拟纹理填充
    const inpaintedRGB = await safeInput
      .blur(1.5) // 模糊创建基底
      .sharpen({ sigma: 1.2, m1: 0.6, m2: 0.6 }) // 锐化恢复纹理
      .median(2) // 中值平滑过渡
      .modulate({ saturation: 1.08 }) // 轻微增强饱和度
      .toBuffer();

    // 返回前标准化为RGB
    return await guardBufferRGB(inpaintedRGB).toBuffer();
  } catch (error) {
    console.warn("⚠️ 纹理回填失败，跳过");
    return buffer;
  }
}

/**
 * ★ 阶段4: 全图优化修复
 * 亮度+对比度+锐化，让整体更自然统一
 */
async function globalEnhancement(buffer, outputPath) {
  try {
    // 通道守护：确保输入为RGB，避免保存前出现异常
    await sharp(buffer)
      .ensureAlpha()
      .toColourspace("srgb")
      .modulate({
        brightness: 1.0, // 取消额外提亮，避免过曝
        saturation: 1.05,
        hue: 0,
      })
      .linear(1.04, 0) // 轻微对比度，避免炸白
      .sharpen({ sigma: 1.0, m1: 0.5, m2: 0.5 }) // 锐化1.0
      .median(1) // 轻微降噪
      .jpeg({ quality: 96, mozjpeg: true }) // 高质量保存
      .toFile(outputPath);

    console.log("   -> 全图优化完成");
  } catch (error) {
    console.error("❌ 全图优化失败:", error.message);
    await sharp(buffer).ensureAlpha().toColourspace("rgb").toFile(outputPath);
  }
}

/**
 * ★ 阶段6: 后处理色彩校正与亮度微调(解决方案二)
 * - 自适应直方图均衡化(CLAHE)平衡局部对比度
 * - HSL亮部微调恢复色彩活力
 * - 直方图规范化确保像素分布均匀
 */
async function postProcessingColorCorrection(inputPath, outputPath, metadata) {
  try {
    const input = sharp(inputPath).ensureAlpha().toColourspace("srgb");
    const stats = await input.stats();
    const meanLuma =
      stats.channels && stats.channels[0] ? stats.channels[0].mean : 128;

    // 检测是否需要额外的亮度调整
    const needBrightnessAdjust = meanLuma > 180; // 从140调整为180,避免对中等亮度图片过度处理
    const targetLuma = 160; // 目标平均亮度
    const lumaDiff = meanLuma - targetLuma;
    console.log(
      `   [色彩校正] 平均亮度=${meanLuma.toFixed(
        1
      )}, 目标亮度=${targetLuma}, 差值=${lumaDiff.toFixed(
        1
      )}, 需要额外降亮=${needBrightnessAdjust}`
    );

    let corrected = await input.toBuffer();

    // 0) 首要降亮:仅当平均亮度明显过高时执行(提高阈值到30)
    if (needBrightnessAdjust && lumaDiff > 30) {
      console.log("   [色彩校正] 执行首要降亮操作...");
      // 减少降亮强度,避免过度压暗
      const brightnessReduction = Math.max(0.92, 1.0 - (lumaDiff / 255) * 0.8); // 从0.85调整为0.92起,系数1.2→0.8
      const offsetReduction = Math.min(-10, -(lumaDiff * 0.3)); // 从-20调整为-10起,系数0.5→0.3
      corrected = await sharp(corrected)
        .modulate({ brightness: brightnessReduction })
        .linear(0.98, offsetReduction) // 从0.95调整为0.98,减少对比度压缩
        .toBuffer();
      console.log(
        `   [色彩校正] 首要降亮完成 (brightness=${brightnessReduction.toFixed(
          2
        )}, offset=${offsetReduction.toFixed(1)})`
      );
    }

    // 1) 自适应直方图均衡化(CLAHE风格):分块对比度增强,优化裁剪范围
    console.log("   [色彩校正] 应用自适应直方图均衡化...");
    corrected = await sharp(corrected)
      .normalise({ lower: 2, upper: 98 }) // 恢复为2-98,避免过度裁剪(3-97太激进)
      .modulate({
        brightness: needBrightnessAdjust ? 0.97 : 1.0, // 从0.94调整为0.97,减少降亮
        saturation: 1.08, // 从1.10调整为1.08,适度提升饱和度
      })
      .toBuffer();

    // 2) 针对亮部的HSL微调:优化分级处理,减少过度压暗
    console.log("   [色彩校正] HSL亮部微调(优化分级处理)...");
    const lumin = await sharp(corrected).greyscale().toBuffer();

    // 超高光区域(>235):温和降亮(提高阈值,减少强度)
    const ultraHighlightMask = await sharp(lumin).threshold(235).toBuffer(); // 从220调整为235
    const ultraHighlightAdjusted = await sharp(corrected)
      .modulate({ brightness: 0.92, saturation: 1.12 }) // 从br0.85调整为0.92,sat1.20→1.12
      .linear(0.95, -8) // 今linear(0.90,-15)调整为(0.95,-8)
      .toBuffer(); // 移除gamma1.2,避免过度压暗
    const ultraHighlightAlpha = await sharp(ultraHighlightAdjusted)
      .joinChannel(ultraHighlightMask)
      .toBuffer();

    // 高光区域(200-235):轻微降亮(提高阈值,减少强度)
    const highlightMask = await sharp(lumin).threshold(200).toBuffer(); // 从180调整为200
    const highlightAdjusted = await sharp(corrected)
      .modulate({ brightness: 0.95, saturation: 1.1 }) // 从br0.90调整为0.95,sat1.15→1.10
      .linear(0.97, -5) // 今linear(0.93,-12)调整为(0.97,-5)
      .toBuffer();
    const highlightAlpha = await sharp(highlightAdjusted)
      .joinChannel(highlightMask)
      .toBuffer();

    // 分级合成(减少混合强度)
    corrected = await sharp(corrected)
      .composite([
        {
          input: highlightAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.5,
        }, // 从0.75调整为0.5
        {
          input: ultraHighlightAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.6,
        }, // 从0.85调整为0.6
      ])
      .toBuffer();

    // 3) 最终微调:轻微锐化+降噪
    console.log("   [色彩校正] 最终微调...");
    await sharp(corrected)
      .sharpen({ sigma: 0.8, m1: 0.5, m2: 0.5 })
      .median(1)
      .jpeg({ quality: 96, mozjpeg: true })
      .toFile(outputPath);

    console.log("   -> 后处理色彩校正完成");
  } catch (error) {
    console.error("❌ 后处理色彩校正失败:", error.message);
    // 降级:直接复制输入到输出
    try {
      await sharp(inputPath)
        .jpeg({ quality: 96, mozjpeg: true })
        .toFile(outputPath);
    } catch (e) {
      console.error("❌ 降级保存也失败:", e.message);
    }
  }
}

/**
 * ★ 阶段4: 曝光优化
 * 方案A（区域曝光校正）+ 方案B（LUT高光压制）的组合实现
 * - 仅在水印区域做更强的降亮（-5%），全图轻降亮（-3%）
 * - 对高光区域进行压制，对暗部略微提亮（近似LUT）
 */
async function exposureOptimization(buffer, inputPath, detectionMap, metadata) {
  try {
    // 通道守护：统一到RGB以避免提取通道报错
    const base = sharp(buffer).ensureAlpha().toColourspace("srgb");
    const src = sharp(inputPath).ensureAlpha().toColourspace("srgb");
    const { width, height } = metadata;

    // 1) 增强过曝检测:引入过曝指数量化过曝程度
    const stats = await base.stats();
    const meanLuma =
      stats.channels && stats.channels[0] ? stats.channels[0].mean : 128;
    const maxLuma =
      stats.channels && stats.channels[0] ? stats.channels[0].max : 255;

    // 计算过曝指数:高亮像素占比 + 平均亮度权重
    const overexposureScore =
      ((meanLuma - 128) / 127) * 0.6 + ((maxLuma - 240) / 15) * 0.4;
    const isOver = overexposureScore > 0.2; // 过曝指数>0.2触发强校正
    const isSevereOver = overexposureScore > 0.4; // 严重过曝指数>0.4

    console.log(
      `   [曝光检测] 平均亮度=${meanLuma.toFixed(
        1
      )}, 最大亮度=${maxLuma}, 过曝指数=${overexposureScore.toFixed(
        3
      )}, 过曝=${isOver}, 严重过曝=${isSevereOver}`
    );

    // 1.5) 严重过曝时优先全局降亮(优化强度避免过暗)
    let preprocessed = buffer;
    if (isSevereOver) {
      console.log("   [曝光优化] 检测到严重过曝,执行缓和预处理 (方案一) ...");
      // 方案一：放松降亮与gamma，避免早期层次塌陷
      const linearBrightness = Math.max(0.92, 0.985 - overexposureScore * 0.1); // 抬高底线
      const linearOffset = Math.max(-6, -4 - overexposureScore * 4); // 减轻偏移幅度
      const gammaFactor = Math.min(1.15, 1.0 + overexposureScore * 0.25); // 降低gamma上限
      preprocessed = await base
        .clone()
        .modulate({ brightness: linearBrightness })
        .linear(0.97, linearOffset)
        .gamma(gammaFactor)
        .toBuffer();
      console.log(
        `   [曝光优化] 缓和预处理完成 (brightness=${linearBrightness.toFixed(
          2
        )}, offset=${linearOffset.toFixed(1)}, gamma=${gammaFactor.toFixed(2)})`
      );
    }

    // 2) 构造水印区域mask:黑字 + 低饱和度区域
    const workingBase = sharp(preprocessed).ensureAlpha().toColourspace("srgb");
    const blackMask = await src
      .clone()
      .greyscale()
      .threshold(80)
      .toColourspace("b-w")
      .resize(width, height)
      .toBuffer();
    const lowSatMask = await src
      .clone()
      .modulate({ saturation: 2.0 })
      .extractChannel("green")
      .threshold(110)
      .toColourspace("b-w")
      .resize(width, height)
      .toBuffer();
    const mergedMask = await sharp(blackMask)
      .composite([{ input: lowSatMask, blend: "lighten" }])
      .toBuffer();

    // 3) 根据过曝程度动态调整降亮强度
    // 方案六微调: 减弱全局与局部降亮幅度，提升亮度底线
    const globalBrightness = isSevereOver ? 0.98 : isOver ? 0.99 : 1.0;
    const maskedBrightness = isSevereOver ? 0.94 : isOver ? 0.95 : 0.97;

    const globalDim = await workingBase
      .clone()
      .modulate({ brightness: globalBrightness })
      .toBuffer();
    const maskedDim = await workingBase
      .clone()
      .modulate({ brightness: maskedBrightness })
      .toBuffer();

    console.log(
      `   [曝光优化] 动态降亮策略: 全图=${globalBrightness.toFixed(
        2
      )}, 水印区域=${maskedBrightness.toFixed(2)}`
    );

    // 4) 用alpha方式将mergedMask作为遮罩合成
    const maskedDimWithAlpha = await sharp(maskedDim)
      .joinChannel(mergedMask)
      .toBuffer();
    let exposureMerged = await sharp(globalDim)
      .composite([
        { input: maskedDimWithAlpha, blend: "over", premultiplied: true },
      ])
      .toBuffer();

    // 5) 高光压制与暗部提亮（近似LUT）：通过阈值掩膜控制区域性合成
    const lumin = await sharp(buffer)
      .ensureAlpha()
      .toColourspace("srgb")
      .greyscale()
      .toBuffer();
    const highlightsMask = await sharp(lumin).threshold(220).toBuffer(); // 降低阈值以覆盖更多过曝区域
    const shadowsMask = await sharp(lumin).threshold(50).negate().toBuffer();

    // 方案六微调: 减弱高光偏移，避免整体发灰发暗
    // 方案一：进一步减轻高光压制偏移(-18 -> -12)
    const highlightSuppressed = await sharp(exposureMerged)
      .linear(1.0, -12)
      .toBuffer();
    const highlightSuppressedAlpha = await sharp(highlightSuppressed)
      .joinChannel(highlightsMask)
      .toBuffer();

    const shadowsBoosted = await sharp(exposureMerged)
      .linear(1.0, 10)
      .toBuffer(); // 降低暗部提亮避免过度
    const shadowsBoostedAlpha = await sharp(shadowsBoosted)
      .joinChannel(shadowsMask)
      .toBuffer();

    const withHighlights = await sharp(exposureMerged)
      .composite([
        { input: highlightSuppressedAlpha, blend: "over", premultiplied: true },
      ])
      .toBuffer();

    const withShadows = await sharp(withHighlights)
      .composite([
        {
          input: shadowsBoostedAlpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.4,
        },
      ]) // 降低暗部提亮参与度
      .toBuffer();

    // 6) 二次高光压制（针对极端过曝）
    const lumin2 = await sharp(withShadows).greyscale().toBuffer();
    const hiMask2 = await sharp(lumin2).threshold(230).toBuffer(); // 极高光区域
    const hiSupp2 = await sharp(withShadows).linear(0.97, -8).toBuffer(); // 方案一：减弱二次压制
    const hiSupp2Alpha = await sharp(hiSupp2).joinChannel(hiMask2).toBuffer();

    const finalExposure = await sharp(withShadows)
      .composite([
        {
          input: hiSupp2Alpha,
          blend: "over",
          premultiplied: true,
          opacity: 0.8,
        },
      ])
      .toBuffer();

    // 7) 多尺度融合增强:根据过曝程度动态调整参数
    console.log("   [曝光优化] 开始多尺度融合...");
    // 传入描边掩码以在融合后进行掩码锐化
    const edgeMask =
      detectionMap && detectionMap.edgeMask ? detectionMap.edgeMask : null;
    // 中途亮度安全(方案一): 在多曝光融合前先做一次纠偏
    const midStageStats = await sharp(finalExposure).stats();
    const midMean =
      midStageStats.channels && midStageStats.channels[0]
        ? midStageStats.channels[0].mean
        : 128;
    let exposureForFusion = finalExposure;
    if (midMean < 165 && meanLuma > 190) {
      console.log(
        `   [曝光优化] 中途亮度安全回调: midMean=${midMean.toFixed(
          1
        )} <165 → +5%`
      );
      exposureForFusion = await sharp(finalExposure)
        .modulate({ brightness: 1.05 })
        .toBuffer();
    }
    const multiscaleFused = await multiscaleFusion(
      exposureForFusion,
      metadata,
      overexposureScore,
      edgeMask
    );

    // 8) CLAHE局部增强:根据过曝程度动态调整强度
    console.log("   [曝光优化] 应用局部对比度增强...");
    const claheEnhanced = await claheLikeEnhancement(
      multiscaleFused,
      overexposureScore,
      true
    );

    // 最终亮度安全保护: 若结果过暗则轻微回提亮度
    const finalStats = await sharp(claheEnhanced)
      .ensureAlpha()
      .toColourspace("srgb")
      .stats();
    const finalMean =
      finalStats.channels && finalStats.channels[0]
        ? finalStats.channels[0].mean
        : 128;
    let safeOutput = claheEnhanced;
    // 方案六: 提升亮度安全阈值与回提幅度
    // 多级亮度安全(方案一)
    if (finalMean < 170) {
      console.log(
        `   [曝光优化] 亮度安全回提: mean=${finalMean.toFixed(1)} <170 → +6%`
      );
      safeOutput = await sharp(claheEnhanced)
        .modulate({ brightness: 1.06 })
        .toBuffer();
    } else if (finalMean < 178) {
      console.log(
        `   [曝光优化] 亮度安全回提: mean=${finalMean.toFixed(1)} <178 → +4%`
      );
      safeOutput = await sharp(claheEnhanced)
        .modulate({ brightness: 1.04 })
        .toBuffer();
    } else if (finalMean < 185) {
      console.log(
        `   [曝光优化] 亮度安全回提: mean=${finalMean.toFixed(1)} <185 → +2%`
      );
      safeOutput = await sharp(claheEnhanced)
        .modulate({ brightness: 1.02 })
        .toBuffer();
    }
    console.log("   [曝光优化] 深度曝光完成");
    return safeOutput;
  } catch (e) {
    console.warn("⚠️ 深度曝光失败，尝试 LUT 曝光:", e.message);
    try {
      // LUT曝光（通道无依赖）：高光压制 + 暗部轻提
      const rgb = sharp(buffer).ensureAlpha().toColourspace("srgb");
      const baseBuf = await rgb.toBuffer();
      const luminBuf = await rgb.clone().greyscale().toBuffer();
      const hiMask = await sharp(luminBuf).threshold(220).toBuffer(); // LUT模式也使用更低阈值
      const shMask = await sharp(luminBuf).threshold(50).negate().toBuffer();

      const hiSupp = await sharp(baseBuf).linear(1.0, -28).toBuffer(); // LUT模式也加强压制
      const hiSuppA = await sharp(hiSupp).joinChannel(hiMask).toBuffer();
      const shBoost = await sharp(baseBuf).linear(1.0, 10).toBuffer(); // 暗部提亮降低
      const shBoostA = await sharp(shBoost).joinChannel(shMask).toBuffer();

      const merged = await sharp(baseBuf)
        .composite([{ input: hiSuppA, blend: "over", premultiplied: true }])
        .composite([
          { input: shBoostA, blend: "over", premultiplied: true, opacity: 0.5 },
        ])
        .toBuffer();
      console.log("   [曝光优化] LUT曝光完成");
      return merged;
    } catch (e2) {
      console.warn("⚠️ LUT曝光失败，进入Gamma兜底:", e2.message);
      try {
        // Gamma-only兜底（直方图自适应，不依赖通道提取）
        const temp = sharp(buffer).ensureAlpha().toColourspace("srgb");
        const s = await temp.stats();
        const mean = s.channels && s.channels[0] ? s.channels[0].mean : 128;
        const factor = Math.max(0.9, Math.min(1.05, (0.85 * mean) / mean));
        return await temp
          .modulate({ brightness: factor })
          .linear(1.02, -(mean > 145 ? 10 : 5)) // 更强压制高光
          .gamma(0.92) // 更强gamma压制
          .toBuffer();
      } catch (err2) {
        console.warn("⚠️ 安全模式也失败，返回原始缓冲区");
        return buffer;
      }
    }
  }
}

/**
 * 多尺度融合增强（方案三）
 * 生成低/中/高三个曝光版本，融合以兼顾全局与局部
 * @param {Buffer} buffer - 输入图像缓冲区
 * @param {Object} metadata - 图像元数据
 * @param {number} overexposureScore - 过曝指数(0-1),用于动态调整参数
 */
async function multiscaleFusion(
  buffer,
  metadata,
  overexposureScore = 0,
  edgeMask = null
) {
  try {
    const baseSharp = sharp(buffer);
    // 获取统计用于自适应权重
    const stats = await baseSharp.stats();
    const chan0 =
      stats.channels &&
      stats.channels.find(
        (c) => Array.isArray(c.histogram) && c.histogram.length === 256
      );
    const mean = chan0
      ? chan0.mean
      : stats.channels && stats.channels[0]
        ? stats.channels[0].mean
        : 128;
    let highPct = 0,
      shadowPct = 0;
    if (chan0) {
      const total = chan0.histogram.reduce((a, b) => a + b, 0) || 1;
      highPct = chan0.histogram.slice(220).reduce((a, b) => a + b, 0) / total;
      shadowPct =
        chan0.histogram.slice(0, 40).reduce((a, b) => a + b, 0) / total;
    } else {
      // Fallback: 估算占比（方案一简化推断）
      highPct = Math.min(1, Math.max(0, (mean - 180) / 75));
      shadowPct = Math.min(1, Math.max(0, (150 - mean) / 100));
      console.log(
        "   [多曝光融合] histogram缺失，使用估算占比 highPct/shadowPct"
      );
    }

    // 基础曝光参数(较温和)
    // 方案六微调: 提升低曝光底线, 适度增强高曝光, 避免整体偏暗
    // 方案一：低曝光略降但不极暗，高曝光适度提升
    const lowBrightness = Math.max(0.9, 0.94 - overexposureScore * 0.06);
    const midBrightness = 1.0;
    const highBrightness = Math.min(1.1, 1.04 + shadowPct * 0.2);

    // 局部对比度增强(减少过暗风险)
    const lowExp = await baseSharp
      .clone()
      .modulate({ brightness: lowBrightness })
      .linear(1.02, -1)
      .toBuffer();
    const midExp = await baseSharp
      .clone()
      .modulate({ brightness: midBrightness })
      .linear(1.04, -1)
      .toBuffer();
    const highExp = await baseSharp
      .clone()
      .modulate({ brightness: highBrightness })
      .linear(1.04, -0.5)
      .toBuffer();

    // 构建软掩膜(使用模糊平滑避免硬边)
    const lumin = await sharp(buffer).greyscale().toBuffer();
    const hiMaskHard = await sharp(lumin).threshold(190).toBuffer();
    const loMaskHard = await sharp(lumin).threshold(70).negate().toBuffer();
    const hiMask = await sharp(hiMaskHard).blur(4).toBuffer();
    const loMask = await sharp(loMaskHard).blur(4).toBuffer();

    // 归一化权重: 中曝光始终存在
    // 动态调整低/高曝光权重: 高亮占比越高,低曝光权重提升; 暗部占比越高,高曝光权重提升
    // 方案六微调: 降低低曝光参与度与高曝光上限，提升中曝光主导性
    // 方案一：压缩低/高曝光参与度，突出中曝光
    const lowWeight = Math.min(0.4, 0.3 + highPct * 0.5); // 上限0.40
    const highWeight = Math.min(0.42, 0.3 + shadowPct * 0.5); // 上限0.42
    console.log(
      `   [多曝光融合] 权重: 低=${lowWeight.toFixed(
        2
      )}, 高=${highWeight.toFixed(2)}, 高亮占比=${(highPct * 100).toFixed(
        1
      )}%, 暗部占比=${(shadowPct * 100).toFixed(1)}%`
    );

    const lowExpAlpha = await sharp(lowExp).joinChannel(hiMask).toBuffer();
    const highExpAlpha = await sharp(highExp).joinChannel(loMask).toBuffer();

    let fused = await sharp(midExp)
      .composite([
        {
          input: lowExpAlpha,
          blend: "over",
          premultiplied: true,
          opacity: lowWeight,
        },
        {
          input: highExpAlpha,
          blend: "over",
          premultiplied: true,
          opacity: highWeight,
        },
      ])
      .toBuffer();

    // 亮度安全: 若融合后平均亮度 < 175 且 mean 初始 > 190, 说明过度压暗 → 回调亮度
    const fusedStats = await sharp(fused).stats();
    const fusedMean =
      fusedStats.channels && fusedStats.channels[0]
        ? fusedStats.channels[0].mean
        : 128;
    if (mean > 185 && fusedMean < 180) {
      console.log(
        `   [多曝光融合] 亮度回调: 融合均值 ${fusedMean.toFixed(1)} <180 → +5%`
      );
      fused = await sharp(fused).modulate({ brightness: 1.05 }).toBuffer();
    }

    // 描边锐化(限制振铃): 仅对掩码区域做轻量不失真锐化
    if (edgeMask) {
      const edgeSharpen = await sharp(fused)
        .sharpen({ sigma: 0.6, m1: 0.7, m2: 0.7 })
        .toBuffer();
      const edgeSharpenAlpha = await sharp(edgeSharpen)
        .joinChannel(edgeMask)
        .toBuffer();
      fused = await sharp(fused)
        .composite([
          {
            input: edgeSharpenAlpha,
            blend: "over",
            premultiplied: true,
            opacity: 0.5,
          },
        ])
        .toBuffer();
      // 二次亮度安全：锐化后再检查
      const postSharpenStats = await sharp(fused).stats();
      const postMean =
        postSharpenStats.channels && postSharpenStats.channels[0]
          ? postSharpenStats.channels[0].mean
          : 128;
      if (postMean < 180) {
        console.log(
          `   [多曝光融合] 锐化后亮度安全回调: 均值 ${postMean.toFixed(
            1
          )} < 180 → +3%`
        );
        fused = await sharp(fused).modulate({ brightness: 1.03 }).toBuffer();
      }
    }

    return fused;
  } catch (e) {
    console.warn("⚠️ 多曝光融合失败，跳过:", e.message);
    return buffer;
  }
}

/**
 * CLAHE局部增强模拟(方案一简化)
 * 通过锐化+中值滤波模拟局部对比度增强,保持灰度不升高
 * @param {Buffer} buffer - 输入图像缓冲区
 * @param {number} overexposureScore - 过曝指数(0-1),用于动态调整强度
 */
async function claheLikeEnhancement(
  buffer,
  overexposureScore = 0,
  relaxed = false
) {
  try {
    // 根据过曝程度动态调整锐化和对比度强度(过曝时减弱避免进一步恶化)
    // 方案一：减轻偏移与对比压缩
    const sharpenSigma = Math.max(1.2, 1.7 - overexposureScore * 0.7);
    const contrastFactor = Math.max(1.02, 1.06 - overexposureScore * 0.06);
    const brightnessOffset = relaxed
      ? Math.max(-4, -2 - overexposureScore * 4)
      : Math.max(-6, -3 - overexposureScore * 5);

    console.log(
      `   [CLAHE增强] 动态参数: 锐化σ=${sharpenSigma.toFixed(
        2
      )}, 对比度=${contrastFactor.toFixed(
        2
      )}, 降亮偏移=${brightnessOffset.toFixed(1)}`
    );

    // 增强的CLAHE模拟:拉普拉斯锐化 + 局部锐化 + 中值平滑
    const enhanced = await sharp(buffer)
      .convolve({
        // 拉普拉斯算子强化边缘
        width: 3,
        height: 3,
        kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0],
      })
      .sharpen({ sigma: sharpenSigma, m1: 1.0, m2: 1.0 }) // 动态锐化强度
      .median(2) // 中值滤波去噪
      .linear(contrastFactor, brightnessOffset) // 动态对比度和降亮
      .toBuffer();

    return enhanced;
  } catch (e) {
    console.warn("⚠️ CLAHE增强失败，跳过:", e.message);
    return buffer;
  }
}

/**
 * 快速模式（保留兼容）
 */
async function removeWatermarkFast(inputPath, outputPath) {
  try {
    console.log("⚡ 使用快速模式处理...");

    await sharp(inputPath)
      .blur(1.8)
      .sharpen()
      .modulate({ brightness: 1.05, saturation: 1.12 })
      .linear(1.05, -5)
      .median(2)
      .jpeg({ quality: 92 })
      .toFile(outputPath);

    console.log("✅ 快速模式完成");
    return { success: true, method: "fast" };
  } catch (error) {
    console.error("❌ 快速模式失败");
    throw error;
  }
}

/**
 * 高级模式（使用Hybrid的简化版）
 */
async function removeWatermarkAdvanced(inputPath, outputPath) {
  try {
    console.log("🧠 使用高级模式（Hybrid简化版）...");

    const metadata = await sharp(inputPath).metadata();
    const detectionResult = await detectWatermarkRegions(inputPath, metadata);
    const processedBuffer = await regionalDeepRemoval(
      inputPath,
      detectionResult,
      metadata
    );

    // 简化的后处理
    await sharp(processedBuffer)
      .sharpen()
      .modulate({ brightness: 1.04 })
      .jpeg({ quality: 94 })
      .toFile(outputPath);

    console.log("✅ 高级模式完成");
    return { success: true, method: "advanced" };
  } catch (error) {
    console.error("❌ 高级模式失败");
    throw error;
  }
}

module.exports = {
  removeWatermark, // 主函数：终极Hybrid方案
  removeWatermarkAdvanced, // 高级模式（Hybrid简化版）
  removeWatermarkFast, // 快速模式
};
