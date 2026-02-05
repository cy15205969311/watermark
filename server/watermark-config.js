/**
 * 水印去除配置文件
 * 可根据实际效果调整这些参数
 */

module.exports = {
  // ========== Puppeteer 截图前清理配置 ==========
  puppeteer: {
    // 水印关键词（用于识别和移除水印元素）
    watermarkKeywords: [
      "watermark", "logo", "mark", "tuguaishou", "818ps", "guais",
      "tgs", "ps818", "brand", "copyright", "mask", "overlay",
      "chuangkit", "ck-watermark"
    ],

    // 高z-index小元素检测（通常是水印）
    suspiciousElement: {
      maxWidth: 300,      // 最大宽度（像素）
      maxHeight: 150,     // 最大高度（像素）
      minZIndex: 100      // 最小z-index值
    },

    // 低透明度元素检测（隐藏水印）
    lowOpacityElement: {
      maxOpacity: 0.3,    // 最大透明度
      maxWidth: 400,      // 最大宽度（像素）
      maxHeight: 200      // 最大高度（像素）
    }
  },

  // ========== 水印检测配置 ==========
  detection: {
    // 黑色文字检测
    blackText: {
      brightnessThreshold: 90,    // 亮度阈值（0-255）
      edgeThreshold: 50           // 边缘强度阈值
    },

    // 彩色图形检测
    colorShape: {
      saturationThreshold: 240,   // 饱和度阈值（0-255）
      textureThreshold: 35        // 纹理差异阈值
    },

    // 浅色水印检测
    lightWatermark: {
      minBrightness: 180,         // 最小亮度
      maxBrightness: 220,         // 最大亮度
      edgeThreshold: 30           // 边缘阈值
    },

    // 平台特定检测（图怪兽/创客贴）
    platformSpecific: {
      cornerSize: 0.15,           // 角落区域大小（相对于图片尺寸）
      enabled: true               // 是否启用
    }
  },

  // ========== 水印掩膜生成配置 ==========
  mask: {
    // 形态学膨胀
    dilate: {
      kernelSize: 13,             // 卷积核大小（必须是奇数）
      enabled: true
    },

    // 模糊软化
    blur: {
      radius: 7.0,                // 模糊半径
      enabled: true
    },

    // 二值化阈值
    threshold: 65                 // 阈值（0-255，越低检测越多）
  },

  // ========== 水印修复配置 ==========
  repair: {
    // 基础修复层
    base: {
      blurRadius: 3.5,            // 模糊半径
      medianSize: 3,              // 中值滤波大小
      smoothBlur: 1.2             // 平滑模糊半径
    },

    // 多层纹理融合
    texture: {
      fineBlur: 0.8,              // 精细纹理模糊
      midBlur: 1.8,               // 中等纹理模糊
      coarseBlur: 3.5             // 粗糙纹理模糊
    },

    // 融合权重
    blending: {
      strongMaskBlur: 5,          // 强掩膜模糊
      mediumMaskBlur: 9,          // 中掩膜模糊
      softMaskBlur: 14,           // 软掩膜模糊

      coreOpacity: 0.85,          // 核心修复层透明度（0-1）
      textureOpacity: 0.45,       // 纹理层透明度（0-1）
      fineOpacity: 0.3            // 精细层透明度（0-1）
    }
  },

  // ========== 降噪配置 ==========
  denoise: {
    medianSize: 3,                // 中值滤波大小
    blurRadius: 0.8,              // 模糊半径
    maskBlur: 8,                  // 掩膜模糊
    opacity: 0.7                  // 降噪参与度（0-1）
  },

  // ========== 二次强化处理配置 ==========
  secondPass: {
    enabled: true,                // 是否启用二次处理
    blurRadius: 4.5,              // 超强模糊半径
    medianSize: 4,                // 超强中值滤波大小
    opacity: 0.6                  // 二次修复参与度（0-1）
  },

  // ========== 锐化配置 ==========
  sharpen: {
    // 全图锐化
    global: {
      sigma: 1.6,                 // 锐化强度
      m1: 1.2,                    // 锐化参数1
      m2: 0.9                     // 锐化参数2
    },

    // 三级自适应锐化
    adaptive: {
      enabled: true,
      ultra: { sigma: 1.8, m1: 1.2, m2: 0.9, opacity: 0.85 },
      medium: { sigma: 1.0, m1: 0.7, m2: 0.6, opacity: 0.5 },
      soft: { sigma: 0.5, m1: 0.35, m2: 0.25, opacity: 0.3 }
    }
  },

  // ========== 色彩恢复配置 ==========
  color: {
    saturation: 1.15,             // 饱和度（1.0为原始）
    brightness: 1.06,             // 亮度（1.0为原始）
    contrast: 1.08,               // 对比度（1.0为原始）
    offset: 3                     // 亮度偏移
  },

  // ========== 输出配置 ==========
  output: {
    quality: 95,                  // JPEG质量（1-100）
    mozjpeg: true,                // 使用MozJPEG优化
    format: 'jpeg'                // 输出格式（jpeg/png/webp）
  },

  // ========== 性能配置 ==========
  performance: {
    maxConcurrent: 3,             // 最大并发处理数
    timeout: 30000,               // 处理超时（毫秒）
    cacheEnabled: true,           // 是否启用缓存
    cacheTTL: 3600000             // 缓存过期时间（毫秒）
  },

  // ========== 调试配置 ==========
  debug: {
    enabled: false,               // 是否启用调试模式
    saveMask: false,              // 是否保存水印掩膜
    saveIntermediate: false,      // 是否保存中间结果
    verboseLog: false             // 是否输出详细日志
  },

  // ========== 预设配置 ==========
  presets: {
    // 快速模式（速度优先）
    fast: {
      mask: { dilate: { kernelSize: 9 }, blur: { radius: 3.0 }, threshold: 80 },
      repair: { base: { blurRadius: 1.8, medianSize: 2 } },
      secondPass: { enabled: false }
    },

    // 标准模式（平衡）
    standard: {
      // 使用默认配置
    },

    // 高级模式（质量优先）
    advanced: {
      mask: { dilate: { kernelSize: 15 }, blur: { radius: 9.0 }, threshold: 55 },
      repair: { base: { blurRadius: 4.5, medianSize: 4 } },
      secondPass: { enabled: true, blurRadius: 5.5, medianSize: 5 }
    },

    // 图怪兽专用模式
    tuguaishou: {
      detection: { platformSpecific: { cornerSize: 0.2, enabled: true } },
      mask: { threshold: 60 },
      repair: { blending: { coreOpacity: 0.9 } }
    },

    // 创客贴专用模式
    chuangkit: {
      detection: { platformSpecific: { cornerSize: 0.18, enabled: true } },
      mask: { threshold: 62 },
      repair: { blending: { coreOpacity: 0.88 } }
    }
  }
};

/**
 * 获取配置（支持预设）
 * @param {string} preset - 预设名称（fast/standard/advanced/tuguaishou/chuangkit）
 * @returns {object} 配置对象
 */
function getConfig(preset = 'standard') {
  const config = module.exports;

  if (preset === 'standard') {
    return config;
  }

  if (!config.presets[preset]) {
    console.warn(`⚠️ 未知的预设: ${preset}，使用标准配置`);
    return config;
  }

  // 深度合并预设配置
  return deepMerge(config, config.presets[preset]);
}

/**
 * 深度合并对象
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

module.exports.getConfig = getConfig;
