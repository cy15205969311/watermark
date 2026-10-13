// Standalone test scripts need the same Node 18 Web File compatibility as index.js.
if (typeof global.File === "undefined") global.File = require("buffer").File;
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { withPuppeteerExecutablePath } = require("../utils/puppeteer-launch");
const { AsyncLocalStorage } = require("async_hooks");
const { getDefaultPool } = require("../services/browser-pool");
const { collectPageData, resolveEvidence, buildPageResult, classifyResource, imageIdentity, redact, MAX_PAGES } = require("./818ps-pages");
const extractionContext = new AsyncLocalStorage();
const { inspectMedia } = require("./818ps-animation");

function diagnostic(stage, data = {}) {
  const context = extractionContext.getStore();
  console.log(`[818ps:${context?.requestId || "standalone"}] ${stage} ${redact(JSON.stringify(data))}`);
}

async function mapLimited(items, task, concurrency = 4) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

async function validatePageCollection(collection, source) {
  const context = extractionContext.getStore();
  const candidates = collection.candidates.slice(0, 400);
  await mapLimited(candidates, async candidate => {
    if (context && Date.now() > context.deadline) {
      candidate.validationStatus = "budget_exhausted";
      return;
    }
    const animationTarget = context?.animationTarget || collection.animationTarget || /\.gif(?:[!?]|$)/i.test(candidate.imageUrl);
    const validation = await validateImageResource(candidate.imageUrl, { animationTarget });
    candidate.animationTarget = Boolean(animationTarget);
    Object.assign(candidate, validation, { validationStatus: validation.valid ? "valid" : "invalid" });
    candidate.resourceRole = classifyResource(candidate);
    candidate.hasVisibleWatermark = "unknown";
    diagnostic("animation_validation", { source: candidate.source, resourceRole: candidate.resourceRole, resourceProof: candidate.resourceProof, detectedFormat: candidate.detectedFormat || "unknown", contentType: candidate.contentType, fileSize: candidate.fileSize, width: candidate.width, height: candidate.height, isAnimated: candidate.isAnimated ?? null, frameCount: candidate.frameCount ?? null, durationMs: candidate.durationMs ?? null, hasVisibleWatermark: candidate.hasVisibleWatermark, validationStatus: candidate.validationStatus, selectionReason: candidate.reason });
    diagnostic("candidate", { source: candidate.source, page: candidate.pageNumber, pageId: candidate.pageId, url: candidate.imageUrl, width: candidate.width, height: candidate.height, score: candidate.score, status: candidate.validationStatus, reason: validation.reason });
  }, 2);
  diagnostic("collection", { source, raw: collection.candidates.length, filtered: candidates.length, valid: candidates.filter(entry => entry.validationStatus === "valid").length, excluded: collection.excluded || [], evidence: collection.evidence });
  return buildPageResult(candidates, collection.evidence, { source, candidates, metadata: { totalFound: collection.candidates.length, afterFilter: candidates.length, afterDedup: new Set(candidates.filter(entry => entry.validationStatus === "valid").map(entry => entry.imageUrl)).size }, animationTarget: Boolean(context?.animationTarget || collection.animationTarget) });
}

function mergeStageResults(results) {
  const candidates = results.flatMap(result => result.candidates || []);
  const evidence = results.flatMap(result => result.evidence || []);
  return buildPageResult(candidates, evidence, {
    source: results.filter(result => result.success).at(-1)?.source || "none",
    animationTarget: Boolean(extractionContext.getStore()?.animationTarget || results.some(result => result.animationTarget)),
    candidates,
    metadata: {
      totalFound: candidates.length,
      afterFilter: candidates.length,
      afterDedup: new Set(candidates.filter(candidate => candidate.validationStatus === "valid").map(candidate => candidate.imageUrl)).size,
      stages: results.map(result => ({ source: result.source, ...(result.metadata || {}) })),
      originalResourceDiscovery: {
        checkedSources: results.map(result => result.source).filter(Boolean),
        referencedCandidates: candidates.filter(candidate => candidate.roleEvidence === "original_reference_unconfirmed" || ["original_animation", "authorized_export"].includes(candidate.resourceProof?.declaredRole)).length,
        verifiedCandidates: candidates.filter(candidate => candidate.validationStatus === "valid" && ["original_animation", "authorized_export"].includes(candidate.resourceRole)).length,
        officialDownloadRequiresLogin: results.some(result => result.metadata?.officialDownloadRequiresLogin),
        reason: candidates.some(candidate => candidate.validationStatus === "valid" && ["original_animation", "authorized_export"].includes(candidate.resourceRole)) ? "verified_business_resource_reference" : results.some(result => result.metadata?.officialDownloadRequiresLogin) ? "official_download_requires_login" : "no_verified_original_in_checked_sources",
      },
    },
    warnings: results.flatMap(result => result.warnings?.filter(warning => !["total_page_count_unknown", "missing_or_unmapped_pages", "animation_preview_original_unconfirmed", "no_verified_animation_available"].includes(warning)) || []),
  });
}

puppeteer.use(StealthPlugin());

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
];

const COMMON_HEADERS = {
  "User-Agent": USER_AGENTS[0],
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const BLOCKED_IMAGE_KEYWORDS = [
  "ips_svg/",
  "ips_group_word/",
  "ips_icon/",
  "ips_material/",
  "ips_user_preview_api",
  "editor/",
  "material/",
  "element/",
  "asset/",
  "sticker",
  "watermark",
  "toolbar",
  "button",
  "crown",
  "badge",
  "vip",
  "icon",
  "logo",
  "frame",
  "mask",
  "emoji/",
  "group_word/",
  "wordart/",
  "font/",
  "text/",
];

const SHARE_PREVIEW_FIELDS = [
  "origin_img",
  "originImg",
  "big_img",
  "bigImg",
  "img",
  "image",
  "imageUrl",
  "image_url",
  "preview",
  "previewUrl",
  "preview_url",
  "url",
  "src",
  "cover",
  "coverUrl",
  "cover_url",
  "user_preview_ue",
  "user_preview",
];

const STATIC_TIMEOUT = 15000;
const SHARE_API_TIMEOUT = 15000;
const BROWSER_TIMEOUT = 45000;
const PAGE_LABEL_PATTERN = /(?:\u7b2c)?\s*(\d+)\s*(?:\u9875)/;
const PAGE_LABEL_KEY_PATTERN = /page_(\d+)/i;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function dedupeKeepOrder(items) {
  const seen = new Set();
  const ordered = [];

  for (const item of items || []) {
    if (typeof item !== "string") {
      continue;
    }

    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function normalizeCandidateUrl(url) {
  if (typeof url !== "string") {
    return null;
  }

  let candidate = url
    .trim()
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/^["']|["']$/g, "");

  if (!candidate) {
    return null;
  }

  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  }

  if (!/^https?:\/\//i.test(candidate)) {
    return null;
  }

  return candidate;
}

function extractPageNumber(label) {
  if (typeof label !== "string") {
    return null;
  }

  const match = label.match(PAGE_LABEL_KEY_PATTERN);
  return match ? Number(match[1]) : null;
}

function extractUrlPageNumber(url) {
  if (typeof url !== "string") {
    return null;
  }

  const patterns = [
    /(?:^|[\/_-])page[_-]?(\d+)(?:[._!?-]|$)/i,
    /(?:^|[\/_-])p[_-]?(\d+)(?:[._!?-]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function extract818psPreviewPageNumber(url) {
  if (typeof url !== "string") {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const pathname = String(parsedUrl.pathname || "");
    const lowerPath = pathname.toLowerCase();
    if (
      ![
        "/user_preview_ue/",
        "/user_preview/",
        "/user_work/",
        "/works/",
      ].some((segment) => lowerPath.includes(segment))
    ) {
      return null;
    }

    const filename = pathname.split("/").pop() || "";
    const match = filename.match(
      /^(.+?_\d+)(?:_(\d+))?\.(?:jpg|jpeg|png|webp)$/i
    );
    if (!match) {
      return null;
    }

    return match[2] ? Number(match[2]) + 1 : 1;
  } catch {
    return null;
  }
}

function sortUrlsByPageToken(urls) {
  return (urls || [])
    .map((url, index) => ({
      url,
      index,
      page: extractUrlPageNumber(url) ?? extract818psPreviewPageNumber(url),
    }))
    .sort((a, b) => {
      if (a.page !== null && b.page !== null && a.page !== b.page) {
        return a.page - b.page;
      }

      if (a.page !== null && b.page === null) {
        return -1;
      }

      if (a.page === null && b.page !== null) {
        return 1;
      }

      return a.index - b.index;
    })
    .map((item) => item.url);
}

function buildPages(imageUrls) {
  return (imageUrls || []).map((imageUrl, index) => ({
    page: index + 1,
    imageUrl,
  }));
}

function normalizeResultImages(result = {}) {
  const urls = dedupeKeepOrder([...(result.imageUrls || []), ...(result.images || []), ...(result.pages || []).map(page => page.imageUrl), result.imageUrl].map(normalizeCandidateUrl).filter(Boolean));
  const pages = urls.map((imageUrl, index) => ({ ...((result.pages || []).find(page => page.imageUrl === imageUrl) || { page: index + 1, pageNumber: null }), imageUrl })).sort((a, b) => a.page - b.page);
  const imageUrls = pages.map(page => page.imageUrl);
  return { success: result.success !== false && imageUrls.length > 0, platform: "818ps", ...result, imageUrl: imageUrls[0] || null, imageUrls, images: imageUrls, pages, pageCount: pages.length, collectedPageCount: pages.length, isMultiPage: pages.length > 1 || result.expectedPageCount > 1, expectedPageCount: result.expectedPageCount || null, pageCountConfidence: result.pageCountConfidence || "unknown", completenessStatus: result.completenessStatus || "unknown", isComplete: result.isComplete ?? null, missingPages: result.missingPages || [], warnings: result.warnings || [], metadata: { ...(result.metadata || {}), results: pages.length } };
}

function buildSuccessResult(imageUrls, extras = {}) {
  return normalizeResultImages({
    success: true,
    platform: "818ps",
    imageUrls,
    ...extras,
  });
}

function buildFailureResult(error, extras = {}) {
  return normalizeResultImages({
    success: false,
    platform: "818ps",
    message: "image_extract_failed",
    error: error instanceof Error ? error.message : String(error),
    imageUrl: null,
    imageUrls: [],
    images: [],
    pages: [],
    pageCount: 0,
    isMultiPage: false,
    ...extras,
  });
}

function attachResolvedUrlContext(result, requestUrl, resolvedUrl) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const normalizedRequestUrl =
    normalizeCandidateUrl(requestUrl) || String(requestUrl || "").trim() || null;
  const normalizedResolvedUrl = normalizeCandidateUrl(resolvedUrl);
  const metadata = {
    ...(result.metadata || {}),
  };

  if (
    normalizedResolvedUrl &&
    normalizedResolvedUrl !== normalizedRequestUrl &&
    !metadata.resolvedUrl
  ) {
    metadata.resolvedUrl = normalizedResolvedUrl;
  }

  return normalizeResultImages({
    ...result,
    originalUrl: normalizedRequestUrl || result.originalUrl || null,
    resolvedUrl:
      normalizedResolvedUrl && normalizedResolvedUrl !== normalizedRequestUrl
        ? normalizedResolvedUrl
        : result.resolvedUrl || null,
    metadata,
  });
}

function extractShareQueryParams(inputUrl) {
  try {
    const url = new URL(inputUrl);
    return {
      picId: url.searchParams.get("picId"),
      upicId: url.searchParams.get("upicId"),
      shareId: url.searchParams.get("share_id"),
      shareUid: url.searchParams.get("share_uid"),
      saveType: url.searchParams.get("save_type") || "",
      userSource: url.searchParams.get("user_source") || "",
    };
  } catch {
    return {
      picId: null,
      upicId: null,
      shareId: null,
      shareUid: null,
      saveType: "",
      userSource: "",
    };
  }
}

function extractFinalResponseUrl(response, fallbackUrl) {
  const candidates = [
    response &&
      response.request &&
      response.request.res &&
      response.request.res.responseUrl,
    response &&
      response.request &&
      response.request._redirectable &&
      response.request._redirectable._currentUrl,
    response && response.config && response.config.url,
    fallbackUrl,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return new URL(candidate, fallbackUrl).toString();
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

async function resolve818psShareUrl(inputUrl) {
  const normalizedUrl = normalizeCandidateUrl(inputUrl);
  if (!normalizedUrl) {
    return inputUrl;
  }

  const queryParams = extractShareQueryParams(normalizedUrl);
  if (queryParams.shareId || queryParams.upicId) {
    return normalizedUrl;
  }

  try {
    const response = await axios.get(normalizedUrl, {
      timeout: STATIC_TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        ...COMMON_HEADERS,
        "User-Agent": getRandomUserAgent(),
      },
    });

    return extractFinalResponseUrl(response, normalizedUrl) || normalizedUrl;
  } catch {
    return normalizedUrl;
  }
}

function getAntiHotlinkHeaders(imageUrl) {
  const headers = {
    "User-Agent": COMMON_HEADERS["User-Agent"],
    Accept:
      "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": COMMON_HEADERS["Accept-Language"],
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  try {
    const hostname = new URL(imageUrl).hostname.toLowerCase();
    if (hostname.includes("tuguaishou.com")) {
      headers.Referer = "https://tuguaishou.com/";
      headers.Origin = "https://tuguaishou.com";
    } else {
      headers.Referer = "https://818ps.com/";
      headers.Origin = "https://818ps.com";
    }
  } catch {
    headers.Referer = "https://818ps.com/";
    headers.Origin = "https://818ps.com";
  }

  return headers;
}

function extractReportedSize(headers = {}) {
  const contentRange = headers["content-range"] || headers["Content-Range"];
  if (contentRange) {
    const match = String(contentRange).match(/\/(\d+)$/);
    if (match) {
      return Number(match[1]);
    }
  }

  const contentLength = headers["content-length"] || headers["Content-Length"];
  if (contentLength && /^\d+$/.test(String(contentLength))) {
    return Number(contentLength);
  }

  return null;
}

function isImageContentType(headers = {}) {
  const contentType = String(
    headers["content-type"] || headers["Content-Type"] || ""
  ).toLowerCase();

  if (!contentType) {
    return true;
  }

  return (
    contentType.startsWith("image/") ||
    contentType.includes("application/octet-stream")
  );
}

function isValidImageResponse(status, headers) {
  return [200, 206].includes(status) && isImageContentType(headers);
}

function imageMagic(buffer) {
  return buffer.length >= 12 && (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) || /^GIF8[79]a/.test(buffer.toString("ascii", 0, 6)) || (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") || (buffer.toString("ascii", 4, 8) === "ftyp" && /avif|avis|heic/.test(buffer.toString("ascii", 8, 32))));
}

async function validateImageResource(imageUrl, options = {}) {
  const normalizedUrl = normalizeCandidateUrl(imageUrl);
  if (!normalizedUrl) return { valid: false, reason: "invalid_url" };
  const context = extractionContext.getStore();
  const animationTarget = Boolean(options.animationTarget || context?.animationTarget || /\.gif(?:[!?]|$)/i.test(normalizedUrl));
  const cacheKey = `${animationTarget ? "animation" : "image"}:${normalizedUrl}`;
  if (context?.validations.has(cacheKey)) return context.validations.get(cacheKey);
  const pending = (async () => {
    const headers = getAntiHotlinkHeaders(normalizedUrl);
    let headStatus = null;
    try {
      const response = await axios.head(normalizedUrl, { headers, timeout: 2500, maxRedirects: 3, validateStatus: () => true });
      headStatus = response.status;
      if ([404, 410].includes(headStatus)) return { valid: false, status: headStatus, reason: "not_found_or_expired" };
    } catch { /* HEAD unsupported or unreliable; inspect GET bytes. */ }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), animationTarget ? 12000 : 5000);
    try {
      async function getBytes(full) {
        const maxBytes = full ? 20 * 1024 * 1024 : 65536;
        const response = await axios.get(normalizedUrl, { headers: { ...headers, ...(full ? {} : { Range: "bytes=0-65535" }) }, timeout: full ? 10000 : 4000, signal: controller.signal, maxRedirects: 3, responseType: "stream", validateStatus: () => true });
        const status = response.status;
        if (![200, 206].includes(status)) {
          response.data.destroy();
          return { error: { valid: false, status, headStatus, reason: status === 403 ? "forbidden_or_expired_signature" : status === 429 ? "rate_limited" : status >= 500 ? "cdn_error" : "http_error" } };
        }
        if (full && Number(response.headers["content-length"] || 0) > maxBytes) { response.data.destroy(); return { error: { valid: false, reason: "animation_file_size_limit" } }; }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.data) {
          if (full && size + chunk.length > maxBytes) { response.data.destroy(); return { error: { valid: false, reason: "animation_file_size_limit" } }; }
          chunks.push(full ? chunk : chunk.subarray(0, Math.max(0, maxBytes - size)));
          size += chunk.length;
          if (!full && size >= maxBytes) { response.data.destroy(); break; }
        }
        const buffer = Buffer.concat(chunks);
        if (full) {
          const length = Number(response.headers["content-length"] || 0);
          const total = extractReportedSize(response.headers);
          if ((length && buffer.length !== length) || (status === 206 && total !== buffer.length)) return { error: { valid: false, status, reason: "truncated_animation_response" } };
        }
        return { buffer, response };
      }
      let loaded = await getBytes(animationTarget);
      if (loaded.error) return loaded.error;
      if (!imageMagic(loaded.buffer)) return { valid: false, status: loaded.response.status, reason: "non_image_body" };
      const isGif = /^GIF8[79]a/.test(loaded.buffer.toString("ascii", 0, 6));
      if (isGif && !animationTarget) loaded = await getBytes(true);
      if (loaded.error) return loaded.error;
      const { buffer, response } = loaded;
      const contentType = String(response.headers["content-type"] || "");
      let media = {};
      if (animationTarget || isGif) {
        try { media = await inspectMedia(buffer); }
        catch (error) { return { valid: false, status: response.status, reason: `invalid_animation:${error.message}` }; }
      } else {
        try { const metadata = await require("sharp")(buffer, { limitInputPixels: 80000000 }).metadata(); media = { width: metadata.width, height: metadata.height, detectedFormat: metadata.format, mediaType: `image/${metadata.format}` }; } catch {}
      }
      return { valid: true, status: response.status, contentType, contentLength: extractReportedSize(response.headers), ...media, reason: animationTarget || isGif ? "media_content_verified" : "image_signature_verified" };
    } catch (error) {
      return { valid: false, reason: /TIME|ABORT|CANCEL/.test(error.code || "") ? "timeout_or_truncated_response" : error.code || "network_error" };
    } finally { clearTimeout(timer); }
  })();
  context?.validations.set(cacheKey, pending);
  return pending;
}

async function validateImageUrl(imageUrl) {
  return (await validateImageResource(imageUrl)).valid;
}

async function findFirstValidCandidate(candidateUrls) {
  const candidates = dedupeKeepOrder(candidateUrls.map(normalizeCandidateUrl).filter(Boolean)).slice(0, 48);
  for (let index = 0; index < candidates.length; index += 4) {
    const batch = candidates.slice(index, index + 4);
    const valid = await mapLimited(batch, validateImageUrl);
    const match = batch.find((url, i) => valid[i]);
    if (match) return match;
  }
  return null;
}

function build818psVariants(url) {
  const normalized = normalizeCandidateUrl(url);
  if (!normalized) return [];
  // Existing styles are valid public resources; signed paths cannot be rewritten safely.
  if (/[?&](auth_key|signature|sign)=/i.test(normalized)) return [normalized];
  const parsed = new URL(normalized);
  const original = parsed.toString();
  parsed.pathname = parsed.pathname.replace(/!l\d+(_b)?$/i, "");
  return dedupeKeepOrder([original, parsed.toString()]);
}

function isRelevantDynamicImage(url) {
  const normalizedUrl = normalizeCandidateUrl(url);
  if (!normalizedUrl) {
    return false;
  }

  const lower = normalizedUrl.toLowerCase();
  if (
    [
      "favicon",
      "logo",
      "avatar",
      "sprite",
      "loading",
      "placeholder",
      "blank",
      "tracking",
      "analytics",
      "pixel",
      "beacon",
      "banner",
    ].some((keyword) => lower.includes(keyword))
  ) {
    return false;
  }

  return (
    [
      "img.818ps.com",
      "cdn.818ps.com",
      "static.818ps.com",
      "img.tuguaishou.com",
      "tuguaishou.com",
      "user_preview_ue",
      "user_preview",
      "user_work",
      "preview",
      "work/",
      "design/",
      "pic/",
      "auth_key=",
      "template",
      "/works/",
    ].some((keyword) => lower.includes(keyword)) &&
    !BLOCKED_IMAGE_KEYWORDS.some((keyword) => lower.includes(keyword))
  );
}

function isDesignPageCandidate(url) {
  const normalizedUrl = normalizeCandidateUrl(url);
  if (!normalizedUrl || !isRelevantDynamicImage(normalizedUrl)) {
    return false;
  }

  const lower = normalizedUrl.toLowerCase();
  if (BLOCKED_IMAGE_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return false;
  }

  const trustedDomains = [
    "img.tuguaishou.com",
    "img.818ps.com",
    "cdn.818ps.com",
    "static.818ps.com",
  ];

  if (!trustedDomains.some((domain) => lower.includes(domain))) {
    return false;
  }

  return ["user_preview_ue", "user_preview", "user_work", "/works/", "/user_work/"].some(
    (pattern) => lower.includes(pattern)
  );
}

function scoreDynamicImage(url, source = "") {
  const normalizedUrl = normalizeCandidateUrl(url);
  if (!normalizedUrl) {
    return 0;
  }

  const lower = normalizedUrl.toLowerCase();
  const pathname = (() => {
    try {
      return new URL(normalizedUrl).pathname.toLowerCase();
    } catch {
      return lower;
    }
  })();

  let score = 100;

  if (lower.includes("img.tuguaishou.com")) {
    score += 80;
  } else if (lower.includes("img.818ps.com")) {
    score += 60;
  } else if (lower.includes("cdn.818ps.com")) {
    score += 45;
  } else if (lower.includes("static.818ps.com")) {
    score += 35;
  } else if (lower.includes("tuguaishou.com")) {
    score += 30;
  }

  if (lower.includes("user_preview_ue")) {
    score += 95;
  } else if (lower.includes("ips_user_preview_api")) {
    score -= 180;
  } else if (lower.includes("user_preview")) {
    score += 75;
  } else if (lower.includes("user_work")) {
    score += 50;
  } else if (lower.includes("preview")) {
    score += 30;
  } else if (lower.includes("work")) {
    score += 25;
  }

  if (lower.includes("auth_key=")) {
    score += 35;
  }

  if (
    lower.includes("!l1600") ||
    lower.includes("!l2000") ||
    lower.includes("!l3000")
  ) {
    score += 25;
  }

  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    score += 18;
  } else if (pathname.endsWith(".png")) {
    score += 12;
  } else if (pathname.endsWith(".webp")) {
    score += 8;
  }

  if (source.startsWith("share_api_")) {
    score += 120;
  } else if (source === "page_specific") {
    score += 45;
  } else if (source === "resource") {
    score += 20;
  } else if (source === "json") {
    score += 15;
  } else if (source === "page_source") {
    score += 10;
  }

  if (isDesignPageCandidate(normalizedUrl)) {
    score += 70;
  }

  if (
    ["icon", "thumb", "small", "asset", "element"].some((keyword) =>
      lower.includes(keyword)
    )
  ) {
    score -= 240;
  }

  return score;
}

async function validateImageEntryUrls(entries) {
  const normalizedEntries = (entries || []).filter(
    (entry) => entry && typeof entry.url === "string"
  );

  if (!normalizedEntries.length) {
    return [];
  }

  const results = await mapLimited(normalizedEntries.slice(0, 400), entry => validateImageUrl(entry.url));

  const validUrls = [];
  const seen = new Set();
  normalizedEntries.forEach((entry, index) => {
    const normalizedUrl = normalizeCandidateUrl(entry.url);
    if (!normalizedUrl || results[index] !== true || seen.has(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);
    validUrls.push(normalizedUrl);
  });

  return sortUrlsByPageToken(validUrls);
}

function extractImageUrlsFromContent(content) {
  if (typeof content !== "string" || !content) {
    return [];
  }

  const urls = new Set();
  const patterns = [
    /https?:\/\/[^"'\\s>]+\.(?:png|jpe?g|webp|gif)(?:\?[^"'\\s>]*)?/gi,
    /\/\/[^"'\\s>]+\.(?:png|jpe?g|webp|gif)(?:\?[^"'\\s>]*)?/gi,
    /https?:\/\/[^"'\\s>]+(?:user_preview_ue|user_preview|user_work|ips_user_preview_api)[^"'\\s>]*/gi,
  ];

  for (const pattern of patterns) {
    const matches = content.match(pattern) || [];
    for (let candidate of matches) {
      candidate = candidate.replace(/\\/g, "/");
      if (candidate.startsWith("//")) {
        candidate = `https:${candidate}`;
      }

      if (isRelevantDynamicImage(candidate)) {
        urls.add(candidate);
      }
    }
  }

  return Array.from(urls);
}

function extractImageUrlsFromData(data) {
  const imageFields = [
    "imageUrl",
    "image_url",
    "imgUrl",
    "img_url",
    "previewUrl",
    "preview_url",
    "coverUrl",
    "cover_url",
    "thumbnailUrl",
    "thumbnail_url",
    "picUrl",
    "pic_url",
    "workUrl",
    "work_url",
    "designUrl",
    "design_url",
    "originalUrl",
    "original_url",
    "hdUrl",
    "hd_url",
    "url",
    "src",
    "sourceUrl",
    "pageUrl",
  ];

  const imageUrls = [];
  const seen = new Set();

  function addCandidate(rawUrl) {
    const candidate = normalizeCandidateUrl(rawUrl);
    if (!candidate || seen.has(candidate) || !isRelevantDynamicImage(candidate)) {
      return;
    }

    seen.add(candidate);
    imageUrls.push(candidate);
  }

  function walk(value) {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value === "object") {
      imageFields.forEach((field) => addCandidate(value[field]));
      Object.values(value).forEach(walk);
      return;
    }

    if (typeof value !== "string") {
      return;
    }

    addCandidate(value);
    const matches = value.match(/https?:\/\/[^"'\s<>)]+/gi) || [];
    matches.forEach(addCandidate);
  }

  walk(data);
  return imageUrls;
}

function extractPreviewUrlsFromArray(items) {
  const urls = [];

  for (const item of items || []) {
    if (typeof item === "string") {
      urls.push(item);
      continue;
    }

    if (!item || typeof item !== "object") {
      continue;
    }

    for (const field of SHARE_PREVIEW_FIELDS) {
      if (typeof item[field] === "string") {
        urls.push(item[field]);
      }
    }

    if (item.url && typeof item.url === "object") {
      for (const field of SHARE_PREVIEW_FIELDS) {
        if (typeof item.url[field] === "string") {
          urls.push(item.url[field]);
        }
      }
    }
  }

  return urls;
}

function normalizePreviewGroupUrls(urls) {
  return sortUrlsByPageToken(
    dedupeKeepOrder((urls || []).map(normalizeCandidateUrl).filter(Boolean)).filter(
      (url) => isDesignPageCandidate(url)
    )
  );
}

function collectPreviewGroupsFromData(data, source = "data", groups = []) {
  if (!data) {
    return groups;
  }

  if (Array.isArray(data)) {
    const groupUrls = normalizePreviewGroupUrls(extractPreviewUrlsFromArray(data));
    if (groupUrls.length > 1) {
      groups.push({
        source,
        urls: groupUrls,
      });
    }

    data.forEach((item, index) =>
      collectPreviewGroupsFromData(item, `${source}[${index}]`, groups)
    );
    return groups;
  }

  if (typeof data !== "object") {
    return groups;
  }

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const groupUrls = normalizePreviewGroupUrls(extractPreviewUrlsFromArray(value));
      if (groupUrls.length > 1) {
        groups.push({
          source: `${source}.${key}`,
          urls: groupUrls,
        });
      }
    }

    collectPreviewGroupsFromData(value, `${source}.${key}`, groups);
  }

  return groups;
}

function buildPreviewCandidateScore(candidate, preferredUrls = new Set()) {
  const url = String(candidate.url || "").trim();
  if (!url) {
    return -1000;
  }

  const lower = url.toLowerCase();
  if (BLOCKED_IMAGE_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return -1000;
  }

  let score = 0;
  if (preferredUrls.has(url)) {
    score += 220;
  }

  if (lower.includes("user_preview_ue")) {
    score += 480;
  } else if (lower.includes("user_preview")) {
    score += 380;
  } else if (lower.includes("preview")) {
    score += 140;
  }

  if (lower.includes("auth_key=")) {
    score += 50;
  }

  if (
    lower.includes("!l1600") ||
    lower.includes("!l2000") ||
    lower.includes("!l3000")
  ) {
    score += 50;
  }

  if (lower.includes(".jpg") || lower.includes(".jpeg")) {
    score += 35;
  } else if (lower.includes(".png")) {
    score += 20;
  }

  const area = Number(candidate.area || 0);
  const visibleArea = Number(candidate.visibleArea || 0);
  score += Math.min(Math.floor(area / 12000), 90);
  score += Math.min(Math.floor(visibleArea / 6000), 140);

  if (candidate.isCentered) {
    score += 25;
  }

  if (candidate.isLarge) {
    score += 35;
  }

  return score;
}

function selectSnapshotPreviewUrls(snapshot = {}, preferredUrls = [], limit = 3) {
  const preferredSet = new Set(
    preferredUrls.filter((item) => typeof item === "string" && item.trim())
  );
  const candidatesByUrl = new Map();

  function addCandidate(rawUrl, meta = {}) {
    const candidateUrl = normalizeCandidateUrl(rawUrl);
    if (!candidateUrl) {
      return;
    }

    const candidate = {
      url: candidateUrl,
      source: meta.source || "",
      area: Number(meta.area || 0),
      visibleArea: Number(meta.visibleArea || 0),
      isCentered: Boolean(meta.isCentered),
      isLarge: Boolean(meta.isLarge),
    };

    candidate.score = buildPreviewCandidateScore(candidate, preferredSet);
    if (candidate.score <= 0) {
      return;
    }

    const existing = candidatesByUrl.get(candidateUrl);
    if (existing && existing.score >= candidate.score) {
      return;
    }

    candidatesByUrl.set(candidateUrl, candidate);
  }

  for (const visibleCandidate of snapshot.visibleCandidates || []) {
    if (visibleCandidate && typeof visibleCandidate === "object") {
      addCandidate(visibleCandidate.url, visibleCandidate);
    }
  }

  for (const resourceUrl of snapshot.resourceUrls || []) {
    addCandidate(resourceUrl, { source: "resource" });
  }

  for (const imageUrl of snapshot.imageUrls || []) {
    addCandidate(imageUrl, { source: "image" });
  }

  return Array.from(candidatesByUrl.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.visibleArea !== a.visibleArea) return b.visibleArea - a.visibleArea;
      if (b.area !== a.area) return b.area - a.area;
      return a.url.localeCompare(b.url);
    })
    .slice(0, limit)
    .map((item) => item.url);
}

function mergeDynamicCapture(base = {}, snapshot = {}) {
  const merged = { ...base };

  merged.pageSource = merged.pageSource || "";
  merged.windowData = merged.windowData || {};
  merged.jsonData = merged.jsonData || [];
  merged.imageUrls = merged.imageUrls || [];
  merged.resourceUrls = merged.resourceUrls || [];
  merged.visibleCandidates = merged.visibleCandidates || [];
  merged.pageMarkers = merged.pageMarkers || [];
  merged.scrollTrace = merged.scrollTrace || [];
  merged.pageSnapshots = merged.pageSnapshots || [];
  merged.pageSpecificImages = merged.pageSpecificImages || [];

  if ((snapshot.pageSource || "").length >= merged.pageSource.length) {
    merged.pageSource = snapshot.pageSource || merged.pageSource;
  }

  for (const block of Object.values(snapshot.windowData || {})) {
    if (merged.jsonData.length < 200) merged.jsonData.push(block);
  }
  merged.windowData = {
    ...merged.windowData,
    ...(snapshot.windowData || {}),
  };

  const existingJsonKeys = new Set(merged.jsonData.map((item) => JSON.stringify(item)));
  for (const jsonItem of snapshot.jsonData || []) {
    const jsonKey = JSON.stringify(jsonItem);
    if (!existingJsonKeys.has(jsonKey)) {
      if (merged.jsonData.length < 200) merged.jsonData.push(jsonItem);
      existingJsonKeys.add(jsonKey);
    }
  }

  merged.imageUrls = dedupeKeepOrder(
    merged.imageUrls.concat(snapshot.imageUrls || [])
  );
  merged.resourceUrls = dedupeKeepOrder(
    merged.resourceUrls.concat(snapshot.resourceUrls || [])
  );
  merged.pageMarkers = dedupeKeepOrder(
    merged.pageMarkers.concat(snapshot.pageMarkers || [])
  );

  const visibleCandidatesByUrl = new Map();
  for (const candidate of merged.visibleCandidates.concat(
    snapshot.visibleCandidates || []
  )) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const candidateUrl = normalizeCandidateUrl(candidate.url);
    if (!candidateUrl) {
      continue;
    }

    const existing = visibleCandidatesByUrl.get(candidateUrl);
    const currentVisibleArea = Number(candidate.visibleArea || 0);
    const currentArea = Number(candidate.area || 0);

    if (existing) {
      const existingVisibleArea = Number(existing.visibleArea || 0);
      const existingArea = Number(existing.area || 0);
      if (
        existingVisibleArea > currentVisibleArea ||
        (existingVisibleArea === currentVisibleArea && existingArea >= currentArea)
      ) {
        continue;
      }
    }

    visibleCandidatesByUrl.set(candidateUrl, {
      ...candidate,
      url: candidateUrl,
    });
  }

  merged.visibleCandidates = Array.from(visibleCandidatesByUrl.values());

  if (snapshot.scrollState) {
    merged.scrollTrace.push(snapshot.scrollState);
  }

  return merged;
}

async function captureDynamicSnapshot(page) {
  const snapshot = await page.evaluate(() => {
    const result = {
      pageSource: document.documentElement.outerHTML,
      windowData: {},
      jsonData: [],
      imageUrls: [],
      resourceUrls: [],
      visibleCandidates: [],
      pageMarkers: [],
    };

    const imageUrlSet = new Set();
    const resourceUrlSet = new Set();
    const pageMarkerSet = new Set();
    const visibleCandidateMap = Object.create(null);

    function normalizeUrl(rawUrl) {
      if (!rawUrl || typeof rawUrl !== "string") return null;
      let candidate = rawUrl.trim().replace(/\\\//g, "/");
      if (!candidate) return null;
      if (candidate.startsWith("//")) candidate = `https:${candidate}`;
      return /^https?:\/\//i.test(candidate) ? candidate : null;
    }

    function normalizeText(text) {
      return String(text || "").replace(/\s+/g, "").trim();
    }

    function extractPage(text) {
      const normalized = normalizeText(text);
      const match = normalized.match(/^\u7b2c(\d+)\u9875$/);
      return match ? Number(match[1]) : null;
    }

    function addUrl(rawUrl) {
      const normalized = normalizeUrl(rawUrl);
      if (normalized) imageUrlSet.add(normalized);
    }

    function rememberVisibleCandidate(rawUrl, meta) {
      const normalized = normalizeUrl(rawUrl);
      if (!normalized) return;

      imageUrlSet.add(normalized);

      const candidate = {
        url: normalized,
        source: meta.source || "",
        width: Math.round(meta.width || 0),
        height: Math.round(meta.height || 0),
        area: Math.round(meta.area || 0),
        visibleArea: Math.round(meta.visibleArea || 0),
        isCentered: Boolean(meta.isCentered),
        isLarge: Boolean(meta.isLarge),
      };

      const existing = visibleCandidateMap[normalized];
      if (
        !existing ||
        candidate.visibleArea > existing.visibleArea ||
        candidate.area > existing.area
      ) {
        visibleCandidateMap[normalized] = candidate;
      }
    }

    function addUrlsFromStyle(styleValue) {
      if (!styleValue || styleValue === "none") return;
      const regex = /url\((['"]?)([^'")]+)\1\)/g;
      let match;
      while ((match = regex.exec(styleValue)) !== null) {
        addUrl(match[2]);
      }
    }

    try {
      if (window.__INITIAL_STATE__) result.windowData.initialState = window.__INITIAL_STATE__;
      if (window.__APP_DATA__) result.windowData.appData = window.__APP_DATA__;
      if (window.pageData) result.windowData.pageData = window.pageData;
      if (window.workData) result.windowData.workData = window.workData;
      if (window.imageData) result.windowData.imageData = window.imageData;
    } catch {
      // Ignore window data errors.
    }

    try {
      const scripts = document.querySelectorAll(
        'script[type="application/json"], script:not([src])'
      );
      scripts.forEach((script) => {
        try {
          const content = (script.textContent || script.innerHTML || "").trim();
          if (content.startsWith("{") || content.startsWith("[")) {
            result.jsonData.push(JSON.parse(content));
          }
        } catch {
          // Ignore non-JSON scripts.
        }
      });
    } catch {
      // Ignore inline JSON errors.
    }

    try {
      performance.getEntriesByType("resource").forEach((entry) => {
        try {
          const resourceUrl = normalizeUrl(entry.name);
          if (!resourceUrl) return;

          if (
            /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(resourceUrl) ||
            /user_preview|preview|auth_key=|ips_user_preview_api/i.test(resourceUrl)
          ) {
            resourceUrlSet.add(resourceUrl);
            imageUrlSet.add(resourceUrl);
          }
        } catch {
          // Ignore individual resource errors.
        }
      });
    } catch {
      // Ignore resource capture errors.
    }

    try {
      const elements = document.querySelectorAll("*");
      elements.forEach((el) => {
        try {
          const rect = el.getBoundingClientRect();
          const width = Math.max(rect.width || 0, 0);
          const height = Math.max(rect.height || 0, 0);
          const area = width * height;
          const visibleWidth = Math.max(
            0,
            Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)
          );
          const visibleHeight = Math.max(
            0,
            Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
          );
          const visibleArea = visibleWidth * visibleHeight;
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const centerDistance =
            Math.abs(centerX - window.innerWidth / 2) +
            Math.abs(centerY - window.innerHeight / 2);
          const isCentered =
            centerDistance < Math.max(window.innerWidth, window.innerHeight) * 0.45;
          const isLarge = width >= 240 && height >= 240;
          const baseMeta = {
            width,
            height,
            area,
            visibleArea,
            isCentered,
            isLarge,
          };

          ["src", "data-src", "data-original", "data-url", "data-background", "href", "poster"].forEach(
            (attr) => {
              const attrValue = el.getAttribute(attr);
              addUrl(attrValue);
              if (area > 2500 || visibleArea > 2500) {
                rememberVisibleCandidate(attrValue, { source: attr, ...baseMeta });
              }
            }
          );

          if (el.src) {
            addUrl(el.src);
            if (area > 2500 || visibleArea > 2500) {
              rememberVisibleCandidate(el.src, { source: "src", ...baseMeta });
            }
          }

          if (el.currentSrc) {
            addUrl(el.currentSrc);
            if (area > 2500 || visibleArea > 2500) {
              rememberVisibleCandidate(el.currentSrc, {
                source: "currentSrc",
                ...baseMeta,
              });
            }
          }

          const srcset = el.getAttribute("srcset") || "";
          if (srcset) {
            srcset.split(",").forEach((part) => {
              const srcsetUrl = part.trim().split(/\s+/)[0];
              addUrl(srcsetUrl);
              if (area > 2500 || visibleArea > 2500) {
                rememberVisibleCandidate(srcsetUrl, { source: "srcset", ...baseMeta });
              }
            });
          }

          addUrlsFromStyle(el.getAttribute("style") || "");
          const computedStyle = window.getComputedStyle(el);
          addUrlsFromStyle(computedStyle.backgroundImage);
          addUrlsFromStyle(computedStyle.background);
          addUrlsFromStyle(computedStyle.maskImage);

          [computedStyle.backgroundImage, computedStyle.background, computedStyle.maskImage].forEach(
            (styleValue) => {
              if (!styleValue || styleValue === "none") return;
              const regex = /url\((['"]?)([^'")]+)\1\)/g;
              let match;
              while ((match = regex.exec(styleValue)) !== null) {
                if (area > 2500 || visibleArea > 2500) {
                  rememberVisibleCandidate(match[2], {
                    source: "background",
                    ...baseMeta,
                  });
                }
              }
            }
          );

          const markerText = String(el.innerText || el.textContent || "").trim();
          if (markerText && markerText.length <= 12) {
            const pageNumber = extractPage(markerText);
            if (pageNumber) {
              pageMarkerSet.add(`page_${pageNumber}`);
            }
          }
        } catch {
          // Ignore single element errors.
        }
      });
    } catch {
      // Ignore DOM scan failures.
    }

    result.imageUrls = Array.from(imageUrlSet);
    result.resourceUrls = Array.from(resourceUrlSet);
    result.visibleCandidates = Object.keys(visibleCandidateMap).map(
      (key) => visibleCandidateMap[key]
    );
    result.pageMarkers = Array.from(pageMarkerSet);
    return result;
  });
  const controls = await page.evaluate(scanPageControls);
  snapshot.pageMarkers = dedupeKeepOrder(snapshot.pageMarkers.concat(controls.map(control => `page_${control.page}`)));
  snapshot.activePage = controls.find(control => control.active)?.page || null;
  snapshot.controls = controls;
  return snapshot;
}

// This adapter uses the existing 第N页 markers and explicit page attributes inside a
// page/thumb navigation context. Arbitrary numbered buttons are never clicked.
function scanPageControls() {
  const controls = [];
  for (const el of document.querySelectorAll("button,[role=tab],[role=button],[data-page],[data-page-number],[aria-label],[title],div,span")) {
    const text = String(el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.textContent || "").replace(/\s+/g, "");
    const label = text.length <= 14 && text.match(/^第?(\d+)页$/);
    const context = el.closest('[class*="page"],[class*="thumb"],[class*="slide"],[role="tablist"]');
    const attribute = context && (el.getAttribute("data-page") || el.getAttribute("data-page-number"));
    const number = Number(label?.[1] || attribute);
    if (!Number.isInteger(number) || number < 1 || number > 10000) continue;
    let target = el;
    for (let depth = 0; target && depth < 4; depth++, target = target.parentElement) {
      const style = getComputedStyle(target);
      const rect = target.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || !rect.width || !rect.height || target.disabled || target.getAttribute("aria-disabled") === "true") continue;
      if (target.matches("button,[role=button],[role=tab]") || style.cursor === "pointer" || typeof target.onclick === "function") {
        if (!controls.some(control => control.page === number)) controls.push({ page: number, active: target.getAttribute("aria-selected") === "true" || target.getAttribute("aria-current") === "page" || /(^|[\s_-])(active|selected|current)([\s_-]|$)/i.test(String(target.className)), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        break;
      }
    }
  }
  return controls.sort((a, b) => a.page - b.page);
}

async function activateDynamicPage(page, pageNumber) {
  const controls = await page.evaluate(scanPageControls);
  const marker = controls.find(control => control.page === pageNumber);
  if (!marker) return { requestedPage: pageNumber, clicked: false, reason: "interactive_marker_not_found" };
  if (marker.active) return { requestedPage: pageNumber, clicked: false, alreadyActive: true, reason: "already_active" };
  // Resolve/scroll exactly the selected control, then send a single native click.
  const position = await page.evaluate((targetPage) => {
    for (const el of document.querySelectorAll("button,[role=tab],[role=button],[data-page],[data-page-number],[aria-label],[title],div,span")) {
      const text = String(el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.textContent || "").replace(/\s+/g, "");
      const label = text.length <= 14 && text.match(/^第?(\d+)页$/);
      const context = el.closest('[class*="page"],[class*="thumb"],[class*="slide"],[role="tablist"]');
      const number = Number(label?.[1] || (context && (el.getAttribute("data-page") || el.getAttribute("data-page-number"))));
      if (number !== targetPage) continue;
      let target = el;
      for (let depth = 0; target && depth < 4; depth++, target = target.parentElement) {
        const style = getComputedStyle(target);
        if (target.disabled || style.visibility === "hidden" || style.display === "none") continue;
        if (target.matches("button,[role=button],[role=tab]") || style.cursor === "pointer" || typeof target.onclick === "function") {
          target.scrollIntoView({ block: "center", inline: "center" });
          const rect = target.getBoundingClientRect();
          if (rect.width && rect.height) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
    }
    return null;
  }, pageNumber);
  if (!position) return { requestedPage: pageNumber, clicked: false, reason: "control_not_interactable" };
  await page.mouse.click(position.x, position.y);
  return { requestedPage: pageNumber, clicked: true, reason: "clicked_awaiting_change" };
}

function currentPreviewUrls(snapshot) {
  const structured = [...(snapshot.jsonData || []), ...Object.values(snapshot.windowData || {})].flatMap(block => collectPageData(block).candidates);
  const known = new Set(structured.map(entry => imageIdentity(entry.imageUrl)));
  return (snapshot.visibleCandidates || []).filter(candidate => candidate.visibleArea > 0 && candidate.isLarge && (isDesignPageCandidate(candidate.url) || known.has(imageIdentity(candidate.url)))).sort((a, b) => b.visibleArea - a.visibleArea).slice(0, 1).map(candidate => candidate.url);
}

async function captureActivatedPage(page, pageNumber, before, deadline) {
  const activation = await activateDynamicPage(page, pageNumber);
  const previous = currentPreviewUrls(before).map(imageIdentity).join("|");
  let snapshot = before;
  let stable = 0;
  let last = "";
  for (let attempt = 0; attempt < 8 && Date.now() < deadline; attempt++) {
    await delay(350);
    snapshot = await captureDynamicSnapshot(page);
    const previews = currentPreviewUrls(snapshot);
    const key = previews.map(imageIdentity).join("|");
    stable = key && key === last ? stable + 1 : 0;
    last = key;
    // A changed active class alone is insufficient: the image may still be the old page.
    const changed = key && key !== previous;
    const sameActive = activation.alreadyActive && before.activePage === pageNumber;
    if (stable >= 1 && (sameActive || (activation.clicked && changed)) && (!snapshot.activePage || snapshot.activePage === pageNumber)) {
      return { ...snapshot, page: pageNumber, previewUrls: previews, activation: { ...activation, confirmed: true, reason: sameActive ? "active_preview_loaded" : "preview_changed" } };
    }
  }
  return { ...snapshot, page: pageNumber, previewUrls: [], activation: { ...activation, confirmed: false, reason: activation.clicked ? "preview_did_not_change_or_load" : activation.reason } };
}

async function scrollDynamicPage(page, roundIndex) {
  return page.evaluate((currentRound) => {
    function normalizeText(text) {
      return String(text || "").replace(/\s+/g, "").trim();
    }

    function extractPage(text) {
      const normalized = normalizeText(text);
      const match = normalized.match(/^\u7b2c(\d+)\u9875$/);
      return match ? Number(match[1]) : null;
    }

    const markers = [];
    Array.from(document.querySelectorAll("*")).forEach((el) => {
      try {
        const markerText = String(el.innerText || el.textContent || "").trim();
        if (!markerText || markerText.length > 12) return;

        const pageNumber = extractPage(markerText);
        if (!pageNumber) return;

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        markers.push({
          page: pageNumber,
          label: `page_${pageNumber}`,
          el,
        });
      } catch {
        // Ignore marker scan errors.
      }
    });

    markers.sort((a, b) => a.page - b.page);

    let focusedPage = null;
    if (markers.length) {
      const marker = markers[Math.min(currentRound, markers.length - 1)];
      try {
        marker.el.scrollIntoView({ block: "center", inline: "nearest" });
        focusedPage = marker.page;
      } catch {
        // Ignore scroll failures.
      }
    }

    let moved = 0;
    const containers = Array.from(document.querySelectorAll("*"))
      .filter((el) => {
        try {
          const style = window.getComputedStyle(el);
          const overflowY = style.overflowY || "";
          const rect = el.getBoundingClientRect();
          return (
            rect.width > 180 &&
            rect.height > 180 &&
            el.scrollHeight > el.clientHeight + 120 &&
            ["auto", "scroll", "overlay"].includes(overflowY)
          );
        } catch {
          return false;
        }
      })
      .sort(
        (a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
      )
      .slice(0, 8);

    containers.forEach((el) => {
      try {
        const before = el.scrollTop;
        const step = Math.max(el.clientHeight * 0.85, 260);
        el.scrollTop = Math.min(el.scrollTop + step, el.scrollHeight);
        if (el.scrollTop > before) moved += 1;
      } catch {
        // Ignore container scroll failures.
      }
    });

    try {
      const docEl = document.scrollingElement || document.documentElement || document.body;
      const beforeDoc = docEl.scrollTop;
      const docStep = Math.max(window.innerHeight * 0.9, 320);
      docEl.scrollTop = Math.min(docEl.scrollTop + docStep, docEl.scrollHeight);
      if (docEl.scrollTop > beforeDoc) moved += 1;
    } catch {
      // Ignore document scroll failures.
    }

    try {
      window.dispatchEvent(new Event("scroll"));
    } catch {
      // Ignore synthetic scroll failures.
    }

    return {
      moved,
      focusedPage,
      pageMarkers: markers.map((item) => item.label),
      scrollableContainers: containers.length,
    };
  }, roundIndex);
}

async function extractDynamicContent(url, options = {}) {
  const pool = options.browserPool || getDefaultPool();
  let browser = null;
  let page = null;
  let pageData = {};
  const networkJson = [];
  const pendingResponses = new Set();
  const deadline = Math.min(extractionContext.getStore()?.deadline || Infinity, Date.now() + (options.dynamicTimeout || 40000));
  try {
    browser = await pool.acquire(Math.min(10000, Math.max(1, deadline - Date.now())));
    diagnostic("browser", { pooled: true });
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 1 });
    await page.setUserAgent(getRandomUserAgent());
    await page.setExtraHTTPHeaders({ "Accept-Language": COMMON_HEADERS["Accept-Language"], Referer: "https://818ps.com/", Origin: "https://818ps.com" });
    await page.setRequestInterception(true);
    page.on("request", request => {
      (["font", "media"].includes(request.resourceType()) ? request.abort() : request.continue()).catch(() => {});
    });
    page.on("response", response => {
      if (networkJson.length >= 100 || Date.now() >= deadline || !/\bjson\b/i.test(response.headers()["content-type"] || "") || !/(^|\.)(818ps|tuguaishou)\.com$/.test(new URL(response.url()).hostname) || Number(response.headers()["content-length"] || 0) > 2000000) return;
      const task = response.text().then(text => { if (text.length <= 2000000 && networkJson.length < 100) { try { networkJson.push(JSON.parse(text)); } catch {} } }).catch(() => {}).finally(() => pendingResponses.delete(task));
      pendingResponses.add(task);
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(options.timeout || BROWSER_TIMEOUT, Math.max(1, deadline - Date.now())) });
    await delay(1500);
    pageData = mergeDynamicCapture({}, await captureDynamicSnapshot(page));
    if (options.resourceDiscoveryOnly) {
      // Complete page coverage still doesn't prove an original was discovered.
      // Inspect passive public data once, without export/login interactions.
      await delay(Math.min(1200, Math.max(0, deadline - Date.now())));
      pageData = mergeDynamicCapture(pageData, await captureDynamicSnapshot(page));
      pageData.jsonData.push(...networkJson.slice(0, 100));
      pageData.officialDownloadRequiresLogin = await page.evaluate(() => /登录即可下载无水印大图/.test(document.body.innerText));
      diagnostic("original_resource_discovery", { passive: true, jsonResponses: networkJson.length, officialDownloadRequiresLogin: pageData.officialDownloadRequiresLogin });
      return pageData;
    }
    let previousCount = 0;
    let idleRounds = 0;
    for (let round = 0; round < 8 && Date.now() < deadline; round++) {
      const scrollState = await scrollDynamicPage(page, round);
      await delay(600);
      const snapshot = await captureDynamicSnapshot(page);
      snapshot.scrollState = scrollState;
      pageData = mergeDynamicCapture(pageData, snapshot);
      const count = pageData.pageMarkers.length + pageData.imageUrls.length;
      idleRounds = !scrollState.moved && count === previousCount ? idleRounds + 1 : 0;
      previousCount = count;
      if (idleRounds >= 3) break;
    }
    pageData.jsonData.push(...networkJson);
    const evidence = [...pageData.jsonData, ...Object.values(pageData.windowData)].flatMap(block => collectPageData(block).evidence);
    const expected = resolveEvidence(evidence).expectedPageCount || options.expectedPageCount;
    const targets = [...new Set([...(pageData.pageMarkers || []).map(extractPageNumber).filter(Boolean), ...(expected ? Array.from({ length: Math.min(expected, MAX_PAGES) }, (_, index) => index + 1) : [])])].sort((a, b) => a - b).slice(0, MAX_PAGES);
    const pageSnapshots = [];
    for (const pageNumber of targets) {
      if (Date.now() >= deadline) { pageData.warnings = ["dynamic_budget_exhausted"]; break; }
      const before = await captureDynamicSnapshot(page);
      const snapshot = await captureActivatedPage(page, pageNumber, before, deadline);
      diagnostic("activation", { page: pageNumber, ...snapshot.activation, previews: snapshot.previewUrls.length });
      pageData = mergeDynamicCapture(pageData, snapshot);
      pageSnapshots.push(snapshot);
    }
    pageData.pageSnapshots = pageSnapshots;
    pageData.jsonData.push(...networkJson.slice(0, 100));
    diagnostic("network", { jsonResponses: networkJson.length });
    return pageData;
  } catch (error) {
    diagnostic("dynamic_failure", { reason: error.code || error.message });
    if (!pageData.jsonData && !networkJson.length) throw error;
    pageData.jsonData = [...(pageData.jsonData || []), ...networkJson];
    pageData.warnings = [`dynamic_interrupted:${error.name}`];
    return pageData;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) pool.release(browser);
  }
}

async function extractPageSpecificImageUrls(dynamicData) {
  let pageSnapshots = dynamicData.pageSnapshots || [];

  if (!pageSnapshots.length && Array.isArray(dynamicData.pageSpecificImages)) {
    pageSnapshots = dynamicData.pageSpecificImages.map((imageUrl, index) => ({
      page: index + 1,
      previewUrls: [imageUrl],
    }));
  }

  if (!pageSnapshots.length) {
    return [];
  }

  const orderedSnapshots = [...pageSnapshots].sort((a, b) => {
    const pageA = Number(a.page || 0);
    const pageB = Number(b.page || 0);
    if (pageA !== pageB) return pageA - pageB;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });

  const resolvedUrls = [];
  const seenUrls = new Set();

  for (const snapshot of orderedSnapshots) {
    const candidateUrls = [];

    for (const key of ["previewUrls", "newUrls", "resourceUrls", "imageUrls"]) {
      for (const rawUrl of snapshot[key] || []) {
        const normalizedUrl = normalizeCandidateUrl(rawUrl);
        if (!normalizedUrl || candidateUrls.includes(normalizedUrl)) {
          continue;
        }

        if (!isDesignPageCandidate(normalizedUrl)) {
          continue;
        }

        candidateUrls.push(normalizedUrl);
      }
    }

    if (!candidateUrls.length) {
      continue;
    }

    const entries = candidateUrls
      .map((candidateUrl) => ({
        url: candidateUrl,
        source: "page_specific",
        score: scoreDynamicImage(candidateUrl, "page_specific"),
      }))
      .sort((a, b) => b.score - a.score);

    const validUrls = await validateImageEntryUrls(entries);
    if (!validUrls.length) {
      continue;
    }

    const chosenUrl = validUrls[0];
    if (seenUrls.has(chosenUrl)) {
      continue;
    }

    seenUrls.add(chosenUrl);
    resolvedUrls.push(chosenUrl);
  }

  return sortUrlsByPageToken(resolvedUrls);
}

function collectDynamicImageCandidates(dynamicData) {
  const candidatesByUrl = new Map();

  function addCandidate(rawUrl, source) {
    const candidateUrl = normalizeCandidateUrl(rawUrl);
    if (!candidateUrl || !isRelevantDynamicImage(candidateUrl)) {
      return;
    }

    const score = scoreDynamicImage(candidateUrl, source);
    const existing = candidatesByUrl.get(candidateUrl);
    if (existing && existing.score >= score) {
      return;
    }

    candidatesByUrl.set(candidateUrl, {
      url: candidateUrl,
      source,
      score,
    });
  }

  for (const imageUrl of dynamicData.imageUrls || []) addCandidate(imageUrl, "direct");
  for (const imageUrl of dynamicData.resourceUrls || []) addCandidate(imageUrl, "resource");
  for (const imageUrl of dynamicData.pageSpecificImages || []) {
    addCandidate(imageUrl, "page_specific");
  }

  for (const pageSnapshot of dynamicData.pageSnapshots || []) {
    [
      ["previewUrls", "page_specific"],
      ["newUrls", "page_specific"],
      ["resourceUrls", "resource"],
      ["imageUrls", "page_snapshot"],
    ].forEach(([key, source]) => {
      for (const imageUrl of pageSnapshot[key] || []) {
        addCandidate(imageUrl, source);
      }
    });
  }

  for (const imageUrl of extractImageUrlsFromContent(dynamicData.pageSource || "")) {
    addCandidate(imageUrl, "page_source");
  }

  for (const jsonBlock of dynamicData.jsonData || []) {
    for (const imageUrl of extractImageUrlsFromData(jsonBlock)) {
      addCandidate(imageUrl, "json");
    }
  }

  for (const windowBlock of Object.values(dynamicData.windowData || {})) {
    for (const imageUrl of extractImageUrlsFromData(windowBlock)) {
      addCandidate(imageUrl, "window");
    }
  }

  return Array.from(candidatesByUrl.values());
}

async function analyzeDynamicData(dynamicData, originalUrl) {
  const collection = { candidates: [], evidence: [], excluded: [] };
  const blocks = [...(dynamicData.jsonData || []), ...Object.values(dynamicData.windowData || {})];
  blocks.forEach((block, index) => {
    const parsed = collectPageData(block, `dynamic.json[${index}]`);
    for (const key of Object.keys(collection)) collection[key].push(...parsed[key]);
  });
  const targets = (dynamicData.pageMarkers || []).map(extractPageNumber).filter(Boolean);
  if (targets.length) collection.evidence.push({ count: Math.max(...targets), confidence: "inferred", source: "dynamic.page_markers" });
  for (const snapshot of dynamicData.pageSnapshots || []) {
    if (!snapshot.activation?.confirmed) continue;
    for (const imageUrl of snapshot.previewUrls || []) {
      collection.candidates.push({ imageUrl, source: "dynamic_page_activation", pageNumber: snapshot.page, pageId: null, role: "page_preview", score: 1200 });
    }
  }
  if (!collection.candidates.length) {
    // Unmapped DOM fallback is intentionally a single unknown preview, never a page list.
    const entries = collectDynamicImageCandidates(dynamicData).filter(entry => isDesignPageCandidate(entry.url)).sort((a, b) => b.score - a.score).slice(0, 12);
    entries.forEach(entry => collection.candidates.push({ imageUrl: entry.url, source: entry.source, role: "page_preview", score: entry.score, pageNumber: null }));
  }
  diagnostic("dynamic_counts", { json: blocks.length, dom: (dynamicData.imageUrls || []).length, performance: (dynamicData.resourceUrls || []).length, activation: (dynamicData.pageSnapshots || []).length });
  const result = await validatePageCollection(collection, collection.candidates.some(entry => entry.source === "dynamic_page_activation") ? "dynamic_page_activation" : "dynamic_json_extraction");
  return { ...result, originalUrl, metadata: { ...result.metadata, officialDownloadRequiresLogin: Boolean(dynamicData.officialDownloadRequiresLogin) }, warnings: [...result.warnings, ...(dynamicData.warnings || [])] };
}

async function fetchJson(url, referer) {
  try {
    const response = await axios.get(url, {
      timeout: SHARE_API_TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": getRandomUserAgent(),
        "Accept-Language": COMMON_HEADERS["Accept-Language"],
        Referer: referer || "https://ue.818ps.com/",
        Origin: "https://818ps.com",
      },
    });

    if (response.status !== 200 || typeof response.data !== "object" || !response.data) {
      return null;
    }

    return response.data;
  } catch (error) {
    diagnostic("share_api_failure", { endpoint: url, reason: error.code || error.message });
    return null;
  }
}

function extractExpectedPageCountFromShareApiPayloads(payloads = {}) {
  return resolveEvidence(collectPageData(payloads, "share_api").evidence).expectedPageCount;
}

function extractShareApiPreviewGroups(payloads = {}) {
  const collection = collectPageData(payloads, "share_api");
  return { ...collection, expectedPageCount: resolveEvidence(collection.evidence).expectedPageCount, groups: collection.candidates.map(candidate => ({ source: candidate.source, urls: [candidate.imageUrl] })) };
}

async function extractFromShareApi(url) {
  const queryParams = extractShareQueryParams(url);
  const { shareId, upicId, shareUid, saveType, userSource } = queryParams;

  if (!shareId) {
    return null;
  }

  const endpoints = [
    [
      "share_template",
      `https://818ps.com/apiV1/template/index/share-template?share_id=${shareId}`,
    ],
  ];

  if (upicId && shareUid) {
    endpoints.push(
      [
        "team_share_get_templ",
        "https://818ps.com/api/team-share-get-templ" +
          `?upicId=${upicId}&share_uid=${shareUid}&share_id=${shareId}` +
          `&save_type=${encodeURIComponent(saveType)}&user_source=${encodeURIComponent(userSource)}`,
      ],
      [
        "get_template_page_data",
        "https://818ps.com/apiv2/get-template-page-data" +
          `?picId=0&upicId=${upicId}&version_id=0&user_template_team_id=0` +
          `&paperId=0&share_uid=${shareUid}`,
      ],
      [
        "get_template_info",
        "https://818ps.com/apiv2/get-template-info" +
          `?picId=0&paperId=0&upicId=${upicId}&version_id=0` +
          `&user_template_team_id=0&share_uid=${shareUid}`,
      ]
    );
  }

  const payloads = {};
  for (const [name, endpoint] of endpoints) {
    const payload = await fetchJson(endpoint, url);
    if (payload) {
      payloads[name] = payload;
    }
  }

  const collection = collectPageData(payloads, "share_api");
  collection.animationTarget = Boolean(payloads.team_share_get_templ?.doc?.pageAttr?.pageInfo?.some(page => page.gifInfo?.length));
  diagnostic("share_api_structure", { pageMap: payloads.team_share_get_templ?.page_map, pageInfoCount: payloads.team_share_get_templ?.doc?.pageAttr?.pageInfo?.length, animationElementReferences: payloads.team_share_get_templ?.doc?.pageAttr?.pageInfo?.reduce((count, page) => count + (page.gifInfo?.length || 0), 0) || 0, note: "gifInfo.imagePath is a canvas animation element; not a rendered full design" });
  return validatePageCollection(collection, "share_api");
}

function buildUpicIdCandidates(upicId, picId) {
  if (!upicId) {
    return [];
  }

  const candidates = [];
  const previewBases = [
    `https://img.818ps.com/user_preview_ue/${upicId}`,
    `https://img.818ps.com/user_preview/${upicId}`,
    `https://cdn.818ps.com/user_preview_ue/${upicId}`,
    `https://cdn.818ps.com/user_preview/${upicId}`,
    `https://img.tuguaishou.com/user_preview_ue/${upicId}`,
    `https://img.tuguaishou.com/user_preview/${upicId}`,
  ];

  for (const base of previewBases) {
    candidates.push(`${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`);
  }

  if (picId) {
    const picBases = [
      `https://img.818ps.com/pic/${upicId}/${picId}`,
      `https://cdn.818ps.com/pic/${upicId}/${picId}`,
      `https://static.818ps.com/pic/${upicId}/${picId}`,
      `https://img.tuguaishou.com/pic/${upicId}/${picId}`,
    ];

    for (const base of picBases) {
      candidates.push(`${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`);
    }
  }

  return dedupeKeepOrder(
    candidates
      .map(normalizeCandidateUrl)
      .filter(Boolean)
      .flatMap((candidate) => [candidate].concat(build818psVariants(candidate)))
  );
}

async function extractWithUpicIdPriority(upicId, picId, originalUrl) {
  const candidateUrls = buildUpicIdCandidates(upicId, picId);
  const firstValid = await findFirstValidCandidate(candidateUrls);

  if (!firstValid) {
    return null;
  }

  return buildSuccessResult([firstValid], {
    source: "user_path_priority",
    originalUrl,
    metadata: {
      totalFound: candidateUrls.length,
      afterFilter: candidateUrls.length,
      afterDedup: 1,
    },
  });
}

function extractMetaImageFromHtml($) {
  const selectors = [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'link[rel="image_src"]',
  ];

  for (const selector of selectors) {
    const element = $(selector);
    const value = element.attr("content") || element.attr("href");
    const normalized = normalizeCandidateUrl(value);
    if (normalized && isRelevantDynamicImage(normalized)) {
      return normalized;
    }
  }

  return null;
}

function extractJsonData(html) {
  const jsonBlocks = [];
  const $ = cheerio.load(html);

  $('script[type="application/json"], script:not([src])').each((_, element) => {
    const content = $(element).html() || "";
    const trimmed = content.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return;
    }

    try {
      jsonBlocks.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON blocks.
    }
  });

  return jsonBlocks;
}

function extractWithCheerio($) {
  const candidateUrls = [];

  function addCandidate(rawUrl) {
    const normalizedUrl = normalizeCandidateUrl(rawUrl);
    if (normalizedUrl && isRelevantDynamicImage(normalizedUrl)) {
      candidateUrls.push(normalizedUrl);
    }
  }

  $("img").each((_, element) => {
    const attributes = [
      "src",
      "data-src",
      "data-original",
      "data-url",
      "data-background",
      "poster",
    ];

    attributes.forEach((attribute) => addCandidate($(element).attr(attribute)));

    const srcset = $(element).attr("srcset") || "";
    srcset.split(",").forEach((part) => {
      const srcsetUrl = part.trim().split(/\s+/)[0];
      addCandidate(srcsetUrl);
    });
  });

  $("[style]").each((_, element) => {
    const style = $(element).attr("style") || "";
    const regex = /url\((['"]?)([^'")]+)\1\)/g;
    let match;
    while ((match = regex.exec(style)) !== null) {
      addCandidate(match[2]);
    }
  });

  return dedupeKeepOrder(candidateUrls);
}

function extractWithRegexFallback(html) {
  return dedupeKeepOrder(extractImageUrlsFromContent(html));
}

async function scrapeWebpageEnhanced(url, options = {}) {
  const response = await axios.get(url, {
    timeout: options.timeout || STATIC_TIMEOUT,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      ...COMMON_HEADERS,
      "User-Agent": getRandomUserAgent(),
      Referer: "https://818ps.com/",
      Origin: "https://818ps.com",
    },
  });

  if (response.status >= 400 || typeof response.data !== "string") {
    return null;
  }

  const html = response.data;
  const $ = cheerio.load(html);
  if (/邀请链接失效/.test($(".div-child .font1").text())) {
    diagnostic("share_unavailable", { reason: "share_link_expired" });
    return buildPageResult([], [], { source: "static_html", error: "share_link_expired", warnings: ["share_link_expired"] });
  }
  const jsonBlocks = extractJsonData(html);
  const metaImage = extractMetaImageFromHtml($);
  const cheerioUrls = extractWithCheerio($);
  const regexUrls = extractWithRegexFallback(html);
  const jsonUrls = dedupeKeepOrder(
    jsonBlocks.flatMap((block) => extractImageUrlsFromData(block))
  );

  const collection = { candidates: [], evidence: [], excluded: [] };
  jsonBlocks.forEach((block, index) => {
    const parsed = collectPageData(block, `static.json[${index}]`);
    for (const key of Object.keys(collection)) collection[key].push(...parsed[key]);
  });
  const combinedUrls = dedupeKeepOrder([...cheerioUrls, ...jsonUrls, ...regexUrls, metaImage].filter(Boolean));
  if (!collection.candidates.length) {
    const fallback = combinedUrls.filter(isDesignPageCandidate).sort((a, b) => scoreDynamicImage(b) - scoreDynamicImage(a)).slice(0, 12);
    if (metaImage && !fallback.includes(metaImage)) fallback.push(metaImage);
    fallback.forEach(imageUrl => collection.candidates.push({ imageUrl, source: "static_html", role: "page_preview", pageNumber: null, score: scoreDynamicImage(imageUrl) }));
  }
  diagnostic("static_counts", { html: combinedUrls.length, structured: collection.candidates.length, jsonBlocks: jsonBlocks.length });
  return validatePageCollection(collection, "static_html");
}

async function extract818ps(url, options = {}) {
  const context = { requestId: options.requestId || require("crypto").randomBytes(4).toString("hex"), deadline: Date.now() + Math.min(options.totalTimeout || 90000, 120000), validations: new Map() };
  return extractionContext.run(context, async () => {
    const normalizedUrl = normalizeCandidateUrl(url);
    if (!normalizedUrl) return buildFailureResult("missing_or_invalid_url");
    const resolvedUrl = await resolve818psShareUrl(normalizedUrl);
    context.animationTarget = options.animationTarget === true || new URL(resolvedUrl).hostname === "gif.818ps.com";
    const query = extractShareQueryParams(resolvedUrl);
    diagnostic("request", { platform: "818ps", target: resolvedUrl });
    const results = [];
    const stages = [];
    if (query.shareId) stages.push(["share_api", () => extractFromShareApi(resolvedUrl)]);
    if (query.upicId) stages.push(["known_path", async () => {
      const direct = await extractWithUpicIdPriority(query.upicId, query.picId, resolvedUrl);
      return direct ? { ...direct, candidates: direct.imageUrls.map(imageUrl => ({ imageUrl, source: "known_path", role: "page_preview", pageNumber: null, score: 200, validationStatus: "valid" })), evidence: [] } : null;
    }]);
    stages.push(["static_html", () => scrapeWebpageEnhanced(resolvedUrl, options)]);
    stages.push(["dynamic", async () => {
      const merged = mergeStageResults(results);
      const resourceDiscoveryOnly = context.animationTarget && merged.isComplete && merged.isAnimated === true;
      return analyzeDynamicData(await extractDynamicContent(resolvedUrl, { ...options, expectedPageCount: merged.expectedPageCount, resourceDiscoveryOnly, ...(resourceDiscoveryOnly ? { dynamicTimeout: 12000, timeout: Math.min(options.timeout || 10000, 10000) } : {}) }), resolvedUrl);
    }]);
    for (const [stage, run] of stages) {
      // Predicted preview paths cannot supply business proof of an original.
      if (stage === "known_path" && context.animationTarget && mergeStageResults(results).isComplete) continue;
      if (Date.now() >= context.deadline) { results.push({ warnings: ["extraction_budget_exhausted"] }); break; }
      diagnostic("stage_start", { stage });
      try {
        const result = await run();
        if (result) results.push(result);
        if (result?.animationTarget || result?.isAnimated === true) context.animationTarget = true;
        if (result?.error === "share_link_expired") break;
      }
      catch (error) { diagnostic("stage_failure", { stage, reason: error.code || error.message }); results.push({ warnings: [`${stage}_failed:${error.code || error.name}`] }); }
      const merged = mergeStageResults(results);
      diagnostic("coverage", { stage, expected: merged.expectedPageCount, confidence: merged.pageCountConfidence, identified: merged.pages.map(page => page.pageNumber), missing: merged.missingPages, completeness: merged.completenessStatus });
      const allPagesAuthorized = merged.pages.length > 0 && merged.pages.every(page => ["original_animation", "authorized_export"].includes(page.resourceRole));
      if (merged.isComplete && (!context.animationTarget || allPagesAuthorized || stage === "dynamic")) break;
    }
    const result = mergeStageResults(results);
    diagnostic("resource_selected", { source: result.pages[0]?.source, resourceRole: result.resourceRole, detectedFormat: result.detectedFormat, mediaType: result.mediaType, isAnimated: result.isAnimated, frameCount: result.frameCount, durationMs: result.durationMs, animationStatus: result.animationStatus, hasVisibleWatermark: result.hasVisibleWatermark, originalResourceStatus: result.originalResourceStatus, downloadStatus: result.downloadStatus, selectionReason: result.selectionReason, originalResourceDiscovery: result.metadata.originalResourceDiscovery });
    diagnostic("final", { source: result.source, expected: result.expectedPageCount, verifiedPreviews: result.pageCount, missing: result.missingPages, duplicates: result.metadata.duplicateCandidates, rejectedPageMappings: result.metadata.rejectedPageMappings, completeness: result.completenessStatus, mediaType: result.mediaType, isAnimated: result.isAnimated, animationStatus: result.animationStatus });
    // Internal candidates are diagnostic working data; expose only selected main previews.
    delete result.candidates;
    return attachResolvedUrlContext(result.success ? result : { ...result, error: "no_valid_page_preview", message: "image_extract_failed" }, normalizedUrl, resolvedUrl);
  });
}

module.exports = { extract818ps, validateImageUrl, validateImageResource, normalizeResultImages,
  _test: { validatePageCollection, extractFromShareApi, scrapeWebpageEnhanced, analyzeDynamicData, extractDynamicContent, captureDynamicSnapshot, activateDynamicPage, captureActivatedPage, currentPreviewUrls, mergeStageResults, build818psVariants, imageMagic } };
