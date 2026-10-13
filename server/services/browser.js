// server/services/browser.js
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { withPuppeteerExecutablePath } = require("../utils/puppeteer-launch");

puppeteer.use(StealthPlugin());

function launchBrowser(launchOptions) {
  return puppeteer.launch(withPuppeteerExecutablePath(launchOptions));
}

async function scrapeWithBrowser(targetUrl) {
  let browser;
  try {
    const launchOptions = {
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    };
    browser = await launchBrowser(launchOptions);

    const page = await browser.newPage();
    // 伪装视口
    await page.setViewport({ width: 1920, height: 1080 });

    // 【核心黑科技】变量：用于存储嗅探到的最大图片
    let bestImageUrl = null;
    let maxImageSize = 0;

    // 1. 开启请求拦截（为了性能，可以拦截掉字体和媒体文件，但图片必须放行）
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      // 保留样式表，避免背景图不加载；仅拦截字体与媒体
      if (["font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // 2. 监听响应（嗅探核心，含评分规则与 JSON 解析）
    const excludeKeys = [
      "favicon",
      "sprite",
      "icon",
      "avatar",
      "tracking",
      "thumb",
      "small",
      "min",
      "svg",
      "watermark",
    ];
    const preferKeys = [
      "preview",
      "cover",
      "main",
      "banner",
      "poster",
      "detail",
      "work",
      "showImg",
      "l2000",
      "l3000",
      "origin",
      "big",
    ];

    function scoreUrl(u, size) {
      let s = Math.min(Math.floor((size || 0) / 1024), 500); // 基于大小上限
      const lower = u.toLowerCase();
      // 通用加权
      if (preferKeys.some((k) => lower.includes(k))) s += 200;
      if (excludeKeys.some((k) => lower.includes(k))) s -= 150;
      // 818ps/图怪兽域名的特定规则：
      const isTuguaishou = /tuguaishou\.com/.test(lower);
      if (isTuguaishou) {
        // 强烈偏好用户预览主图路径（整张海报预览），例如 user_preview_ue / ips_user_preview_api
        if (/user_preview_ue|ips_user_preview_api|user_preview/.test(lower))
          s += 400;
        // 惩罚素材库直链，避免选中单个小图或元素
        if (/designer_upload_asset|element|asset/.test(lower)) s -= 350;
        // 扩展名偏好：海报主图通常为 jpg
        if (/\.jpg(\?|$)/.test(lower)) s += 80;
        if (/\.png(\?|$)/.test(lower)) s -= 60;
        // 带强制尺寸（!l2000/!l3000）略加分，但不超过用户预览主图偏好
        if (/!l\d{3,4}/.test(lower)) s += 40;
      }
      return s;
    }

    page.on("response", async (response) => {
      const url = response.url();
      const headers = response.headers();
      const type = headers["content-type"] || "";

      // 图片资源评分
      if (type.startsWith("image/")) {
        if (excludeKeys.some((k) => url.toLowerCase().includes(k))) return;
        try {
          const size = parseInt(headers["content-length"] || "0");
          const s = scoreUrl(url, size);
          if (size > 30 * 1024 && s > maxImageSize) {
            console.log(
              `🔍 嗅探到候选图片: ${Math.round(size / 1024)}KB -> ${url}`
            );
            maxImageSize = s;
            bestImageUrl = url;
          }
        } catch (e) { }
        return;
      }

      // JSON/XHR 中的预览图链接
      if (type.includes("application/json") || type.includes("text/json")) {
        try {
          const text = await response.text();
          const match = text.match(
            /https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|webp)(?:[^\s"'<>]*)/i
          );
          if (match) {
            const candidate = match[0];
            const s =
              scoreUrl(candidate, parseInt(headers["content-length"] || "0")) +
              150;
            if (s > maxImageSize) {
              console.log(`🔍 JSON里发现图片: -> ${candidate}`);
              maxImageSize = s;
              bestImageUrl = candidate;
            }
          }
        } catch (e) { }
      }
    });

    console.log(`🌐 正在加载页面: ${targetUrl}`);
    // 3. 访问页面
    // 优化：waitUntil 改为 domcontentloaded (比 networkidle2 快)，因为我们是在后台监听流量，不需要等页面完全静止
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // 4. 稍微等一会，让图片请求发出来
    // 针对 818ps/Canva 这种懒加载页面，模拟滚动一下效果更好
    await page.evaluate(async () => {
      window.scrollBy(0, window.innerHeight);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });

    // 再等 3 秒让流量跑一会
    await new Promise((r) => setTimeout(r, 3000));

    // 5. DOM 兜底：meta/IMG/背景图扫描
    if (!bestImageUrl) {
      try {
        const domCandidate = await page.evaluate(() => {
          const urls = [];
          const pick = (u) => {
            if (u && u.startsWith("http")) urls.push(u);
          };
          const og = document.querySelector(
            'meta[property="og:image"]'
          )?.content;
          pick(og);
          const tw = document.querySelector(
            'meta[name="twitter:image"]'
          )?.content;
          pick(tw);
          const img = document.querySelector(
            ".detail-img-box img, #showImg, .preview-image, .work-image img"
          );
          pick(img?.src);
          const candidates = document.querySelectorAll(
            ".detail-img-box, .preview-image, .work-image, .image, .poster"
          );
          for (const el of candidates) {
            const bg = getComputedStyle(el).backgroundImage;
            const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
            if (m && m[1]) pick(m[1]);
          }
          return urls.find(Boolean) || null;
        });
        if (domCandidate) {
          console.log(`🔍 DOM里发现图片: -> ${domCandidate}`);
          bestImageUrl = domCandidate;
        }
      } catch { }
    }

    if (bestImageUrl) {
      console.log("✅ 最终锁定主图:", bestImageUrl);
      return bestImageUrl;
    }

    throw new Error("未嗅探到有效大图");
  } catch (error) {
    console.error("❌ 浏览器抓取失败:", error.message);
    throw error; // 抛出错误让外层兜底
  } finally {
    if (browser) await browser.close();
  }
}

// 平台专用函数
async function scrape818ps(url) {
  // 优先采用元素截图（包含文本与样式），失败再回退到网络嗅探 URL
  let browser;
  try {
    const launchOptions = {
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    };
    browser = await launchBrowser(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // 【超强版】注入样式与脚本：移除水印层与含水印的背景/图片
    await page.addStyleTag({
      content: `
      /* 通用水印隐藏 */
      [class*="watermark"], [id*="watermark"], .watermark, .wm, .wm-layer, .wm-text,
      .logo-watermark, .logoLayer, .mark, .mark-text, .preview-watermark,
      /* 图怪兽特定水印 */
      [class*="tuguaishou"], [class*="818ps"], [class*="guais"],
      [id*="tuguaishou"], [id*="818ps"], [id*="guais"],
      .tgs-watermark, .tgs-logo, .tgs-mark, .ps818-watermark, .ps818-logo,
      /* 遮罩层 */
      [class*="mask"], [class*="overlay"], .mask-layer, .overlay-layer,
      /* 版权信息 */
      [class*="copyright"], [class*="brand"], .copyright, .brand-logo,
      /* SVG水印 */
      svg[class*="watermark"], svg[class*="logo"], svg[class*="mark"],
      /* 【新增】文字水印层 - 针对DOM文字水印 */
      [class*="text-watermark"], [class*="text-mark"], [class*="text-layer"],
      [id*="text-watermark"], [id*="text-mark"], [id*="text-layer"],
      .text-overlay, .text-mask, .watermark-text, .mark-text-layer,
      /* 【新增】图怪兽特定文字水印类名 */
      [class*="tgs-text"], [class*="ps818-text"], [class*="banner-watermark"]
      { display:none !important; opacity:0 !important; visibility:hidden !important; pointer-events:none !important; width:0 !important; height:0 !important; }
    `,
    });
    await page.evaluate(() => {
      const keywords = [
        "watermark", "logo", "mark", "tuguaishou", "818ps", "guais",
        "tgs", "ps818", "brand", "copyright", "mask", "overlay"
      ];

      // 【新增】文字水印关键词（中文+英文）
      const textWatermarkKeywords = [
        "图怪兽", "tuguaishou", "818ps", "818设计", "免费", "会员",
        "水印", "版权", "copyright", "watermark", "试用", "vip",
        "升级", "付费", "购买", "解锁", "限时", "活动", "马迎新春",
        "春节放假通知", "放假", "通知"
      ];

      console.log("🧹 开始清理DOM水印...");

      // ========== 第一轮：移除所有可能的水印元素 ==========
      const all = document.querySelectorAll("*");
      let removedCount = 0;

      for (const el of all) {
        try {
          // 检查类名和ID
          const className = (el.className || "").toString().toLowerCase();
          const id = (el.id || "").toLowerCase();
          const tagName = el.tagName.toLowerCase();

          if (keywords.some(k => className.includes(k) || id.includes(k))) {
            el.remove();
            removedCount++;
            continue;
          }

          // 检查背景图片
          const cs = getComputedStyle(el);
          const bg = cs.backgroundImage;
          if (bg && /url\(/.test(bg)) {
            const m = bg.match(/url\(["']?(.*?)["']?\)/);
            if (m && m[1]) {
              const u = m[1].toLowerCase();
              if (keywords.some((k) => u.includes(k))) {
                el.style.backgroundImage = "none";
              }
            }
          }

          // 检查img标签
          if (tagName === "img") {
            const src = (el.currentSrc || el.src || "").toLowerCase();
            const alt = (el.alt || "").toLowerCase();
            if (keywords.some(k => src.includes(k) || alt.includes(k))) {
              el.remove();
              removedCount++;
            }
          }

          // 检查SVG元素
          if (tagName === "svg") {
            const svgContent = el.outerHTML.toLowerCase();
            if (keywords.some(k => svgContent.includes(k))) {
              el.remove();
              removedCount++;
            }
          }

          // 【增强】检查文本内容（文字水印）- 方案6
          const text = el.textContent || "";
          const textLower = text.toLowerCase();

          // 关键词匹配
          if (textWatermarkKeywords.some(k => text.includes(k) || textLower.includes(k))) {
            console.log(`  🎯 发现文字水印: "${text.substring(0, 30)}..."`);
            el.remove();
            removedCount++;
            continue;
          }
        } catch (e) {
          // 忽略单个元素处理错误
        }
      }

      console.log(`  ✅ 第一轮清理完成，移除 ${removedCount} 个元素`);

      // ========== 第二轮：基于位置的文字水印检测（方案2） ==========
      console.log("🎯 开始基于位置的文字水印检测...");
      let positionRemovedCount = 0;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const cornerSize = Math.min(viewportWidth, viewportHeight) * 0.25; // 角落区域25%

      document.querySelectorAll("p, span, div, h1, h2, h3, h4, h5, h6, a, label, strong, b").forEach(el => {
        try {
          const rect = el.getBoundingClientRect();
          const text = el.textContent || "";

          // 跳过空文本
          if (!text.trim() || text.trim().length === 0) return;

          // 检查是否在四角区域
          const isInCorner =
            (rect.left < cornerSize && rect.top < cornerSize) || // 左上
            (rect.right > viewportWidth - cornerSize && rect.top < cornerSize) || // 右上
            (rect.left < cornerSize && rect.bottom > viewportHeight - cornerSize) || // 左下
            (rect.right > viewportWidth - cornerSize && rect.bottom > viewportHeight - cornerSize); // 右下

          if (isInCorner) {
            const cs = getComputedStyle(el);
            const fontSize = parseFloat(cs.fontSize) || 0;
            const zIndex = parseInt(cs.zIndex) || 0;

            // 方案3：大字体检测 + 方案5：高层级检测
            if (fontSize > 16 || zIndex > 50 || cs.position === "absolute" || cs.position === "fixed") {
              console.log(`  🎯 移除角落文字: "${text.substring(0, 40)}..." (位置: ${Math.round(rect.left)},${Math.round(rect.top)}, 字体: ${fontSize}px)`);
              el.remove();
              positionRemovedCount++;
            }
          }
        } catch (e) { }
      });

      console.log(`  ✅ 第二轮清理完成，移除 ${positionRemovedCount} 个元素`);

      // ========== 第三轮：基于层级的检测（方案5） ==========
      console.log("🎯 开始基于层级的文字水印检测...");
      let zIndexRemovedCount = 0;

      document.querySelectorAll("*").forEach(el => {
        try {
          const cs = getComputedStyle(el);
          const zIndex = parseInt(cs.zIndex) || 0;
          const position = cs.position;

          // 高z-index的绝对定位元素
          if ((position === "absolute" || position === "fixed") && zIndex > 100) {
            const rect = el.getBoundingClientRect();
            const text = el.textContent || "";

            // 如果包含文本且尺寸不大（不是主要内容）
            if (text.trim() && rect.width < 600 && rect.height < 400) {
              console.log(`  🎯 移除高层级元素: z-index=${zIndex}, "${text.substring(0, 30)}..."`);
              el.remove();
              zIndexRemovedCount++;
            }
          }
        } catch (e) { }
      });

      console.log(`  ✅ 第三轮清理完成，移除 ${zIndexRemovedCount} 个元素`);

      // ========== 第四轮：基于样式的检测（方案4+9） ==========
      console.log("🎯 开始基于样式的文字水印检测...");
      let styleRemovedCount = 0;

      document.querySelectorAll("p, span, div, h1, h2, h3, h4, h5, h6").forEach(el => {
        try {
          const cs = getComputedStyle(el);
          const text = el.textContent || "";

          if (!text.trim()) return;

          // 方案9：半透明文本
          const opacity = parseFloat(cs.opacity);
          if (opacity > 0 && opacity < 0.9) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 500 && rect.height < 300) {
              console.log(`  🎯 移除半透明文字: opacity=${opacity.toFixed(2)}, "${text.substring(0, 30)}..."`);
              el.remove();
              styleRemovedCount++;
              return;
            }
          }

          // 方案4：特殊颜色检测（红色、金色等醒目颜色）
          const color = cs.color;
          const colorMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (colorMatch) {
            const r = parseInt(colorMatch[1]);
            const g = parseInt(colorMatch[2]);
            const b = parseInt(colorMatch[3]);

            // 检测红色系（r > 180, g < 120, b < 120）
            // 检测金色系（r > 180, g > 130, b < 100）
            const isRedish = r > 180 && g < 120 && b < 120;
            const isGoldish = r > 180 && g > 130 && b < 100;

            if (isRedish || isGoldish) {
              const rect = el.getBoundingClientRect();
              const fontSize = parseFloat(cs.fontSize) || 0;
              if (rect.width < 600 && rect.height < 300 && fontSize > 14) {
                console.log(`  🎯 移除醒目颜色文字: color=${color}, "${text.substring(0, 30)}..."`);
                el.remove();
                styleRemovedCount++;
              }
            }
          }
        } catch (e) { }
      });

      console.log(`  ✅ 第四轮清理完成，移除 ${styleRemovedCount} 个元素`);

      // ========== 总结 ==========
      const totalRemoved = removedCount + positionRemovedCount + zIndexRemovedCount + styleRemovedCount;
      console.log(`\n🎉 DOM水印清理完成！共移除 ${totalRemoved} 个水印元素`);
    });

    // 等待并滚动触发懒加载
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise((r) => setTimeout(r, 800));
      }
    });

    // 扩充选择器以覆盖图怪兽/818ps的多种详情结构
    const selectors = [
      ".detail-img-box",
      ".work-image",
      ".preview-image",
      "#showImg",
      ".image-preview",
      ".poster",
      ".detailWork .img-box",
      ".ps-work-preview",
      ".work-detail-box",
      ".work-show",
      ".psdShow",
      ".showImg",
      ".main-preview, .preview-wrap, .canvas-wrap",
      "main .preview, main .poster",
    ];

    // 找到面积最大的候选容器
    const targetInfo = await page.evaluate((sels) => {
      function areaOf(el) {
        const r = el.getBoundingClientRect();
        return Math.max(0, r.width * r.height);
      }
      function aspectScore(el) {
        const r = el.getBoundingClientRect();
        const ratio = r.width && r.height ? r.width / r.height : 0;
        // 海报常见纵向比例约在 0.6~0.8，横向在 1.2~1.6，给较高分
        let score = 0;
        if (ratio > 0.55 && ratio < 0.85) score = 2; // 竖版
        else if (ratio > 1.1 && ratio < 1.7) score = 1.5; // 横版
        return score;
      }
      let best = { area: 0, selector: null };
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) {
          const a = areaOf(el);
          const as = aspectScore(el);
          const score = a * (1 + as); // 面积优先，同时考虑海报常见比例
          if (score > best.area) best = { area: score, selector: s };
        }
      }
      return best;
    }, selectors);

    if (targetInfo && targetInfo.selector) {
      const el = await page.$(targetInfo.selector);
      const box = await el.boundingBox();
      if (box && box.width > 100 && box.height > 100) {
        // 进一步尝试在目标容器内部定位真正的海报子节点（避免单素材）
        const subSel = await page.evaluate((selector) => {
          const root = document.querySelector(selector);
          if (!root) return null;
          const candidates = root.querySelectorAll(
            'img, .poster, .preview-image, .image, .work-image, [style*="background-image"]'
          );
          function areaOf(el) {
            const r = el.getBoundingClientRect();
            return Math.max(0, r.width * r.height);
          }
          let best = { el: null, score: 0 };
          candidates.forEach((el) => {
            const r = el.getBoundingClientRect();
            const ratio = r.width && r.height ? r.width / r.height : 0;
            let ratioScore = 0;
            if (ratio > 0.55 && ratio < 0.85) ratioScore = 2;
            else if (ratio > 1.1 && ratio < 1.7) ratioScore = 1.5;
            const score = areaOf(el) * (1 + ratioScore);
            if (score > best.score) best = { el, score };
          });
          return best.el ? best.el.outerHTML.substring(0, 200) : null; // 仅用于判断存在
        }, targetInfo.selector);

        // 收集容器内文本节点及其样式
        const textLayers = await page.evaluate((selector) => {
          const root = document.querySelector(selector);
          if (!root) return [];
          const nodes = Array.from(
            root.querySelectorAll("p, span, h1, h2, h3, h4, h5, strong, b")
          );
          return nodes
            .map((n) => {
              const cs = getComputedStyle(n);
              const r = n.getBoundingClientRect();
              return {
                text: n.innerText || n.textContent || "",
                tag: n.tagName,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                color: cs.color,
                fontSize: cs.fontSize,
                fontWeight: cs.fontWeight,
                fontFamily: cs.fontFamily,
                textAlign: cs.textAlign,
              };
            })
            .filter((t) => t.text && t.text.trim().length > 0);
        }, targetInfo.selector);

        const clip = {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: Math.ceil(box.width),
          height: Math.ceil(box.height),
        };
        // 截图：提高质量，避免只截到单素材
        const buf = await page.screenshot({
          clip,
          type: "png",
          omitBackground: false,
        });
        const dataUrl = "data:image/png;base64," + buf.toString("base64");
        await browser.close();
        return { dataUrl, textLayers };
      }
    }

    // 回退：使用网络嗅探获取的大图 URL
    await browser.close();
    // 回退：使用网络嗅探获取的大图 URL
    // 对图怪兽资源，可能嗅探到单个素材直链；但优先已进行元素截图，能更贴近整张海报
    return await scrapeWithBrowser(url);
  } catch (e) {
    try {
      if (browser) await browser.close();
    } catch { }
    // 失败则直接回退
    return await scrapeWithBrowser(url);
  }
}

async function scrapeCanva(url) {
  // 优先元素截图前清理水印层
  let browser;
  try {
    const launchOptions = {
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    };
    browser = await launchBrowser(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await page.addStyleTag({
      content: `
      [class*="watermark"], [id*="watermark"], .watermark, .wm, .wm-layer, .wm-text,
      .logo-watermark, .logoLayer, .mark, .mark-text, .preview-watermark { display:none !important; opacity:0 !important; visibility:hidden !important; }
    `,
    });
    await page.evaluate(() => {
      const keywords = ["watermark", "logo", "mark", "canva"];
      const all = document.querySelectorAll("*");
      for (const el of all) {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundImage;
        if (bg && /url\(/.test(bg)) {
          const m = bg.match(/url\(["']?(.*?)["']?\)/);
          if (m && m[1]) {
            const u = m[1].toLowerCase();
            if (keywords.some((k) => u.includes(k))) {
              el.style.backgroundImage = "none";
            }
          }
        }
        const imgs = el.tagName === "IMG" ? [el] : el.querySelectorAll("img");
        for (const img of imgs) {
          const src = (img.currentSrc || img.src || "").toLowerCase();
          if (src && keywords.some((k) => src.includes(k))) {
            img.style.display = "none";
          }
        }
      }
    });

    // 滚动触发懒加载
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      for (let i = 0; i < 2; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise((r) => setTimeout(r, 800));
      }
    });

    const selectors = [
      ".page-view",
      ".design",
      ".page",
      ".canvas-container",
      "main",
    ];
    const targetInfo = await page.evaluate((sels) => {
      function areaOf(el) {
        const r = el.getBoundingClientRect();
        return Math.max(0, r.width * r.height);
      }
      let best = { area: 0, selector: null };
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) {
          const a = areaOf(el);
          if (a > best.area) best = { area: a, selector: s };
        }
      }
      return best;
    }, selectors);

    if (targetInfo && targetInfo.selector) {
      const el = await page.$(targetInfo.selector);
      const box = await el.boundingBox();
      if (box && box.width > 100 && box.height > 100) {
        // 收集文本层
        const textLayers = await page.evaluate((selector) => {
          const root = document.querySelector(selector);
          if (!root) return [];
          const nodes = Array.from(
            root.querySelectorAll("p, span, h1, h2, h3, h4, h5, strong, b")
          );
          return nodes
            .map((n) => {
              const cs = getComputedStyle(n);
              const r = n.getBoundingClientRect();
              return {
                text: n.innerText || n.textContent || "",
                tag: n.tagName,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                color: cs.color,
                fontSize: cs.fontSize,
                fontWeight: cs.fontWeight,
                fontFamily: cs.fontFamily,
                textAlign: cs.textAlign,
              };
            })
            .filter((t) => t.text && t.text.trim().length > 0);
        }, targetInfo.selector);

        const clip = {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: Math.ceil(box.width),
          height: Math.ceil(box.height),
        };
        const buf = await page.screenshot({ clip, type: "png" });
        const dataUrl = "data:image/png;base64," + buf.toString("base64");
        await browser.close();
        return { dataUrl, textLayers };
      }
    }
    await browser.close();
    return await scrapeWithBrowser(url);
  } catch (e) {
    try {
      if (browser) await browser.close();
    } catch { }
    return await scrapeWithBrowser(url);
  }
}

async function scrapeDouyin(url) {
  return scrapeWithBrowser(url);
}

async function scrapeXiaohongshu(url) {
  return scrapeWithBrowser(url);
}

module.exports = {
  scrapeWithBrowser,
  scrape818ps,
  scrapeCanva,
  scrapeDouyin,
  scrapeXiaohongshu,
  scrapeChuangkit: scrapeChuangkitEnhanced,
};

function normalizeChuangkitImageUrl(url) {
  if (typeof url !== "string") {
    return null;
  }

  const normalized = url.trim().replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("//")) {
    return `https:${normalized}`;
  }

  return normalized;
}

function isBlockedChuangkitAssetUrl(url) {
  const normalized = normalizeChuangkitImageUrl(url);
  if (!normalized) {
    return true;
  }

  const lower = normalized.toLowerCase();
  if (/^data:image\//.test(lower) || /^blob:/.test(lower)) {
    return false;
  }

  if (/^https?:\/\/hm\.baidu\.com\/hm\.gif/.test(lower)) return true;
  if (/googletagmanager|google-analytics|doubleclick|umeng|clarity/.test(lower)) {
    return true;
  }
  if (/\/distheadless\/img\//.test(lower)) return true;
  if (/full-screen|fullscreen|favicon|tracker|tracking|pixel/.test(lower)) {
    return true;
  }
  if (/\.gif(?:$|\?)/.test(lower)) return true;
  if (/\.svg(?:$|\?)/.test(lower) && !/svg_build\/render_result/.test(lower)) {
    return true;
  }

  return false;
}

async function scrapeChuangkitEnhanced(pageUrl) {
  let browser;
  try {
    console.log("🧩 开始创客贴精确设计稿抓取:", pageUrl);

    const launchOptions = {
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
      ],
    };
    browser = await launchBrowser(launchOptions);

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      Referer: "https://www.chuangkit.com/",
      Origin: "https://www.chuangkit.com",
    });

    let bestDesignImageUrl = null;
    let maxDesignScore = 0;
    const capturedImages = new Map();
    let captureSequence = 0;

    const captureCandidate = (rawUrl, options = {}) => {
      const normalized = normalizeChuangkitImageUrl(rawUrl);
      if (!normalized || isBlockedChuangkitAssetUrl(normalized)) {
        return;
      }

      const size = Number(options.size) || 0;
      const score =
        scoreChuangkitDesignUrl(normalized, size) + (Number(options.scoreBoost) || 0);
      if (score < 900) {
        return;
      }

      const existing = capturedImages.get(normalized);
      const pageHint =
        Number.isFinite(options.pageHint) && options.pageHint > 0
          ? options.pageHint
          : existing && Number.isFinite(existing.pageHint)
            ? existing.pageHint
            : extractChuangkitPageHint(normalized);
      const domIndex =
        Number.isFinite(options.domIndex) && options.domIndex >= 0
          ? options.domIndex
          : existing && Number.isFinite(existing.domIndex)
            ? existing.domIndex
            : null;

      const next = {
        url: normalized,
        score: existing ? Math.max(existing.score, score) : score,
        size: existing ? Math.max(existing.size || 0, size) : size,
        source: options.source || (existing && existing.source) || "network",
        order: existing ? existing.order : captureSequence++,
        pageHint,
        domIndex,
      };

      capturedImages.set(normalized, next);

      if (score > maxDesignScore) {
        maxDesignScore = score;
        bestDesignImageUrl = normalized;
      }

      if ((!existing || score > existing.score) && score >= 1000) {
        console.log(`🎨 发现设计稿候选: ${Math.round(size / 1024)}KB, 评分:${Math.round(score)}`);
        console.log(`   URL: ${normalized.substring(0, 100)}...`);
      }
    };

    const collectInlineCandidates = async (source, scoreBoost) => {
      try {
        const pageContent = await page.content();
        extractChuangkitImageUrlsFromText(pageContent).forEach((candidateUrl) => {
          captureCandidate(candidateUrl, {
            source,
            scoreBoost,
          });
        });
      } catch (error) {
        // Ignore page content parsing failures.
      }
    };

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.on("response", async (response) => {
      const url = response.url();
      const headers = response.headers();
      const contentType = headers["content-type"] || "";

      if (contentType.startsWith("image/")) {
        try {
          captureCandidate(url, {
            size: parseInt(headers["content-length"] || "0", 10),
            source: "response-image",
          });
        } catch (error) {
          // Ignore single response parsing failures.
        }
        return;
      }

      const responseUrlLower = url.toLowerCase();
      const shouldInspectText =
        contentType.includes("application/json") ||
        contentType.includes("text/json") ||
        (contentType.includes("javascript") &&
          /share|template|design|page|preview|render/.test(responseUrlLower));

      if (!shouldInspectText) {
        return;
      }

      try {
        const text = await response.text();
        extractChuangkitImageUrlsFromText(text).forEach((candidateUrl) => {
          captureCandidate(candidateUrl, {
            size: parseInt(headers["content-length"] || "0", 10),
            source: "response-text",
            scoreBoost: 120,
          });
        });
      } catch (error) {
        // Ignore text response parsing failures.
      }
    });

    console.log("🌐 正在加载创客贴页面并拦截图片请求...");
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);
    await collectInlineCandidates("page-content-initial", 140);

    const initialDomCandidates = await collectChuangkitDomCandidates(page);
    initialDomCandidates.forEach((candidate, index) => {
      captureCandidate(candidate.url, {
        source: "dom-initial",
        scoreBoost: 180,
        pageHint: candidate.pageHint,
        domIndex: index,
      });
    });

    const traversedGalleryCount = await traverseChuangkitGallery(page);
    if (traversedGalleryCount > 1) {
      console.log(`🖼️ 尝试遍历创客贴套图缩略图: ${traversedGalleryCount} 个候选页`);
      await page.waitForTimeout(1800);
    }

    const galleryDomCandidates = await collectChuangkitDomCandidates(page);
    galleryDomCandidates.forEach((candidate, index) => {
      captureCandidate(candidate.url, {
        source: "dom-gallery",
        scoreBoost: 220,
        pageHint: candidate.pageHint,
        domIndex: index,
      });
    });

    await page.addStyleTag({
      content: `
        header, nav, .header, .nav, .navbar, .navigation,
        footer, .footer, .bottom, .sidebar, .side-panel,
        .toolbar, .menu, .breadcrumb, .pagination,
        .ck-header, .ck-nav, .ck-toolbar, .ck-sidebar,
        .ck-footer, .ck-menu, .ck-panel, .ck-controls,
        [class*="watermark"], [class*="mark"], [class*="overlay"], [class*="mask"],
        [id*="watermark"], [id*="mark"], [id*="overlay"], [id*="mask"],
        .wm, .copyright, .logo, .brand, .watermark-layer, .mark-layer,
        [class*="logo"], [class*="brand"], [class*="copyright"],
        .preview-mask, .design-mask, .template-mask,
        .ck-watermark, .ck-mask, .ck-overlay, .ck-logo,
        .template-watermark, .design-watermark, .work-watermark,
        [class*="chuangkit"][class*="watermark"],
        [class*="chuangkit"][class*="logo"],
        [class*="chuangkit"][class*="mark"],
        .chuangkit-watermark, .chuangkit-logo, .chuangkit-mark,
        svg[class*="watermark"], svg[class*="logo"], svg[class*="mark"],
        [class*="text-watermark"], [class*="text-mark"],
        .text-overlay, .text-mask {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
          width: 0 !important;
          height: 0 !important;
        }

        .design-content, .work-content, .template-content,
        .preview-content, .canvas-content, .main-design,
        .design-area, .work-area, .canvas-area {
          opacity: 1 !important;
          visibility: visible !important;
          position: relative !important;
          z-index: 9999 !important;
        }

        body { background: transparent !important; }
        .page-bg, .background, .bg { display: none !important; }
      `,
    });

    await page.evaluate(() => {
      const removeKeywords = [
        "header",
        "nav",
        "footer",
        "sidebar",
        "toolbar",
        "menu",
        "watermark",
        "mark",
        "logo",
        "brand",
        "copyright",
        "ui",
        "button",
        "control",
        "panel",
        "overlay",
        "mask",
      ];

      document.querySelectorAll("*").forEach((el) => {
        try {
          let className = "";
          let id = "";
          const tagName = el.tagName ? el.tagName.toLowerCase() : "";

          if (el.className) {
            if (typeof el.className === "string") {
              className = el.className.toLowerCase();
            } else if (el.className.baseVal) {
              className = el.className.baseVal.toLowerCase();
            }
          }

          if (el.id && typeof el.id === "string") {
            id = el.id.toLowerCase();
          }

          const isNonDesignElement = removeKeywords.some(
            (keyword) =>
              className.includes(keyword) ||
              id.includes(keyword) ||
              tagName.includes(keyword)
          );

          if (isNonDesignElement) {
            el.remove();
            return;
          }

          const computedStyle = window.getComputedStyle(el);
          const backgroundImage = computedStyle.backgroundImage;
          if (backgroundImage && backgroundImage !== "none") {
            const bgUrl = backgroundImage.toLowerCase();
            if (removeKeywords.some((keyword) => bgUrl.includes(keyword))) {
              el.style.backgroundImage = "none";
            }
          }

          if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
            const text = (el.textContent || "").toLowerCase();
            if (removeKeywords.some((keyword) => text.includes(keyword))) {
              el.remove();
              return;
            }
          }

          const position = computedStyle.position;
          if (position === "absolute" || position === "fixed") {
            const rect = el.getBoundingClientRect();
            const zIndex = parseInt(computedStyle.zIndex, 10) || 0;
            if (rect.width < 300 && rect.height < 150 && zIndex > 100) {
              el.remove();
            }
          }
        } catch (error) {
          // Ignore cleanup failures.
        }
      });

      document.querySelectorAll("*").forEach((el) => {
        try {
          const computedStyle = window.getComputedStyle(el);
          const opacity = parseFloat(computedStyle.opacity);
          if (opacity > 0 && opacity < 0.3) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 400 && rect.height < 200) {
              el.remove();
            }
          }
        } catch (error) {
          // Ignore cleanup failures.
        }
      });
    });

    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, window.innerHeight / 2);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });

    await page.waitForTimeout(3000);
    await collectInlineCandidates("page-content-post", 160);

    const postCleanupDomCandidates = await collectChuangkitDomCandidates(page);
    postCleanupDomCandidates.forEach((candidate, index) => {
      captureCandidate(candidate.url, {
        source: "dom-post",
        scoreBoost: 220,
        pageHint: candidate.pageHint,
        domIndex: index,
      });
    });

    const orderedImageUrls = buildOrderedChuangkitUrls(capturedImages, [
      ...initialDomCandidates,
      ...galleryDomCandidates,
      ...postCleanupDomCandidates,
    ]);

    if (orderedImageUrls.length > 1) {
      console.log(`✅ 创客贴套图抓取成功，共 ${orderedImageUrls.length} 张`);
      await browser.close();
      return buildChuangkitResult(orderedImageUrls, {
        source: "puppeteer-url",
        quality: "high",
      });
    }

    if (bestDesignImageUrl && maxDesignScore > 1000) {
      console.log(`✅ 网络拦截获取到高质量设计稿 URL (评分:${Math.round(maxDesignScore)})`);
      console.log(`🎯 设计稿 URL: ${bestDesignImageUrl}`);
      await browser.close();
      return buildChuangkitResult([bestDesignImageUrl], {
        source: "puppeteer-url",
        quality: "high",
      });
    }

    const preciseDesignSelectors = [
      ".design-preview-main",
      ".work-preview-main",
      ".template-preview-main",
      ".main-design-container",
      ".design-canvas-main",
      ".work-canvas-main",
      ".design-preview-area",
      ".work-preview-area",
      ".template-preview-area",
      ".preview-main-area",
      ".canvas-preview-area",
      ".design-content-container",
      ".work-content-container",
      ".template-content-container",
      ".main-content-area",
      ".design-canvas-container",
      ".work-canvas-container",
      ".main-canvas-container",
      ".canvas-wrapper-main",
      ".design-main",
      ".work-main",
      ".template-main",
      ".preview-main",
      ".canvas-main",
      ".content-main",
      ".ck-design-main",
      ".ck-work-main",
      ".ck-preview-main",
      ".ck-canvas-main",
      ".ck-content-main",
    ];

    console.log("🎯 开始精确定位设计稿容器...");
    const bestDesignContainer = await page.evaluate((selectors) => {
      function calculateDesignScore(element) {
        const rect = element.getBoundingClientRect();
        const area = rect.width * rect.height;
        let score = area;

        if (rect.width < 200 || rect.height < 200) score -= 2000;
        if (rect.width > 300 && rect.height > 300) score += 1000;
        if (rect.width > 500 && rect.height > 500) score += 2000;

        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const elementCenterX = rect.left + rect.width / 2;
        const elementCenterY = rect.top + rect.height / 2;
        const distanceFromCenter = Math.sqrt(
          Math.pow(elementCenterX - centerX, 2) +
            Math.pow(elementCenterY - centerY, 2)
        );
        score += Math.max(0, 2000 - distanceFromCenter);

        const ratio = rect.width / rect.height;
        if ((ratio > 0.5 && ratio < 0.9) || (ratio > 1.1 && ratio < 2.0)) {
          score += 1500;
        }

        const images = element.querySelectorAll("img");
        const texts = element.querySelectorAll("p, span, h1, h2, h3, h4, h5, div");
        const canvases = element.querySelectorAll("canvas");
        const svgs = element.querySelectorAll("svg");

        score += images.length * 300;
        score += texts.length * 50;
        score += canvases.length * 500;
        score += svgs.length * 400;

        const hasVisibleContent =
          element.offsetWidth > 0 &&
          element.offsetHeight > 0 &&
          (images.length > 0 ||
            texts.length > 0 ||
            canvases.length > 0 ||
            svgs.length > 0);

        if (!hasVisibleContent) score -= 3000;
        return score;
      }

      let bestElement = null;
      let bestScore = 0;
      let bestSelector = null;

      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((el) => {
          if (el.offsetWidth > 0 && el.offsetHeight > 0) {
            const score = calculateDesignScore(el);
            if (score > bestScore) {
              bestScore = score;
              bestElement = el;
              bestSelector = selector;
            }
          }
        });
      }

      if (!bestElement) {
        return null;
      }

      const rect = bestElement.getBoundingClientRect();
      return {
        selector: bestSelector,
        rect: {
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        },
        score: bestScore,
      };
    }, preciseDesignSelectors);

    if (
      bestDesignContainer &&
      bestDesignContainer.rect.width > 200 &&
      bestDesignContainer.rect.height > 200
    ) {
      console.log(`✅ 找到最佳设计稿容器: ${bestDesignContainer.selector}`);
      console.log(
        `📐 容器尺寸: ${bestDesignContainer.rect.width}x${bestDesignContainer.rect.height}`
      );

      try {
        const element = await page.$(bestDesignContainer.selector);
        if (element) {
          await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, bestDesignContainer.selector);

          await page.waitForTimeout(1500);
          const screenshot = await element.screenshot({
            type: "png",
            omitBackground: false,
          });

          const dataUrl = "data:image/png;base64," + screenshot.toString("base64");
          console.log("✅ 成功截图设计稿主容器 (精确定位)");

          await browser.close();
          browser = null;
          return buildChuangkitResult([], {
            source: "puppeteer-screenshot",
            quality: "preview",
            imageUrl: dataUrl,
            thumbnailUrl: bestDesignImageUrl || orderedImageUrls[0] || dataUrl,
          });
        }
      } catch (screenshotError) {
        console.warn("⚠️ 精确截图失败，尝试其他方案:", screenshotError.message);
      }
    }

    if (orderedImageUrls.length > 0) {
      console.log("✅ 使用网络拦截的设计稿 URL 作为回退");
      await browser.close();
      return buildChuangkitResult(orderedImageUrls, {
        source: "puppeteer-url",
        quality: "high",
      });
    }

    console.log("📡 执行最后的 DOM 设计稿扫描...");
    const fallbackImageUrls = await page.evaluate(() => {
      const candidates = [];
      const seen = new Set();
      const imageSelectors = [
        'img[src*="design"]',
        'img[src*="work"]',
        'img[src*="template"]',
        'img[src*="preview"]',
        'img[src*="main"]',
        'img[src*="primary"]',
        'img[src*="chuangkit"]',
        'img[src*="cdn"]',
        '.design-img img',
        '.work-img img',
        '.template-img img',
        '.preview-img img',
        '.main-img img',
        '.canvas-img img',
      ];

      imageSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          const src =
            el.src || el.getAttribute("data-src") || el.getAttribute("data-original");
          if (!src || !src.startsWith("http") || seen.has(src)) {
            return;
          }

          const rect = el.getBoundingClientRect();
          if (rect.width > 200 && rect.height > 200) {
            seen.add(src);
            candidates.push({
              url: src,
              area: rect.width * rect.height,
            });
          }
        });
      });

      candidates.sort((a, b) => b.area - a.area);
      return candidates.map((candidate) => candidate.url);
    });

    await browser.close();

    const mergedFallbackUrls = dedupeChuangkitUrls(fallbackImageUrls);
    if (mergedFallbackUrls.length > 0) {
      console.log(`✅ DOM 回退找到设计稿图片，共 ${mergedFallbackUrls.length} 张`);
      return buildChuangkitResult(mergedFallbackUrls, {
        source: "puppeteer-dom",
        quality: "medium",
      });
    }

    if (browser) {
      await browser.close();
      browser = null;
    }

    console.log("🔁 增强版未命中结果，回退到旧版创客贴抓取...");
    const legacyResult = await scrapeChuangkit(pageUrl);
    if (typeof legacyResult === "string" && legacyResult) {
      if (legacyResult.startsWith("data:image")) {
        return buildChuangkitResult([], {
          source: "legacy-screenshot",
          quality: "preview",
          imageUrl: legacyResult,
          thumbnailUrl: bestDesignImageUrl || legacyResult,
        });
      }

      return buildChuangkitResult([legacyResult], {
        source: "legacy-url",
        quality: "high",
      });
    }

    throw new Error("未找到创客贴设计稿主图");
  } catch (err) {
    console.error("❌ 创客贴精确抓取失败:", err.message);
    throw err;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        // Ignore browser close failures.
      }
    }
  }
}

function extractChuangkitImageUrlsFromText(text) {
  const urls = new Set();
  if (!text) {
    return [];
  }

  const patterns = [
    /https?:\/\/[^"'\\\s>]+\.(?:png|jpe?g|webp)(?:\?[^"'\\\s>]*)?/gi,
    /\/\/[^"'\\\s>]+\.(?:png|jpe?g|webp)(?:\?[^"'\\\s>]*)?/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const rawUrl = pattern === patterns[1] ? `https:${match[0]}` : match[0];
      const normalized = normalizeChuangkitImageUrl(rawUrl);
      if (normalized) {
        urls.add(normalized);
      }
    }
  }

  return Array.from(urls);
}

function scoreChuangkitDesignUrl(url, size = 0) {
  const normalized = normalizeChuangkitImageUrl(url);
  if (!normalized) {
    return Number.NEGATIVE_INFINITY;
  }

  if (isBlockedChuangkitAssetUrl(normalized)) {
    return Number.NEGATIVE_INFINITY;
  }

  const lower = normalized.toLowerCase();
  let score = 0;

  if (size > 200 * 1024) score += Math.min(size / 1024, 2000);
  if (lower.includes("chuangkit.com")) score += 500;
  if (lower.includes("cdn")) score += 200;
  if (lower.includes("svg_build/render_result")) score += 1400;
  if (/render_result|design|work|template|poster|banner/.test(lower)) score += 800;
  if (/preview|main|primary|original|full/.test(lower)) score += 600;
  if (/large|big|hd|high|origin/.test(lower)) score += 400;
  if (/\d{3,4}x\d{3,4}/.test(lower)) score += 300;
  if (/[?&#](?:page|index|sheet|frame|artboard)=\d{1,3}/.test(lower)) score += 180;
  if (/[_/-](?:page|p|index|sheet|frame|artboard)[_-]?\d{1,3}(?:[_./?-]|$)/.test(lower)) {
    score += 150;
  }

  if (/thumb|small|mini|icon|avatar|logo/.test(lower)) score -= 1200;
  if (/watermark|mark|overlay|mask/.test(lower)) score -= 900;
  if (/ui|button|nav|menu|header|footer/.test(lower)) score -= 800;
  if (/analytics|tracking|tracker|pixel|hm\.gif/.test(lower)) score -= 4000;
  if (/\.svg(?:$|\?)/.test(lower) && !/svg_build\/render_result/.test(lower)) {
    score -= 3000;
  }

  if (/\.jpe?g(?:$|\?)/.test(lower)) score += 100;
  if (/\.png(?:$|\?)/.test(lower)) score += 80;
  if (/\.webp(?:$|\?)/.test(lower)) score += 60;

  return score;
}

function extractChuangkitPageHint(url) {
  const normalized = normalizeChuangkitImageUrl(url);
  if (!normalized) {
    return null;
  }

  const patterns = [
    /[?&#](?:page|index|sheet|frame|artboard)=(\d{1,3})/i,
    /[_/-](?:page|p|index|sheet|frame|artboard)[_-]?(\d{1,3})(?:[_./?-]|$)/i,
    /[_/-](\d{1,3})(?=\.(?:png|jpe?g|webp)(?:\?|$))/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}

function dedupeChuangkitUrls(urls) {
  const seen = new Set();
  const result = [];

  for (const url of urls || []) {
    const normalized = normalizeChuangkitImageUrl(url);
    if (!normalized || isBlockedChuangkitAssetUrl(normalized) || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function buildChuangkitPages(imageUrls) {
  return (imageUrls || []).map((imageUrl, index) => ({
    page: index + 1,
    imageUrl,
  }));
}

function buildChuangkitResult(imageUrls, extras = {}) {
  const uniqueUrls = dedupeChuangkitUrls(imageUrls);
  const pages = buildChuangkitPages(uniqueUrls);

  return {
    success: extras.success !== false,
    platform: "Chuangkit",
    ...extras,
    imageUrl: uniqueUrls[0] || extras.imageUrl || null,
    thumbnailUrl: extras.thumbnailUrl || uniqueUrls[0] || extras.imageUrl || null,
    imageUrls: uniqueUrls,
    images: uniqueUrls,
    pages,
    pageCount: uniqueUrls.length,
    isMultiPage: uniqueUrls.length > 1,
  };
}

function buildOrderedChuangkitUrls(capturedImages, domCandidates = []) {
  const ordered = [];
  const seen = new Set();

  const push = (rawUrl) => {
    const normalized = normalizeChuangkitImageUrl(rawUrl);
    if (!normalized || isBlockedChuangkitAssetUrl(normalized) || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    ordered.push(normalized);
  };

  (domCandidates || [])
    .slice()
    .sort((a, b) => {
      const aPage = Number.isFinite(a.pageHint) ? a.pageHint : Number.MAX_SAFE_INTEGER;
      const bPage = Number.isFinite(b.pageHint) ? b.pageHint : Number.MAX_SAFE_INTEGER;
      if (aPage !== bPage) {
        return aPage - bPage;
      }

      const aIndex = Number.isFinite(a.domIndex) ? a.domIndex : Number.MAX_SAFE_INTEGER;
      const bIndex = Number.isFinite(b.domIndex) ? b.domIndex : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    })
    .forEach((candidate) => {
      const normalized = normalizeChuangkitImageUrl(candidate && candidate.url);
      if (!normalized) {
        return;
      }

      const captured = capturedImages.get(normalized);
      if (!captured && scoreChuangkitDesignUrl(normalized) < 1000) {
        return;
      }

      push(normalized);
    });

  Array.from(capturedImages.values())
    .filter((item) => item.score >= 900)
    .sort((a, b) => {
      const aPage = Number.isFinite(a.pageHint) ? a.pageHint : Number.MAX_SAFE_INTEGER;
      const bPage = Number.isFinite(b.pageHint) ? b.pageHint : Number.MAX_SAFE_INTEGER;
      if (aPage !== bPage) {
        return aPage - bPage;
      }

      const aIndex = Number.isFinite(a.domIndex) ? a.domIndex : Number.MAX_SAFE_INTEGER;
      const bIndex = Number.isFinite(b.domIndex) ? b.domIndex : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }

      if (a.score !== b.score) {
        return b.score - a.score;
      }

      if (a.order !== b.order) {
        return a.order - b.order;
      }

      return 0;
    })
    .forEach((item) => push(item.url));

  return ordered;
}

async function collectChuangkitDomCandidates(page) {
  return page.evaluate(() => {
    const results = [];
    const seen = new Set();

    const normalizeUrl = (value) => {
      if (typeof value !== "string") {
        return null;
      }

      const normalized = value.trim().replace(/\\/g, "/");
      if (!normalized) {
        return null;
      }

      if (normalized.startsWith("//")) {
        return `https:${normalized}`;
      }

      return normalized;
    };

    const scoreUrl = (value) => {
      const lower = String(value || "").toLowerCase();
      let score = 0;
      if (lower.includes("svg_build/render_result")) score += 10;
      if (/render_result|design|work|template|preview|poster|banner/.test(lower)) score += 6;
      if (/thumb|small|mini|icon|avatar|logo|watermark|mask/.test(lower)) score -= 12;
      return score;
    };

    const findPageHint = (element) => {
      let current = element;
      while (current && current !== document.body) {
        const attrs = [
          "data-page",
          "data-index",
          "data-page-index",
          "data-page-number",
          "data-slide-index",
        ];

        for (const attr of attrs) {
          const raw = current.getAttribute && current.getAttribute(attr);
          if (/^\d+$/.test(String(raw || ""))) {
            return Number(raw);
          }
        }

        const text = (current.textContent || "").trim();
        const match = text.match(/(?:第\s*)?(\d{1,3})(?:\s*页)?/);
        if (match) {
          return Number(match[1]);
        }

        current = current.parentElement;
      }

      return null;
    };

    const add = (rawUrl, element, domIndex, selector) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) {
        return;
      }

      const normalized = normalizeUrl(rawUrl);
      if (
        !normalized ||
        !/^https?:\/\//i.test(normalized) ||
        seen.has(normalized) ||
        scoreUrl(normalized) < 3
      ) {
        return;
      }

      seen.add(normalized);
      results.push({
        url: normalized,
        selector,
        domIndex,
        pageHint: findPageHint(element),
      });
    };

    const selectors = [
      '[class*="thumb"] img',
      '[class*="thumbnail"] img',
      '[class*="page"] img',
      '[class*="preview"] img',
      '[class*="slide"] img',
      '[data-page] img',
      '[data-index] img',
      'img[src*="render_result"]',
      'img[data-src*="render_result"]',
      '[style*="render_result"]',
      '[style*="background-image"]',
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element, index) => {
        const urls = [
          element.getAttribute && element.getAttribute("src"),
          element.getAttribute && element.getAttribute("data-src"),
          element.getAttribute && element.getAttribute("data-original"),
          element.getAttribute && element.getAttribute("data-preview"),
          element.getAttribute && element.getAttribute("data-image"),
          element.src,
        ];

        const styleValue =
          (element.getAttribute && element.getAttribute("style")) ||
          window.getComputedStyle(element).backgroundImage ||
          "";
        const styleMatch = styleValue.match(/url\(["']?([^"')]+)["']?\)/i);
        if (styleMatch && styleMatch[1]) {
          urls.push(styleMatch[1]);
        }

        urls.forEach((value) => add(value, element, index, selector));
      });
    });

    return results;
  });
}

async function traverseChuangkitGallery(page) {
  return page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const seen = new Set();
    const candidates = [];

    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 24 &&
        rect.height > 24 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    };

    const shouldKeep = (element) => {
      if (!isVisible(element)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width > 480 || rect.height > 480) {
        return false;
      }

      const text = `${element.className || ""} ${element.id || ""} ${element.textContent || ""}`.toLowerCase();
      return (
        /thumb|thumbnail|page|preview|slide|list|item|页/.test(text) ||
        Boolean(element.querySelector("img"))
      );
    };

    const selectors = [
      '[class*="thumb"]',
      '[class*="thumbnail"]',
      '[class*="page-item"]',
      '[class*="page"] [role="button"]',
      '[class*="slide"]',
      '[data-page]',
      '[data-index]',
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (!shouldKeep(element)) {
          return;
        }

        const rect = element.getBoundingClientRect();
        const key = [
          selector,
          element.getAttribute("data-page") || "",
          element.getAttribute("data-index") || "",
          element.getAttribute("aria-label") || "",
          (element.textContent || "").trim().slice(0, 20),
          Math.round(rect.top),
          Math.round(rect.left),
        ].join("|");

        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        candidates.push(element);
      });
    });

    if (candidates.length <= 1) {
      return 0;
    }

    let clicked = 0;
    for (const element of candidates.slice(0, 12)) {
      try {
        element.scrollIntoView({ block: "center", inline: "center" });
        await wait(250);
        element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        element.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
        element.dispatchEvent(
          new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
        element.click();
        clicked += 1;
        await wait(900);
      } catch (error) {
        // Ignore single thumbnail click failures.
      }
    }

    return clicked;
  });
}

/**
 * 创客贴页面抓取优化 - 专门针对设计稿主图精确提取
 * 目标：抓取纯净的设计稿主图，而不是整个页面截图
 * 策略：
 * 1. 网络请求拦截 - 直接获取设计稿图片URL
 * 2. 精确元素定位 - 准确找到设计稿容器
 * 3. 智能边界检测 - 自动裁剪空白区域
 * 4. 内容区域评分 - 选择最佳的设计稿区域
 */
async function scrapeChuangkit(pageUrl) {
  let browser;
  try {
    console.log("🧩 开始创客贴精确设计稿抓取:", pageUrl);

    browser = await launchBrowser({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor", // 提高截图质量
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      Referer: "https://www.chuangkit.com/",
      Origin: "https://www.chuangkit.com"
    });

    // 🎯 策略1: 网络请求拦截 - 捕获设计稿图片URL
    let bestDesignImageUrl = null;
    let maxDesignScore = 0;
    const capturedImages = new Map();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.on("response", async (response) => {
      const url = response.url();
      const headers = response.headers();
      const contentType = headers["content-type"] || "";

      // 专门针对创客贴设计稿图片的评分系统
      if (contentType.startsWith("image/")) {
        try {
          const size = parseInt(headers["content-length"] || "0");
          let score = 0;

          // 基础分数：文件大小 (设计稿通常较大)
          if (size > 200 * 1024) score += Math.min(size / 1024, 2000); // 最高2000分

          const urlLower = url.toLowerCase();

          // 创客贴设计稿特征加分
          if (urlLower.includes("chuangkit.com")) score += 500;
          if (urlLower.includes("cdn")) score += 200;

          // 设计稿关键词强加分
          if (/design|work|template|poster|banner/.test(urlLower)) score += 800;
          if (/preview|main|primary|original|full/.test(urlLower)) score += 600;
          if (/large|big|hd|high|origin/.test(urlLower)) score += 400;

          // 设计稿尺寸特征加分
          if (/\d{3,4}x\d{3,4}/.test(urlLower)) score += 300; // 包含尺寸信息
          if (/[_-]\d{3,4}[_-]/.test(urlLower)) score += 200; // 尺寸标识

          // 严厉惩罚非设计稿内容
          if (/thumb|small|mini|icon|avatar|logo/.test(urlLower)) score -= 1000;
          if (/ui|button|nav|menu|header|footer/.test(urlLower)) score -= 800;
          if (/watermark|mark|brand/.test(urlLower)) score -= 600;

          // 文件格式偏好 (设计稿常用格式)
          if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) score += 100;
          if (urlLower.endsWith('.png')) score += 80;
          if (urlLower.endsWith('.webp')) score += 60;

          if (score > maxDesignScore && size > 100 * 1024) {
            console.log(`🎨 发现设计稿候选: ${Math.round(size / 1024)}KB, 评分:${score}`);
            console.log(`   URL: ${url.substring(0, 100)}...`);
            maxDesignScore = score;
            bestDesignImageUrl = url;
            capturedImages.set(url, { score, size });
          }
        } catch (e) {
          // 忽略单个响应处理错误
        }
      }
    });

    console.log("🌐 正在加载创客贴页面并拦截图片请求...");
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    // 【增强版】注入高级样式：隐藏所有非设计稿内容和水印
    await page.addStyleTag({
      content: `
        /* 隐藏页面UI元素 */
        header, nav, .header, .nav, .navbar, .navigation,
        footer, .footer, .bottom, .sidebar, .side-panel,
        .toolbar, .menu, .breadcrumb, .pagination,
        /* 隐藏创客贴特有的UI */
        .ck-header, .ck-nav, .ck-toolbar, .ck-sidebar,
        .ck-footer, .ck-menu, .ck-panel, .ck-controls,
        /* 【强化】隐藏水印和遮罩 - 更全面的选择器 */
        [class*="watermark"], [class*="mark"], [class*="overlay"], [class*="mask"],
        [id*="watermark"], [id*="mark"], [id*="overlay"], [id*="mask"],
        .wm, .copyright, .logo, .brand, .watermark-layer, .mark-layer,
        [class*="logo"], [class*="brand"], [class*="copyright"],
        .preview-mask, .design-mask, .template-mask,
        .ck-watermark, .ck-mask, .ck-overlay, .ck-logo,
        .template-watermark, .design-watermark, .work-watermark,
        /* 创客贴特定水印 */
        [class*="chuangkit"][class*="watermark"],
        [class*="chuangkit"][class*="logo"],
        [class*="chuangkit"][class*="mark"],
        .chuangkit-watermark, .chuangkit-logo, .chuangkit-mark,
        /* 图怪兽特定水印 */
        [class*="tuguaishou"], [class*="818ps"], [class*="guais"],
        .tgs-watermark, .tgs-logo, .ps818-watermark,
        /* SVG水印 */
        svg[class*="watermark"], svg[class*="logo"], svg[class*="mark"],
        /* 文字水印 */
        [class*="text-watermark"], [class*="text-mark"],
        .text-overlay, .text-mask {
          display: none !important; 
          opacity: 0 !important; 
          visibility: hidden !important;
          pointer-events: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        
        /* 确保设计稿内容突出显示 */
        .design-content, .work-content, .template-content,
        .preview-content, .canvas-content, .main-design,
        .design-area, .work-area, .canvas-area {
          opacity: 1 !important;
          visibility: visible !important;
          position: relative !important;
          z-index: 9999 !important;
        }
        
        /* 移除页面背景，突出设计稿 */
        body { background: transparent !important; }
        .page-bg, .background, .bg { display: none !important; }
      `,
    });

    // 【增强版】执行高级JavaScript清理和内容识别
    await page.evaluate(() => {
      // 移除所有非设计稿相关元素
      const removeKeywords = [
        'header', 'nav', 'footer', 'sidebar', 'toolbar', 'menu',
        'watermark', 'mark', 'logo', 'brand', 'copyright', 'ui',
        'button', 'control', 'panel', 'overlay', 'mask',
        // 【新增】创客贴和图怪兽特定关键词
        'chuangkit', 'tuguaishou', '818ps', 'guais', 'tgs', 'ps818'
      ];

      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        try {
          // 安全获取元素信息
          let className = '';
          let id = '';
          let tagName = el.tagName ? el.tagName.toLowerCase() : '';

          if (el.className) {
            if (typeof el.className === 'string') {
              className = el.className.toLowerCase();
            } else if (el.className.baseVal) {
              className = el.className.baseVal.toLowerCase();
            }
          }

          if (el.id && typeof el.id === 'string') {
            id = el.id.toLowerCase();
          }

          // 检查是否为非设计稿元素
          const isNonDesignElement = removeKeywords.some(keyword =>
            className.includes(keyword) ||
            id.includes(keyword) ||
            tagName.includes(keyword)
          );

          if (isNonDesignElement) {
            // 【强化】直接移除而不是隐藏
            el.remove();
            return;
          }

          // 特别处理背景图片
          const computedStyle = window.getComputedStyle(el);
          const backgroundImage = computedStyle.backgroundImage;
          if (backgroundImage && backgroundImage !== 'none') {
            const bgUrl = backgroundImage.toLowerCase();
            if (removeKeywords.some(keyword => bgUrl.includes(keyword))) {
              el.style.backgroundImage = 'none';
            }
          }

          // 【新增】检查文本内容是否为水印文字
          if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
            const text = el.textContent.toLowerCase();
            if (removeKeywords.some(k => text.includes(k))) {
              el.remove();
              return;
            }
          }

          // 【新增】移除高z-index的小元素（通常是水印）
          const position = computedStyle.position;
          if (position === 'absolute' || position === 'fixed') {
            const rect = el.getBoundingClientRect();
            const zIndex = parseInt(computedStyle.zIndex) || 0;
            // 小尺寸 + 高z-index = 水印
            if (rect.width < 300 && rect.height < 150 && zIndex > 100) {
              el.remove();
            }
          }
        } catch (e) {
          // 忽略处理错误
        }
      });

      // 【新增】三次清理：移除所有透明度很低的元素（可能是隐藏的水印）
      document.querySelectorAll('*').forEach(el => {
        try {
          const cs = window.getComputedStyle(el);
          const opacity = parseFloat(cs.opacity);
          if (opacity > 0 && opacity < 0.3) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 400 && rect.height < 200) {
              el.remove();
            }
          }
        } catch (e) { }
      });
    });

    // 滚动页面确保所有内容加载
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 缓慢滚动，触发懒加载
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, window.innerHeight / 2);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    // 等待图片加载完成
    await page.waitForTimeout(3000);

    // 🎯 策略2: 如果拦截到高质量设计稿URL，直接返回
    if (bestDesignImageUrl && maxDesignScore > 1000) {
      console.log(`✅ 网络拦截获取到高质量设计稿URL (评分:${maxDesignScore})`);
      console.log(`🎨 设计稿URL: ${bestDesignImageUrl}`);
      await browser.close();
      return bestDesignImageUrl;
    }

    // 🎯 策略3: 精确元素定位 - 创客贴设计稿容器选择器 (按精确度排序)
    const preciseDesignSelectors = [
      // 最精确的设计稿容器
      '.design-preview-main',
      '.work-preview-main',
      '.template-preview-main',
      '.main-design-container',
      '.design-canvas-main',
      '.work-canvas-main',

      // 设计稿预览区域
      '.design-preview-area',
      '.work-preview-area',
      '.template-preview-area',
      '.preview-main-area',
      '.canvas-preview-area',

      // 设计稿内容容器
      '.design-content-container',
      '.work-content-container',
      '.template-content-container',
      '.main-content-area',

      // Canvas和画布相关
      '.design-canvas-container',
      '.work-canvas-container',
      '.main-canvas-container',
      '.canvas-wrapper-main',

      // 通用但可能包含设计稿的容器
      '.design-main', '.work-main', '.template-main',
      '.preview-main', '.canvas-main', '.content-main',

      // 创客贴特有容器
      '.ck-design-main', '.ck-work-main', '.ck-preview-main',
      '.ck-canvas-main', '.ck-content-main'
    ];

    console.log("🎯 开始精确定位设计稿容器...");

    // 🎯 策略4: 智能容器评分和选择
    const bestDesignContainer = await page.evaluate((selectors) => {
      function calculateDesignScore(element) {
        const rect = element.getBoundingClientRect();
        const area = rect.width * rect.height;

        // 基础分数：面积 (设计稿应该有合理的尺寸)
        let score = area;

        // 尺寸合理性检查 (设计稿通常有一定的最小尺寸)
        if (rect.width < 200 || rect.height < 200) score -= 2000; // 严重扣分
        if (rect.width > 300 && rect.height > 300) score += 1000;
        if (rect.width > 500 && rect.height > 500) score += 2000;

        // 位置评分：居中的元素更可能是主设计稿
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const elementCenterX = rect.left + rect.width / 2;
        const elementCenterY = rect.top + rect.height / 2;

        const distanceFromCenter = Math.sqrt(
          Math.pow(elementCenterX - centerX, 2) +
          Math.pow(elementCenterY - centerY, 2)
        );

        // 距离中心越近，分数越高
        score += Math.max(0, 2000 - distanceFromCenter);

        // 宽高比评分：常见设计稿比例
        const ratio = rect.width / rect.height;
        if ((ratio > 0.5 && ratio < 0.9) || (ratio > 1.1 && ratio < 2.0)) {
          score += 1500; // 常见设计稿比例
        }

        // 内容密度评分：检查是否包含实际内容
        const images = element.querySelectorAll('img');
        const texts = element.querySelectorAll('p, span, h1, h2, h3, h4, h5, div');
        const canvases = element.querySelectorAll('canvas');
        const svgs = element.querySelectorAll('svg');

        score += images.length * 300; // 图片内容加分
        score += texts.length * 50;   // 文本内容加分
        score += canvases.length * 500; // Canvas内容高分
        score += svgs.length * 400;   // SVG内容高分

        // 检查是否为空容器
        const hasVisibleContent = element.offsetWidth > 0 &&
          element.offsetHeight > 0 &&
          (images.length > 0 || texts.length > 0 || canvases.length > 0 || svgs.length > 0);

        if (!hasVisibleContent) score -= 3000; // 空容器严重扣分

        return score;
      }

      let bestElement = null;
      let bestScore = 0;
      let bestSelector = null;

      // 遍历所有选择器，找到最佳的设计稿容器
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (el.offsetWidth > 0 && el.offsetHeight > 0) {
            const score = calculateDesignScore(el);
            if (score > bestScore) {
              bestScore = score;
              bestElement = el;
              bestSelector = selector;
            }
          }
        });
      }

      if (bestElement) {
        const rect = bestElement.getBoundingClientRect();
        return {
          selector: bestSelector,
          rect: {
            x: Math.max(0, rect.x),
            y: Math.max(0, rect.y),
            width: Math.ceil(rect.width),
            height: Math.ceil(rect.height)
          },
          score: bestScore,
          hasContent: bestElement.children.length > 0
        };
      }

      return null;
    }, preciseDesignSelectors);

    // 🎯 策略5: 精确截图设计稿容器
    if (bestDesignContainer && bestDesignContainer.rect.width > 200 && bestDesignContainer.rect.height > 200) {
      console.log(`✅ 找到最佳设计稿容器: ${bestDesignContainer.selector}`);
      console.log(`📐 容器尺寸: ${bestDesignContainer.rect.width}x${bestDesignContainer.rect.height}`);
      console.log(`📊 容器评分: ${bestDesignContainer.score}`);

      try {
        const element = await page.$(bestDesignContainer.selector);
        if (element) {
          // 确保元素在视窗内
          await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, bestDesignContainer.selector);

          await page.waitForTimeout(1500); // 等待滚动完成

          // 🎯 策略6: 智能边界检测和裁剪
          const screenshot = await element.screenshot({
            type: "png",
            omitBackground: false,
          });

          const dataUrl = "data:image/png;base64," + screenshot.toString("base64");
          console.log("✅ 成功截图设计稿主容器 (精确定位)");

          await browser.close();
          return dataUrl;
        }
      } catch (screenshotError) {
        console.warn("⚠️ 精确截图失败，尝试其他方法:", screenshotError.message);
      }
    }

    // 🎯 策略7: 回退到网络拦截的最佳图片
    if (bestDesignImageUrl) {
      console.log("✅ 使用网络拦截的设计稿URL作为回退");
      await browser.close();
      return bestDesignImageUrl;
    }

    // 🎯 策略8: 最后的DOM回退
    console.log("🔍 执行最后的DOM设计稿查找...");
    const fallbackImageUrl = await page.evaluate(() => {
      const candidates = [];

      // 查找所有可能的设计稿图片
      const imageSelectors = [
        'img[src*="design"]', 'img[src*="work"]', 'img[src*="template"]',
        'img[src*="preview"]', 'img[src*="main"]', 'img[src*="primary"]',
        'img[src*="chuangkit"]', 'img[src*="cdn"]',
        '.design-img img', '.work-img img', '.template-img img',
        '.preview-img img', '.main-img img', '.canvas-img img'
      ];

      imageSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          const src = el.src || el.getAttribute('data-src') || el.getAttribute('data-original');
          if (src && src.startsWith('http')) {
            const rect = el.getBoundingClientRect();
            // 只选择有合理尺寸的图片
            if (rect.width > 200 && rect.height > 200) {
              candidates.push({
                url: src,
                area: rect.width * rect.height,
                width: rect.width,
                height: rect.height
              });
            }
          }
        });
      });

      // 按面积排序，选择最大的图片
      candidates.sort((a, b) => b.area - a.area);

      return candidates.length > 0 ? candidates[0].url : null;
    });

    await browser.close();

    if (fallbackImageUrl) {
      console.log("✅ DOM回退找到设计稿图片:", fallbackImageUrl);
      return fallbackImageUrl;
    }

    throw new Error("未找到创客贴设计稿主图");

  } catch (err) {
    console.error("❌ 创客贴精确抓取失败:", err.message);
    throw err;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // 忽略关闭浏览器的错误
      }
    }
  }
}
