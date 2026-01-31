// server/services/browser.js
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

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
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    browser = await puppeteer.launch(launchOptions);

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
    if (executablePath) launchOptions.executablePath = executablePath;
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // 注入样式与脚本：移除水印层与含水印的背景/图片
    await page.addStyleTag({
      content: `
      [class*="watermark"], [id*="watermark"], .watermark, .wm, .wm-layer, .wm-text,
      .logo-watermark, .logoLayer, .mark, .mark-text, .preview-watermark { display:none !important; opacity:0 !important; visibility:hidden !important; }
    `,
    });
    await page.evaluate(() => {
      const keywords = [
        "watermark",
        "logo",
        "mark",
        "tuguaishou",
        "818ps",
        "guais",
      ];
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
    if (executablePath) launchOptions.executablePath = executablePath;
    browser = await puppeteer.launch(launchOptions);
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
  scrapeChuangkit,
};

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

    browser = await puppeteer.launch({
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

    // 注入高级样式：隐藏所有非设计稿内容
    await page.addStyleTag({
      content: `
        /* 隐藏页面UI元素 */
        header, nav, .header, .nav, .navbar, .navigation,
        footer, .footer, .bottom, .sidebar, .side-panel,
        .toolbar, .menu, .breadcrumb, .pagination,
        /* 隐藏创客贴特有的UI */
        .ck-header, .ck-nav, .ck-toolbar, .ck-sidebar,
        .ck-footer, .ck-menu, .ck-panel, .ck-controls,
        /* 隐藏水印和遮罩 */
        [class*="watermark"], [class*="mark"], [class*="overlay"], [class*="mask"],
        .wm, .copyright, .logo, .brand, .watermark-layer, .mark-layer,
        [class*="logo"], [class*="brand"], [class*="copyright"],
        .preview-mask, .design-mask, .template-mask,
        .ck-watermark, .ck-mask, .ck-overlay, .ck-logo,
        .template-watermark, .design-watermark, .work-watermark {
          display: none !important; 
          opacity: 0 !important; 
          visibility: hidden !important;
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

    // 执行高级JavaScript清理和内容识别
    await page.evaluate(() => {
      // 移除所有非设计稿相关元素
      const removeKeywords = [
        'header', 'nav', 'footer', 'sidebar', 'toolbar', 'menu',
        'watermark', 'mark', 'logo', 'brand', 'copyright', 'ui',
        'button', 'control', 'panel', 'overlay', 'mask'
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
            el.style.display = 'none';
            el.style.opacity = '0';
            el.style.visibility = 'hidden';
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
        } catch (e) {
          // 忽略处理错误
        }
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
