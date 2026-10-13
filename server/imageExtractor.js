/**
 * 图片提取服务 - 真实图片URL提取
 * 架构级优化版本，集成 Puppeteer 隐身模式应对反爬虫
 * 流程：第三方 API (80%) -> 本地网页抓取 (10%) -> Puppeteer 隐身抓取 (10%) -> 抛错
 */

const axios = require("axios");
const cheerio = require("cheerio");
const qs = require("querystring");
const { extractViaThirdPartyAPIWithCache } = require("./thirdPartyApiGateway");
const { extract818ps } = require("./extractors/818ps");
const { extractGaoding } = require("./extractors/gaoding");
const { extractHuaban } = require("./extractors/huaban");
const {
  scrapeWithBrowser,
  scrape818ps,
  scrapeCanva,
  scrapeDouyin,
  scrapeXiaohongshu,
  scrapeChuangkit,
} = require("./services/browser");

// 通用请求头
const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

// 针对 tuguaishou/818ps 的图片 URL 做无水印变体尝试
function buildNoWatermarkVariants(url) {
  const variants = new Set();
  if (!url || typeof url !== "string") return [];
  const u = url.split("?")[0];
  const query = url.includes("?") ? url.substring(url.indexOf("?")) : "";

  // 去除尾部强制尺寸/样式后缀（如 !l1000_b, !l2000, !small 等）
  variants.add(u.replace(/!l\d+(_b)?$/i, ""));
  variants.add(u.replace(/!\w+$/i, ""));

  // 替换预览路径到可能的原图路径
  variants.add(u.replace(/ips_user_preview_api\//, "pic/"));
  variants.add(u.replace(/user_preview_ue\//, "pic/"));
  variants.add(u.replace(/preview/gi, "origin"));
  variants.add(u.replace(/psd_import\//, "pic/"));

  // 统一扩展名尝试（png/jpg/webp/jpeg）
  const base = u.replace(/\.(jpeg|jpg|png|webp)(!.*)?$/i, "");
  [".png", ".jpg", ".jpeg", ".webp"].forEach((ext) => variants.add(base + ext));

  // 恢复查询参数（某些服务需要 auth_key）
  const withQuery = Array.from(variants).map((v) => (query ? v + query : v));
  return [...variants, ...withQuery];
}

// 针对 Canva 的图片 URL 做无水印与高清变体尝试
function buildCanvaNoWatermarkVariants(url) {
  const variants = new Set();
  if (!url || typeof url !== "string") return [];
  const u = url.split("?")[0];
  const query = url.includes("?") ? url.substring(url.indexOf("?")) : "";

  // 去除可能的裁剪/尺寸参数标记
  variants.add(u.replace(/-(?:\d+x\d+)|\?[^#]*$/i, ""));
  // 常见静态资源替换，例如缩略图到原图
  variants.add(u.replace(/thumbnail|thumb|small/gi, "original"));
  variants.add(u.replace(/preview/gi, "original"));

  // 扩展名尝试
  const base = u.replace(/\.(jpeg|jpg|png|webp)(?:\?.*)?$/i, "");
  [".png", ".jpg", ".jpeg", ".webp"].forEach((ext) => variants.add(base + ext));

  const withQuery = Array.from(variants).map((v) => (query ? v + query : v));
  return [...variants, ...withQuery];
}

function isChuangkitTarget(url, platform) {
  return (
    String(url || "").includes("chuangkit.com") ||
    platform === "Chuangkit" ||
    platform === "创客贴"
  );
}

function isHuabanTarget(url, platform) {
  const normalizedUrl = String(url || "").toLowerCase();
  const normalizedPlatform = String(platform || "").toLowerCase();

  return (
    normalizedPlatform === "huaban" ||
    normalizedUrl.includes("huaban.com") ||
    normalizedUrl.includes("api.huaban.com") ||
    normalizedUrl.includes("huabanimg.com")
  );
}

function normalizeChuangkitCandidateUrl(url) {
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

function scoreChuangkitCandidateUrl(url) {
  const normalized = normalizeChuangkitCandidateUrl(url);
  if (!normalized) {
    return Number.NEGATIVE_INFINITY;
  }

  const lower = normalized.toLowerCase();
  let score = 0;

  if (lower.includes("chuangkit.com")) score += 200;
  if (lower.includes("cdn")) score += 100;
  if (lower.includes("svg_build/render_result")) score += 900;
  if (/render_result|design|work|template|poster|banner/.test(lower)) score += 450;
  if (/preview|main|primary|original|full/.test(lower)) score += 200;

  if (/thumb|small|mini|icon|avatar|logo/.test(lower)) score -= 900;
  if (/watermark|mask|overlay|mark/.test(lower)) score -= 600;

  if (/\.jpe?g(?:$|\?)/.test(lower)) score += 40;
  if (/\.png(?:$|\?)/.test(lower)) score += 30;
  if (/\.webp(?:$|\?)/.test(lower)) score += 20;

  return score;
}

function dedupeChuangkitUrls(urls) {
  const seen = new Set();
  const result = [];

  for (const rawUrl of urls || []) {
    const normalized = normalizeChuangkitCandidateUrl(rawUrl);
    if (!normalized || seen.has(normalized)) {
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

// 简单重试辅助，带指数回退
async function retry(fn, attempts = 3, initialDelay = 500) {
  let err;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      const delay = initialDelay * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw err;
}

// 从 html/text 中尝试解析出图片 URL 的通用函数
function extractImageUrlsFromText(text) {
  const urls = new Set();
  if (!text) return [];
  // 正则匹配常见图片URL（literal 正则，注意对斜杠的处理）
  const re = /https?:\/\/[^"'\\s>]+\.(?:png|jpe?g|webp|gif)(?:\?[^"'\\s>]*)?/gi;
  let m;
  while ((m = re.exec(text))) {
    // 将反斜杠统一替换为正斜杠
    urls.add(m[0].replace(/\\/g, "/"));
  }

  // 也尝试匹配以 // 开头的协议相对 URL（例如 //cdn.example.com/xxx.png）
  const re2 = /\/\/[^"'\\s>]+\.(?:png|jpe?g|webp|gif)(?:\?[^"'\\s>]*)?/gi;
  while ((m = re2.exec(text))) {
    urls.add("https:" + m[0]);
  }

  return Array.from(urls);
}

// 第三方去水印服务（作为兜底）
const THIRD_PARTY_BASE = "https://kk.tsgpt.top/tgs/info/?token=OflDpfIKZrH8";

async function callThirdPartyService(targetUrl) {
  try {
    console.log("🔁 试用第三方去水印服务作为兜底:", targetUrl);

    // 1) 尝试 GET 查询方式
    try {
      const getUrl = `${THIRD_PARTY_BASE}&url=${encodeURIComponent(targetUrl)}`;
      const resp = await axios.get(getUrl, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; remover/1.0)",
          Accept: "application/json",
        },
      });

      if (resp && resp.data) {
        const data = resp.data;
        // 兼容多种返回格式
        const maybe =
          data.image ||
          data.imageUrl ||
          data.url ||
          data.data?.image ||
          data.data?.imageUrl ||
          data.data?.url;
        if (maybe && typeof maybe === "string") {
          console.log("✅ 第三方服务返回图片URL (GET):", maybe);
          return {
            imageUrl: maybe,
            platform: "third-party",
            source: "third-party-get",
          };
        }
      }
    } catch (err) {
      console.warn("⚠️ 第三方 GET 调用失败:", err.message);
    }

    // 2) 尝试 POST JSON 方式
    try {
      const resp2 = await axios.post(
        THIRD_PARTY_BASE,
        { url: targetUrl },
        {
          timeout: 10000,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; remover/1.0)",
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (resp2 && resp2.data) {
        const data = resp2.data;
        const maybe =
          data.image ||
          data.imageUrl ||
          data.url ||
          data.data?.image ||
          data.data?.imageUrl ||
          data.data?.url;
        if (maybe && typeof maybe === "string") {
          console.log("✅ 第三方服务返回图片URL (POST):", maybe);
          return {
            imageUrl: maybe,
            platform: "third-party",
            source: "third-party-post",
          };
        }
      }
    } catch (err) {
      console.warn("⚠️ 第三方 POST 调用失败:", err.message);
    }

    console.log("❌ 第三方服务未返回有效图片URL");
    return null;
  } catch (error) {
    console.error("❌ 调用第三方服务异常:", error.message);
    return null;
  }
}

/**
 * 验证图片URL是否可访问
 */
async function validateImageUrl(imageUrl) {
  try {
    console.log("🔍 验证图片URL:", imageUrl);
    // 根据域名设置 Referer/Origin，避免 403
    let referer = "https://818ps.com/";
    let origin = "https://818ps.com";
    try {
      const u = new URL(imageUrl);
      if (u.hostname.includes("tuguaishou.com")) {
        referer = "https://tuguaishou.com/";
        origin = "https://tuguaishou.com";
      } else if (u.hostname.includes("chuangkit.com")) {
        referer = "https://www.chuangkit.com/";
        origin = "https://www.chuangkit.com";
      }
    } catch { }
    // 先尝试 HEAD 请求；若失败则使用带 Range 的 GET 请求读取最小字节做探测（比完整流更节省）
    try {
      const headResp = await retry(
        () =>
          axios.head(imageUrl, {
            timeout: 8000,
            headers: {
              ...COMMON_HEADERS,
              Accept: "image/*",
              Referer: referer,
              Origin: origin,
            },
          }),
        2,
        300
      );
      const ok =
        headResp && (headResp.status === 200 || headResp.status === 206);
      if (ok) {
        console.log("✅ 图片URL通过HEAD验证");
        return true;
      }
    } catch (headErr) {
      // 忽略，尝试 Range GET
    }

    try {
      const getResp = await retry(
        () =>
          axios.get(imageUrl, {
            timeout: 8000,
            responseType: "arraybuffer",
            headers: {
              ...COMMON_HEADERS,
              Range: "bytes=0-0",
              Referer: referer,
              Origin: origin,
            },
          }),
        2,
        300
      );

      const ok = getResp && (getResp.status === 200 || getResp.status === 206);
      console.log(
        ok ? "✅ 图片URL通过Range GET验证" : "❌ 图片URL无效 (Range GET)"
      );
      return ok;
    } catch (getErr) {
      console.warn("⚠️ 图片URL验证失败(HEAD/RangeGET):", getErr.message);
      return false;
    }
  } catch (error) {
    console.warn("⚠️ 图片URL验证失败:", error.message);
    return false;
  }
}

/**
 * 从 818ps 提取图片 - 使用网页抓取
 */
async function collectValidatedChuangkitCandidates(candidates, options = {}) {
  const maxResults = Number(options.maxResults) || 8;
  const sortedCandidates = dedupeChuangkitUrls(candidates).sort(
    (a, b) => scoreChuangkitCandidateUrl(b) - scoreChuangkitCandidateUrl(a)
  );
  const results = [];

  for (const candidate of sortedCandidates) {
    if (scoreChuangkitCandidateUrl(candidate) < 100) {
      continue;
    }

    const ok = await validateImageUrl(candidate);
    if (!ok) {
      continue;
    }

    results.push(candidate);
    if (results.length >= maxResults) {
      break;
    }
  }

  return results;
}

async function extract818psImage(url, options = {}) {
  try {
    try {
      const optimizedResult = await extract818ps(url, {
        timeout: 15000,
        headless: true,
        ...options,
      });

      if (optimizedResult && optimizedResult.success && optimizedResult.imageUrl) {
        console.log("✅ 新版 818ps 提取器命中:", {
          source: optimizedResult.source,
          pageCount: optimizedResult.pageCount || 1,
        });
        return optimizedResult;
      }
    } catch (optimizedError) {
      console.warn("⚠️ 新版 818ps 提取器失败，回退旧逻辑:", optimizedError.message);
    }

    const urlObj = new URL(url);
    const picId = urlObj.searchParams.get("picId");
    const upicId = urlObj.searchParams.get("upicId");

    console.log("🔍 开始提取818ps图片:", { url, picId, upicId });

    // 如果有 picId 和 upicId，优先尝试已知的 URL 格式并验证
    if (picId && upicId) {
      const possibleUrls = [
        `https://img.818ps.com/pic/${upicId}/${picId}.jpg`,
        `https://img.818ps.com/pic/${upicId}/${picId}.png`,
        `https://img.818ps.com/pic/${upicId}/${picId}.webp`,
        `https://cdn.818ps.com/pic/${upicId}/${picId}.jpg`,
        `https://static.818ps.com/pic/${upicId}/${picId}.jpg`,
      ];

      console.log("🔄 尝试验证可能的图片URL...");

      // 尝试每个URL，找到第一个可用的
      for (const testUrl of possibleUrls) {
        const isValid = await validateImageUrl(testUrl);
        if (isValid) {
          console.log("✅ 找到有效的图片URL:", testUrl);
          return {
            imageUrl: testUrl,
            picId,
            upicId,
            platform: "818ps",
            source: "validated",
          };
        }
      }
    } else {
      console.log("⚠️ 未检测到 picId/upicId，跳过已知格式验证，转为网页抓取");
    }

    // 方法2: 抓取网页获取真实图片URL（适用于用户主页或详情页）
    console.log("🌐 尝试从网页抓取图片URL...");
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Referer: "https://818ps.com/",
          "Cache-Control": "no-cache",
        },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data || "");

      // 尝试多种选择器找到图片（保留原有选择器）
      const selectors = [
        `img[src*="${picId}"]`,
        `img[src*="img.818ps.com"]`,
        `img[data-src*="${picId}"]`,
        "img.preview-image",
        "img.main-image",
        ".image-preview img",
        ".work-image img",
        '[style*="background-image"]',
      ];

      for (const selector of selectors) {
        const elements = $(selector);

        for (let i = 0; i < elements.length; i++) {
          const elem = elements[i];
          const imgSrc = $(elem).attr("src") || $(elem).attr("data-src");
          const bgImage = $(elem).attr("style");

          let imageUrl = null;

          if (
            imgSrc &&
            (imgSrc.includes("img.818ps.com") ||
              (picId && imgSrc.includes(picId)))
          ) {
            imageUrl = imgSrc.startsWith("http") ? imgSrc : `https:${imgSrc}`;
          } else if (bgImage && bgImage.includes("url(")) {
            const match = bgImage.match(/url\(['"]?([^'\"]+)['"]?\)/);
            if (match && match[1]) {
              imageUrl = match[1].startsWith("http")
                ? match[1]
                : `https:${match[1]}`;
            }
          }

          if (imageUrl) {
            console.log("🎯 从网页中找到图片URL (selector):", imageUrl);
            return {
              imageUrl,
              picId,
              upicId,
              platform: "818ps",
              source: "scraped",
            };
          }
        }
      }

      // 如果选择器未命中，尝试从页面脚本/文本中解析图片URL
      const text = response.data ? response.data.toString() : "";
      const candidates = extractImageUrlsFromText(text);
      for (const c of candidates) {
        // 优先包含 picId 或包含 img.818ps.com 的
        if (
          (picId && c.includes(picId)) ||
          c.includes("img.818ps.com") ||
          c.includes("818ps")
        ) {
          console.log("🎯 从脚本/文本中提取到候选图片URL:", c);
          // 对 tuguaishou/818ps 的链接做无水印变体尝试
          let finalUrl = c.startsWith("http") ? c : `https:${c}`;
          if (!finalUrl.includes("tuguaishou.com")) {
            const candidatesNW = buildNoWatermarkVariants(finalUrl);
            for (const nw of candidatesNW) {
              const ok = await validateImageUrl(nw);
              if (ok) {
                finalUrl = nw;
                break;
              }
            }
          } else {
            // tuguaishou 链接通常带有 auth_key，保留原始 URL
            await validateImageUrl(finalUrl);
          }
          return {
            imageUrl: finalUrl,
            picId,
            upicId,
            platform: "818ps",
            source: "script-scan",
          };
        }
      }
    } catch (scrapeError) {
      console.error("❌ 网页抓取失败:", scrapeError.message);
    }

    // 如果所有方法都失败，先尝试第三方去水印服务作为兜底
    try {
      const third = await callThirdPartyService(url);
      if (third && third.imageUrl) {
        console.log(
          "✅ 第三方服务提供了图片URL，作为回退使用:",
          third.imageUrl
        );
        return {
          imageUrl: third.imageUrl,
          platform: "818ps",
          source: "third-party",
        };
      }
    } catch (e) {
      console.warn("⚠️ 第三方兜底调用发生错误:", e.message);
    }

    // 【新增】方法 3: 尝试 Puppeteer 隐身抓取（应对强反爬虫）
    console.log("🤖 尝试 Puppeteer 隐身抓取（应对强反爬虫）...");
    try {
      let imageUrl = await scrape818ps(url);
      // 若为 tuguaishou 链接，保留原始 URL（含 auth_key）；否则尝试无水印变体
      if (typeof imageUrl === "string" && imageUrl.startsWith("http")) {
        if (!imageUrl.includes("tuguaishou.com")) {
          const variants = buildNoWatermarkVariants(imageUrl);
          for (const v of variants) {
            const ok = await validateImageUrl(v);
            if (ok) {
              imageUrl = v;
              break;
            }
          }
        } else {
          await validateImageUrl(imageUrl);
        }
      }
      if (imageUrl) {
        console.log("✅ Puppeteer 隐身抓取成功:", imageUrl);
        return {
          imageUrl,
          picId,
          upicId,
          platform: "818ps",
          source: "puppeteer",
        };
      }
    } catch (puppeteerError) {
      console.warn("⚠️ Puppeteer 隐身抓取失败:", puppeteerError.message);
    }

    // 如果仍然没有，抛出错误
    throw new Error("无法获取真实的图片URL，所有尝试都失败了");
  } catch (error) {
    console.error("❌ 提取818ps图片失败:", error.message);
    throw error;
  }
}

/**
 * 从Canva提取图片 - 使用网页抓取
 */
async function extractCanvaImage(url) {
  try {
    console.log("🎨 开始提取Canva图片:", url);
    // 兼容多种 URL：/design/<id>、/templates/<id>、分享页等
    const designMatch = url.match(/design\/([^\/]+)/);
    const templateMatch = url.match(/templates\/([^\/]+)/);
    const designId =
      (designMatch && designMatch[1]) ||
      (templateMatch && templateMatch[1]) ||
      null;
    if (designId) {
      console.log("📋 设计/模板ID:", designId);
    } else {
      console.log("⚠️ 未发现设计ID，改为直接页面解析与 Puppeteer 兜底");
    }

    // 尝试抓取Canva页面
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: "https://www.canva.com/",
      },
      timeout: 10000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data || "");

    // 常见元信息优先
    const metaImg =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('link[rel="image_src"]').attr("href");
    if (metaImg && /^https?:\/\//.test(metaImg)) {
      const ok = await validateImageUrl(metaImg);
      if (ok)
        return {
          imageUrl: metaImg,
          platform: "Canva",
          designId,
          source: "meta",
        };
    }

    // 从脚本/文本中提取所有候选图片URL并验证
    const pageText = response.data ? response.data.toString() : "";
    const candidates = extractImageUrlsFromText(pageText);
    for (let cand of candidates) {
      // 有些候选可能是缩略或带查询参数，先做快速验证
      try {
        // 先尝试无水印/高清变体
        const variants = buildCanvaNoWatermarkVariants(cand);
        let final = cand;
        for (const v of variants) {
          const ok = await validateImageUrl(v);
          if (ok) {
            final = v;
            break;
          }
        }
        const valid = await validateImageUrl(final);
        if (valid) {
          console.log("✅ 从页面脚本/文本中找到可用图片:", final);
          return {
            imageUrl: final,
            platform: "Canva",
            designId,
            source: "script-scan",
          };
        }
      } catch (e) {
        // 忽略单个候选错误
      }
    }

    // 在直接抛出前，先尝试第三方服务作为兜底
    try {
      const third = await callThirdPartyService(url);
      if (third && third.imageUrl) {
        console.log(
          "✅ 第三方服务提供了Canva图片URL，作为回退使用:",
          third.imageUrl
        );
        return {
          imageUrl: third.imageUrl,
          platform: "Canva",
          designId,
          source: "third-party",
        };
      }
    } catch (e) {
      console.warn("⚠️ 第三方兜底调用发生错误 (Canva):", e.message);
    }

    // 【新增】尝试 Puppeteer 隐身抓取（Canva 是动态渲染页面，很适合用 Puppeteer）
    console.log("🤖 尝试 Puppeteer 隐身抓取 Canva（应对动态渲染）...");
    try {
      let imageUrl = await scrapeCanva(url);
      // scrapeCanva 可能返回 dataUrl（元素截图），或直链 URL
      if (typeof imageUrl === "string") {
        if (imageUrl.startsWith("data:image")) {
          console.log("✅ Puppeteer 截图成功，已去除常见水印遮罩");
          return {
            imageUrl,
            platform: "Canva",
            designId,
            source: "puppeteer-screenshot",
            quality: "preview",
          };
        }
        if (imageUrl.startsWith("http")) {
          const variants = buildCanvaNoWatermarkVariants(imageUrl);
          for (const v of variants) {
            const ok = await validateImageUrl(v);
            if (ok) {
              imageUrl = v;
              break;
            }
          }
          console.log("✅ Puppeteer 隐身抓取成功:", imageUrl);
          return {
            imageUrl,
            platform: "Canva",
            designId,
            source: "puppeteer",
          };
        }
      }
    } catch (puppeteerError) {
      console.warn("⚠️ Puppeteer 隐身抓取失败:", puppeteerError.message);
    }

    throw new Error("无法获取Canva图片，可能需要登录或为私有资源");
  } catch (error) {
    console.error("❌ 提取Canva图片失败:", error.message);
    throw error;
  }
}

/**
 * 从创客贴提取图片 - 专门针对主设计稿优化
 * 支持多种URL格式：设计稿链接、分享链接等
 */
async function extractChuangkitImage(url) {
  try {
    console.log("🧩 开始提取创客贴主设计稿:", url);

    // 识别URL类型
    const isShareLink = url.includes('/sharedesign');
    const isDesignLink = url.includes('/designs/');
    const isTemplateLink = url.includes('/templates/');

    console.log(`📋 链接类型: ${isShareLink ? '分享链接' : isDesignLink ? '设计稿链接' : isTemplateLink ? '模板链接' : '其他链接'}`);

    // 先尝试静态抓取获取基本信息
    try {
      const response = await axios.get(url, {
        headers: {
          ...COMMON_HEADERS,
          Referer: "https://www.chuangkit.com/",
        },
        timeout: 15000, // 增加超时时间
        maxRedirects: 5,
      });

      const $ = cheerio.load(response.data || "");

      // 1) 元信息优先 - 通常包含主设计稿预览图
      const metaSelectors = [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[property="og:image:url"]',
        'meta[name="twitter:image:src"]',
        'link[rel="image_src"]'
      ];

      for (const selector of metaSelectors) {
        const metaImg = $(selector).attr("content") || $(selector).attr("href");
        if (metaImg && /^https?:\/\//.test(metaImg)) {
          // 验证是否为高质量主设计稿
          const urlLower = metaImg.toLowerCase();
          if (!urlLower.includes('thumb') &&
            !urlLower.includes('small') &&
            !urlLower.includes('icon') &&
            !urlLower.includes('avatar')) {

            const ok = await validateImageUrl(metaImg);
            if (ok) {
              console.log("✅ 从元信息获取到主设计稿:", metaImg);
              return {
                imageUrl: metaImg,
                platform: "Chuangkit",
                source: "meta",
                quality: "high",
                linkType: isShareLink ? 'share' : 'direct'
              };
            }
          }
        }
      }

      // 2) 针对分享链接的特殊处理
      if (isShareLink) {
        console.log("🔗 处理创客贴分享链接...");

        // 分享链接特有的选择器
        const shareSelectors = [
          '.share-preview img',
          '.share-design img',
          '.share-template img',
          '.share-work img',
          '.design-share-preview img',
          '.template-share-preview img',
          '#share-preview img',
          '.preview-share img'
        ];

        for (const sel of shareSelectors) {
          const elements = $(sel);
          for (let i = 0; i < elements.length; i++) {
            const imgSrc = $(elements[i]).attr("src") || $(elements[i]).attr("data-src");
            if (imgSrc) {
              const imageUrl = imgSrc.startsWith("http") ? imgSrc : `https:${imgSrc}`;
              const urlLower = imageUrl.toLowerCase();

              if (!urlLower.includes('thumb') && !urlLower.includes('small')) {
                const ok = await validateImageUrl(imageUrl);
                if (ok) {
                  console.log("✅ 从分享链接获取到主设计稿:", imageUrl);
                  return {
                    imageUrl,
                    platform: "Chuangkit",
                    source: "share-scraped",
                    quality: "high",
                    linkType: 'share'
                  };
                }
              }
            }
          }
        }
      }

      // 3) DOM 选择器：专门针对创客贴的主设计稿容器
      const designSelectors = [
        // 主设计稿预览容器
        '.design-preview-container img',
        '.work-preview-container img',
        '.template-preview-container img',
        '.main-design-area img',

        // Canvas 相关
        '.design-canvas img',
        '.work-canvas img',
        '.main-canvas img',
        '.canvas-container img',

        // 预览相关
        '.preview-image img',
        '.design-preview img',
        '.work-preview img',
        '.main-preview img',
        '.template-preview img',

        // 创客贴特有选择器
        '.ck-preview img',
        '.ck-design img',
        '.ck-work img',
        '.ck-template img',

        // 通用但可能包含主设计稿的选择器
        'img[src*="chuangkit"][src*="design"]',
        'img[src*="chuangkit"][src*="work"]',
        'img[src*="chuangkit"][src*="template"]',
        'img[src*="cdn"][src*="design"]',

        // 背景图片
        '.design-preview-container[style*="background-image"]',
        '.work-preview-container[style*="background-image"]',
        '.canvas-container[style*="background-image"]',
        '[style*="background-image"]'
      ];

      for (const sel of designSelectors) {
        const elements = $(sel);
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          let imageUrl = null;

          if (sel.includes('[style*="background-image"]')) {
            const bg = $(el).attr("style");
            if (bg && /url\(/.test(bg)) {
              const m = bg.match(/url\(["']?([^"']+)["']?\)/);
              if (m && m[1]) {
                imageUrl = m[1].startsWith("http") ? m[1] : `https:${m[1]}`;
              }
            }
          } else {
            const imgSrc = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-original");
            if (imgSrc) {
              imageUrl = imgSrc.startsWith("http") ? imgSrc : `https:${imgSrc}`;
            }
          }

          if (imageUrl) {
            // 过滤掉明显的缩略图和小图
            const urlLower = imageUrl.toLowerCase();
            if (!urlLower.includes('thumb') &&
              !urlLower.includes('small') &&
              !urlLower.includes('mini') &&
              !urlLower.includes('icon') &&
              !urlLower.includes('avatar')) {

              const ok = await validateImageUrl(imageUrl);
              if (ok) {
                console.log("✅ 静态抓取到主设计稿:", imageUrl);
                return {
                  imageUrl,
                  platform: "Chuangkit",
                  source: "scraped",
                  quality: "high",
                  linkType: isShareLink ? 'share' : 'direct'
                };
              }
            }
          }
        }
      }

      // 4) 从脚本文本中提取高质量设计稿URL
      const pageText = response.data ? response.data.toString() : "";
      const candidates = extractImageUrlsFromText(pageText);

      // 按优先级排序候选URL
      const sortedCandidates = candidates
        .filter(cand => {
          const urlLower = cand.toLowerCase();
          return (urlLower.includes("chuangkit") || urlLower.includes("cdn")) &&
            !urlLower.includes("thumb") &&
            !urlLower.includes("small") &&
            !urlLower.includes("icon");
        })
        .sort((a, b) => {
          const aScore = (a.includes("design") ? 3 : 0) +
            (a.includes("work") ? 3 : 0) +
            (a.includes("template") ? 2 : 0) +
            (a.includes("chuangkit") ? 2 : 0);
          const bScore = (b.includes("design") ? 3 : 0) +
            (b.includes("work") ? 3 : 0) +
            (b.includes("template") ? 2 : 0) +
            (b.includes("chuangkit") ? 2 : 0);
          return bScore - aScore;
        });

      for (const cand of sortedCandidates) {
        const ok = await validateImageUrl(cand);
        if (ok) {
          console.log("✅ 从脚本文本找到主设计稿:", cand);
          return {
            imageUrl: cand,
            platform: "Chuangkit",
            source: "script-scan",
            quality: "high",
            linkType: isShareLink ? 'share' : 'direct'
          };
        }
      }
    } catch (err) {
      console.warn("⚠️ 创客贴静态抓取失败:", err.message);
    }

    // 5) 使用优化后的 Puppeteer 抓取主设计稿
    console.log("🤖 使用 Puppeteer 抓取创客贴主设计稿...");
    try {
      const result = await scrapeChuangkit(url);
      if (result) {
        console.log("✅ Puppeteer 创客贴主设计稿抓取成功");

        if (typeof result === "object") {
          const primaryImageUrl =
            result.imageUrl ||
            result.thumbnailUrl ||
            (Array.isArray(result.imageUrls) ? result.imageUrls[0] : null) ||
            (Array.isArray(result.images) ? result.images[0] : null) ||
            null;

          if (primaryImageUrl) {
            const isDataUrl =
              typeof primaryImageUrl === "string" &&
              primaryImageUrl.startsWith("data:image");

            return {
              ...result,
              imageUrl: primaryImageUrl,
              thumbnailUrl: result.thumbnailUrl || primaryImageUrl,
              platform: "Chuangkit",
              source:
                result.source || (isDataUrl ? "puppeteer-screenshot" : "puppeteer-url"),
              quality: result.quality || (isDataUrl ? "preview" : "high"),
              linkType: isShareLink ? "share" : "direct",
              notice:
                result.notice ||
                (isDataUrl
                  ? "已截取完整主设计稿，可能包含平台标识"
                  : undefined),
            };
          }
        }

        const isDataUrl = typeof result === "string" && result.startsWith("data:image");
        const isHighQuality = typeof result === "string" && result.startsWith("http");

        if (isDataUrl) {
          // 截图结果，质量为预览级别但是完整的主设计稿
          return {
            imageUrl: result,
            platform: "Chuangkit",
            source: "puppeteer-screenshot",
            quality: "preview",
            notice: "已截取完整主设计稿，可能包含平台标识",
            linkType: isShareLink ? 'share' : 'direct'
          };
        } else if (isHighQuality) {
          // 直接获取到的高质量URL
          return {
            imageUrl: result,
            platform: "Chuangkit",
            source: "puppeteer-url",
            quality: "high",
            linkType: isShareLink ? 'share' : 'direct'
          };
        }
      }
    } catch (puErr) {
      console.warn("⚠️ Puppeteer 创客贴抓取失败:", puErr.message);
    }

    // 6) 最后尝试通用的网络嗅探
    console.log("🔍 尝试通用网络嗅探...");
    try {
      const genericResult = await scrapeWithBrowser(url);
      if (genericResult && typeof genericResult === "string" && genericResult.startsWith("http")) {
        console.log("✅ 通用网络嗅探成功:", genericResult);
        return {
          imageUrl: genericResult,
          platform: "Chuangkit",
          source: "generic-scrape",
          quality: "medium",
          linkType: isShareLink ? 'share' : 'direct'
        };
      }
    } catch (genericErr) {
      console.warn("⚠️ 通用网络嗅探失败:", genericErr.message);
    }

    throw new Error(`无法获取创客贴主设计稿。链接类型: ${isShareLink ? '分享链接' : '设计稿链接'}，可能需要登录或链接已失效`);;
  } catch (error) {
    console.error("❌ 提取创客贴主设计稿失败:", error.message);
    throw error;
  }
}

/**
 * 从抖音提取视频封面 - 使用网页抓取 + Puppeteer 回退
 */
async function extractDouyinImage(url) {
  try {
    console.log("🎵 开始提取抖音视频封面:", url);

    // 先尝试静态抓取
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 10000,
        maxRedirects: 5,
      });

      const $ = cheerio.load(response.data);

      // 查找视频封面
      const selectors = [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        "video[poster]",
        'img[src*="douyin"]',
      ];

      for (const selector of selectors) {
        const content =
          $(selector).attr("content") ||
          $(selector).attr("poster") ||
          $(selector).attr("src");
        if (content && content.startsWith("http")) {
          console.log("✅ 从抖音页面找到封面:", content);
          return {
            imageUrl: content,
            platform: "抖音",
            source: "scraped",
          };
        }
      }
    } catch (scrapeError) {
      console.warn("⚠️ 静态抓取失败:", scrapeError.message);
    }

    // 【新增】尝试 Puppeteer 隐身抓取
    console.log("🤖 尝试 Puppeteer 隐身抓取抖音...");
    try {
      const imageUrl = await scrapeDouyin(url);
      if (imageUrl) {
        console.log("✅ Puppeteer 隐身抓取成功:", imageUrl);
        return {
          imageUrl,
          platform: "抖音",
          source: "puppeteer",
        };
      }
    } catch (puppeteerError) {
      console.warn("⚠️ Puppeteer 隐身抓取失败:", puppeteerError.message);
    }

    throw new Error("无法获取抖音视频封面");
  } catch (error) {
    console.error("❌ 提取抖音图片失败:", error.message);
    throw error;
  }
}

/**
 * 从小红书提取图片 - 使用网页抓取 + Puppeteer 回退
 */
async function extractXiaohongshuImage(url) {
  try {
    console.log("📕 开始提取小红书图片:", url);

    // 先尝试静态抓取
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);

      // 查找小红书图片
      const selectors = [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'img[src*="xiaohongshu"]',
        'img[src*="xhscdn"]',
      ];

      for (const selector of selectors) {
        const content = $(selector).attr("content") || $(selector).attr("src");
        if (content && content.startsWith("http")) {
          console.log("✅ 从小红书页面找到图片:", content);
          return {
            imageUrl: content,
            platform: "小红书",
            source: "scraped",
          };
        }
      }
    } catch (scrapeError) {
      console.warn("⚠️ 静态抓取失败:", scrapeError.message);
    }

    // 【新增】尝试 Puppeteer 隐身抓取
    console.log("🤖 尝试 Puppeteer 隐身抓取小红书...");
    try {
      const imageUrl = await scrapeXiaohongshu(url);
      if (imageUrl) {
        console.log("✅ Puppeteer 隐身抓取成功:", imageUrl);
        return {
          imageUrl,
          platform: "小红书",
          source: "puppeteer",
        };
      }
    } catch (puppeteerError) {
      console.warn("⚠️ Puppeteer 隐身抓取失败:", puppeteerError.message);
    }

    throw new Error("无法获取小红书图片");
  } catch (error) {
    console.error("❌ 提取小红书图片失败:", error.message);
    throw error;
  }
}

/**
 * 主提取函数 - 架构级优化版本
 * 优先级：第三方 API (80%) -> 本地平台特定提取 (20%) -> 兜底方案 -> 抛错
 */
async function extractChuangkitImageEnhanced(url) {
  try {
    console.log("🧩 开始提取创客贴主设计稿/套图:", url);

    const isShareLink = url.includes("/sharedesign");
    const isDesignLink = url.includes("/designs/");
    const isTemplateLink = url.includes("/templates/");
    const linkType = isShareLink ? "share" : isDesignLink ? "direct" : isTemplateLink ? "template" : "other";
    let staticFallbackUrls = [];

    console.log(
      `📋 链接类型: ${
        isShareLink ? "分享链接" : isDesignLink ? "设计稿链接" : isTemplateLink ? "模板链接" : "其他链接"
      }`
    );

    try {
      const response = await axios.get(url, {
        headers: {
          ...COMMON_HEADERS,
          Referer: "https://www.chuangkit.com/",
        },
        timeout: 15000,
        maxRedirects: 5,
      });

      const $ = cheerio.load(response.data || "");
      const staticCandidates = [];
      const addStaticCandidate = (rawUrl) => {
        const normalized = normalizeChuangkitCandidateUrl(rawUrl);
        if (
          !normalized ||
          !/^https?:\/\//i.test(normalized) ||
          scoreChuangkitCandidateUrl(normalized) < 100
        ) {
          return;
        }
        staticCandidates.push(normalized);
      };

      const metaSelectors = [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[property="og:image:url"]',
        'meta[name="twitter:image:src"]',
        'link[rel="image_src"]',
      ];
      metaSelectors.forEach((selector) => {
        addStaticCandidate($(selector).attr("content") || $(selector).attr("href"));
      });

      if (isShareLink) {
        console.log("🔗 处理创客贴分享链接...");
        const shareSelectors = [
          ".share-preview img",
          ".share-design img",
          ".share-template img",
          ".share-work img",
          ".design-share-preview img",
          ".template-share-preview img",
          "#share-preview img",
          ".preview-share img",
        ];

        for (const selector of shareSelectors) {
          const elements = $(selector);
          for (let i = 0; i < elements.length; i++) {
            const imgSrc = $(elements[i]).attr("src") || $(elements[i]).attr("data-src");
            if (imgSrc) {
              addStaticCandidate(imgSrc.startsWith("http") ? imgSrc : `https:${imgSrc}`);
            }
          }
        }
      }

      const designSelectors = [
        ".design-preview-container img",
        ".work-preview-container img",
        ".template-preview-container img",
        ".main-design-area img",
        ".design-canvas img",
        ".work-canvas img",
        ".main-canvas img",
        ".canvas-container img",
        ".preview-image img",
        ".design-preview img",
        ".work-preview img",
        ".main-preview img",
        ".template-preview img",
        ".ck-preview img",
        ".ck-design img",
        ".ck-work img",
        ".ck-template img",
        'img[src*="chuangkit"][src*="design"]',
        'img[src*="chuangkit"][src*="work"]',
        'img[src*="chuangkit"][src*="template"]',
        'img[src*="cdn"][src*="design"]',
        '.design-preview-container[style*="background-image"]',
        '.work-preview-container[style*="background-image"]',
        '.canvas-container[style*="background-image"]',
        '[style*="background-image"]',
      ];

      for (const selector of designSelectors) {
        const elements = $(selector);
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          let imageUrl = null;

          if (selector.includes('[style*="background-image"]')) {
            const styleValue = $(element).attr("style");
            const match = styleValue && styleValue.match(/url\(["']?([^"')]+)["']?\)/i);
            if (match && match[1]) {
              imageUrl = match[1].startsWith("http") ? match[1] : `https:${match[1]}`;
            }
          } else {
            const imgSrc =
              $(element).attr("src") ||
              $(element).attr("data-src") ||
              $(element).attr("data-original");
            if (imgSrc) {
              imageUrl = imgSrc.startsWith("http") ? imgSrc : `https:${imgSrc}`;
            }
          }

          addStaticCandidate(imageUrl);
        }
      }

      extractImageUrlsFromText(response.data ? response.data.toString() : "")
        .filter((candidate) => scoreChuangkitCandidateUrl(candidate) >= 100)
        .forEach(addStaticCandidate);

      staticFallbackUrls = await collectValidatedChuangkitCandidates(staticCandidates, {
        maxResults: isShareLink ? 12 : 6,
      });

      if (staticFallbackUrls.length > 1) {
        console.log(`✅ 静态扫描命中创客贴套图，共 ${staticFallbackUrls.length} 张`);
        return buildChuangkitResult(staticFallbackUrls, {
          source: "static-scan",
          quality: "high",
          linkType,
        });
      }
    } catch (staticError) {
      console.warn("⚠️ 创客贴静态抓取失败:", staticError.message);
    }

    console.log("🤖 使用 Puppeteer 抓取创客贴主设计稿/套图...");
    try {
      const result = await scrapeChuangkit(url);
      if (result) {
        if (typeof result === "string" && result.startsWith("data:image")) {
          return {
            imageUrl: result,
            platform: "Chuangkit",
            source: "puppeteer-screenshot",
            quality: "preview",
            notice: "已截图完整设计稿，可能包含平台标识",
            linkType,
          };
        }

        const browserUrls =
          typeof result === "object" && !Array.isArray(result)
            ? dedupeChuangkitUrls([
                ...(Array.isArray(result.imageUrls) ? result.imageUrls : []),
                ...(Array.isArray(result.images) ? result.images : []),
                result.imageUrl,
                ...staticFallbackUrls,
              ])
            : typeof result === "string" && result.startsWith("http")
              ? dedupeChuangkitUrls([result, ...staticFallbackUrls])
              : [];

        if (browserUrls.length > 0) {
          console.log(`✅ Puppeteer 创客贴抓取成功，共 ${browserUrls.length} 张`);
          return buildChuangkitResult(browserUrls, {
            ...(typeof result === "object" && !Array.isArray(result) ? result : {}),
            source:
              typeof result === "object" && result && result.source
                ? result.source
                : "puppeteer-url",
            quality:
              typeof result === "object" && result && result.quality
                ? result.quality
                : "high",
            linkType,
          });
        }
      }
    } catch (puppeteerError) {
      console.warn("⚠️ Puppeteer 创客贴抓取失败:", puppeteerError.message);
    }

    if (staticFallbackUrls.length > 0) {
      console.log("✅ 使用静态扫描结果作为创客贴回退");
      return buildChuangkitResult(staticFallbackUrls, {
        source: "static-fallback",
        quality: "high",
        linkType,
      });
    }

    console.log("📡 尝试通用网络嗅探...");
    try {
      const genericResult = await scrapeWithBrowser(url);
      if (typeof genericResult === "string" && genericResult.startsWith("http")) {
        return buildChuangkitResult([genericResult], {
          source: "generic-scrape",
          quality: "medium",
          linkType,
        });
      }
    } catch (genericError) {
      console.warn("⚠️ 通用网络嗅探失败:", genericError.message);
    }

    throw new Error(
      `无法获取创客贴主设计稿。链接类型: ${
        isShareLink ? "分享链接" : "设计稿链接"
      }，可能需要登录或链接已失效`
    );
  } catch (error) {
    console.error("❌ 提取创客贴主设计稿失败:", error.message);
    throw error;
  }
}

async function extractGaodingImage(url) {
  try {
    console.log("Starting Gaoding extraction:", url);

    const result = await extractGaoding(url, {
      timeout: 15000,
      headless: true,
    });

    if (result && result.success && result.imageUrl) {
      console.log("Gaoding extractor hit:", {
        source: result.source,
        pageCount: result.pageCount || 1,
        linkType: result.linkType,
      });
      return result;
    }

    throw new Error(
      (result && (result.error || result.message)) ||
        "Unable to extract Gaoding images"
    );
  } catch (error) {
    console.error("Gaoding extraction failed:", error.message);
    throw error;
  }
}

async function extractHuabanImage(url) {
  try {
    const result = await extractHuaban(url, {
      timeout: 15000,
    });

    if (
      result &&
      (result.imageUrl ||
        result.status === "preview_image" ||
        result.status === "preview_only")
    ) {
      console.log("Huaban extractor hit:", {
        source: result.source,
        status: result.status || "success",
        pageCount: result.pageCount || 0,
      });
      return result;
    }

    throw new Error(
      result && (result.error || result.message)
        ? result.error || result.message
        : "huaban_extract_failed"
    );
  } catch (error) {
    console.error("Huaban extraction failed:", error.message);
    throw error;
  }
}

async function extractImage(url, platform, options = {}) {
  console.log("\n=".repeat(60));
  console.log("🚀 开始提取图片");
  console.log(`   平台: ${platform}`);
  console.log(`   链接: ${url.substring(0, 100)}`);
  console.log("=".repeat(60));
  const shouldPreferLocalChuangkit = isChuangkitTarget(url, platform);
  const shouldUseHuabanLocalOnly = isHuabanTarget(url, platform);
  const shouldPreferLocal818ps = /818ps|tuguaishou/i.test(platform || "") || /(?:818ps|tuguaishou)\.com/i.test(url);
  let thirdPartyFallback = null;

  try {
    // ========== 阶段 1: 优先使用第三方 API 网关（命中率 80%+）==========
    console.log("\n📡 阶段 1: 尝试第三方 API 网关...");
    if (shouldUseHuabanLocalOnly) {
      console.log("\nℹ️ 花瓣使用官方公开接口，跳过第三方 API 网关...");
    } else {
      try {
        const thirdPartyResult = await extractViaThirdPartyAPIWithCache(
          url,
          platform
        );

      if (
        thirdPartyResult &&
        thirdPartyResult.success &&
        thirdPartyResult.imageUrl
      ) {
        console.log("\n✅ 【成功】第三方 API 网关返回结果\n");
        const normalizedThirdPartyResult = shouldPreferLocalChuangkit
          ? buildChuangkitResult(
              [
                ...(Array.isArray(thirdPartyResult.imageUrls)
                  ? thirdPartyResult.imageUrls
                  : []),
                ...(Array.isArray(thirdPartyResult.images)
                  ? thirdPartyResult.images
                  : []),
                thirdPartyResult.imageUrl,
                thirdPartyResult.thumbnailUrl,
              ],
              {
                ...thirdPartyResult,
                platform: thirdPartyResult.platform || platform,
                source: thirdPartyResult.source || "api-gateway",
              }
            )
          : {
              ...thirdPartyResult,
              imageUrl: thirdPartyResult.imageUrl,
              platform: thirdPartyResult.platform || platform,
              source: thirdPartyResult.source || "api-gateway",
            };

        if (
          (!shouldPreferLocal818ps && !shouldPreferLocalChuangkit) ||
          (!shouldPreferLocal818ps &&
          normalizedThirdPartyResult.imageUrls.length > 1)
        ) {
          return normalizedThirdPartyResult;
        }

        thirdPartyFallback = normalizedThirdPartyResult;
        console.log("ℹ️ 创客贴第三方接口仅返回单张，继续尝试本地套图提取...");
      }
    } catch (error) {
      console.warn(`\n⚠️ 第三方 API 网关异常: ${error.message}`);
    }

    // ========== 阶段 2: 本地平台特定提取（作为补充）==========
    console.log("\n🔍 阶段 2: 尝试本地平台特定提取（仅作补充）...");
    }

    let result = null;

    try {
      if (
        platform === "818ps" ||
        url.includes("818ps.com") ||
        url.includes("tuguaishou.com")
      ) {
        result = await extract818psImage(url, options);
      } else if (
        platform === "Gaoding" ||
        platform === "稿定设计" ||
        url.includes("gaoding.com") ||
        url.includes("gaoding.cn")
      ) {
        result = await extractGaodingImage(url);
      } else if (platform === "Canva" && url.includes("canva")) {
        result = await extractCanvaImage(url);
      } else if (isHuabanTarget(url, platform)) {
        result = await extractHuabanImage(url);
      } else if (platform === "抖音" && url.includes("douyin")) {
        result = await extractDouyinImage(url);
      } else if (
        platform === "小红书" &&
        (url.includes("xiaohongshu") || url.includes("xhs"))
      ) {
        result = await extractXiaohongshuImage(url);
      } else if (url.includes("chuangkit.com") || platform === "Chuangkit" || platform === "创客贴") {
        // 创客贴支持多种链接格式：设计稿、分享链接、模板等
        result = await extractChuangkitImageEnhanced(url);
      } else if (url.includes("chuangkit")) {
        // 兜底：任何包含chuangkit的链接都尝试创客贴提取
        result = await extractChuangkitImageEnhanced(url);
      }

      if (
        result &&
        (result.imageUrl ||
          result.status === "preview_image" ||
          result.status === "preview_only")
      ) {
        console.log("\n✅ 【成功】本地提取返回结果\n");
        return result;
      }
    } catch (localError) {
      console.warn(`⚠️ 本地提取失败: ${localError.message}`);
    }

    // ========== 阶段 3: 最后兜底方案 ==========
    console.log("\n🔁 阶段 3: 尝试兜底方案...");
    console.log("❌ 所有主要方案都失败，无法获取真实图片URL");
    if (thirdPartyFallback) {
      console.log("\nℹ️ 创客贴本地套图未命中，回退第三方单图结果...\n");
      return shouldPreferLocal818ps
        ? await require("./extractors/818ps")._test.mergeStageResults([
            await (async () => {
              const imageUrl = thirdPartyFallback.imageUrl;
              const valid = await require("./extractors/818ps").validateImageUrl(imageUrl);
              return { source: "thirdparty_fallback", candidates: valid ? [{ imageUrl, source: "thirdparty_fallback", role: "page_preview", validationStatus: "valid", pageNumber: null }] : [], evidence: [] };
            })(),
          ])
        : thirdPartyFallback;
    }

    console.log("\n" + "=".repeat(60) + "\n");

    throw new Error(
      `[${platform}] 无法提取图片: 第三方 API 失败，本地提取也失败。可能原因：\n` +
      `1. 目标链接已过期或不存在\n` +
      `2. 网站防护强制（需要登录或 JS 渲染）\n` +
      `3. 网络连接问题`
    );
  } catch (error) {
    console.error(`\n❌ 【最终失败】${error.message}\n`);
    throw error;
  }
}

module.exports = {
  extractImage,
  extract818psImage,
  extractGaodingImage,
  extractHuabanImage,
  extractCanvaImage,
  extractDouyinImage,
  extractXiaohongshuImage,
  extractChuangkitImage: extractChuangkitImageEnhanced,
  validateImageUrl,
};
