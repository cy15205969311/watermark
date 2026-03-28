const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

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
  const rawPages = Array.isArray(result.pages) ? result.pages : [];
  const pageUrls = rawPages
    .map((page) => normalizeCandidateUrl(page && page.imageUrl))
    .filter(Boolean);

  const uniqueUrls = sortUrlsByPageToken(
    dedupeKeepOrder(
      [
        ...(Array.isArray(result.imageUrls) ? result.imageUrls : []),
        ...(Array.isArray(result.images) ? result.images : []),
        ...pageUrls,
        result.imageUrl,
      ]
        .map(normalizeCandidateUrl)
        .filter(Boolean)
    )
  );

  const pages = buildPages(uniqueUrls);
  const metadata = {
    ...(result.metadata || {}),
    results: uniqueUrls.length,
  };

  return {
    success: result.success !== false,
    platform: "818ps",
    ...result,
    imageUrl: uniqueUrls[0] || null,
    imageUrls: uniqueUrls,
    images: uniqueUrls,
    pages,
    pageCount: uniqueUrls.length,
    isMultiPage: uniqueUrls.length > 1,
    metadata,
  };
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
        Referer: "https://818ps.com/",
        Origin: "https://818ps.com",
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
  if (![200, 206].includes(status)) {
    return false;
  }

  if (!isImageContentType(headers)) {
    return false;
  }

  const fileSize = extractReportedSize(headers);
  if (fileSize !== null && fileSize < 10 * 1024) {
    return false;
  }

  return true;
}

async function validateImageUrl(imageUrl) {
  const normalizedUrl = normalizeCandidateUrl(imageUrl);
  if (!normalizedUrl) {
    return false;
  }

  const headers = getAntiHotlinkHeaders(normalizedUrl);

  try {
    const headResp = await axios.head(normalizedUrl, {
      headers,
      timeout: 2000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (isValidImageResponse(headResp.status, headResp.headers)) {
      return true;
    }

    if (headResp.status === 404) {
      return false;
    }
  } catch {
    // Ignore HEAD failures and try ranged GET.
  }

  try {
    const rangeResp = await axios.get(normalizedUrl, {
      headers: {
        ...headers,
        Range: "bytes=0-0",
      },
      timeout: 2000,
      maxRedirects: 5,
      responseType: "arraybuffer",
      validateStatus: () => true,
    });

    return isValidImageResponse(rangeResp.status, rangeResp.headers);
  } catch {
    return false;
  }
}

async function findFirstValidCandidate(candidateUrls) {
  const normalizedCandidates = dedupeKeepOrder(
    (candidateUrls || []).map(normalizeCandidateUrl).filter(Boolean)
  );

  if (!normalizedCandidates.length) {
    return null;
  }

  return new Promise((resolve) => {
    let pending = normalizedCandidates.length;
    let settled = false;

    normalizedCandidates.forEach((candidateUrl) => {
      validateImageUrl(candidateUrl)
        .then((isValid) => {
          if (settled) {
            return;
          }

          if (isValid) {
            settled = true;
            resolve(candidateUrl);
            return;
          }

          pending -= 1;
          if (pending <= 0) {
            resolve(null);
          }
        })
        .catch(() => {
          if (settled) {
            return;
          }

          pending -= 1;
          if (pending <= 0) {
            resolve(null);
          }
        });
    });
  });
}

function build818psVariants(url) {
  const variants = new Set();
  if (typeof url !== "string" || !url) {
    return [];
  }

  const baseUrl = url.split("?")[0];
  const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";

  variants.add(baseUrl.replace(/!l\d+(_b)?$/i, ""));
  variants.add(baseUrl.replace(/!\w+$/i, ""));
  variants.add(baseUrl.replace(/ips_user_preview_api\//i, "pic/"));
  variants.add(baseUrl.replace(/user_preview_ue\//i, "pic/"));
  variants.add(baseUrl.replace(/preview/gi, "origin"));
  variants.add(baseUrl.replace(/psd_import\//i, "pic/"));

  const baseWithoutExt = baseUrl.replace(/\.(jpeg|jpg|png|webp)(!.*)?$/i, "");
  [".png", ".jpg", ".jpeg", ".webp"].forEach((ext) =>
    variants.add(`${baseWithoutExt}${ext}`)
  );

  const result = Array.from(variants);
  if (query) {
    return dedupeKeepOrder(result.concat(result.map((item) => `${item}${query}`)));
  }

  return result;
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

  const results = await Promise.all(
    normalizedEntries.map((entry) => validateImageUrl(entry.url))
  );

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

  merged.windowData = {
    ...merged.windowData,
    ...(snapshot.windowData || {}),
  };

  const existingJsonKeys = new Set(merged.jsonData.map((item) => JSON.stringify(item)));
  for (const jsonItem of snapshot.jsonData || []) {
    const jsonKey = JSON.stringify(jsonItem);
    if (!existingJsonKeys.has(jsonKey)) {
      merged.jsonData.push(jsonItem);
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
  return page.evaluate(() => {
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
}

async function activateDynamicPage(page, pageNumber) {
  return page.evaluate((targetPage) => {
    function normalizeText(text) {
      return String(text || "").replace(/\s+/g, "").trim();
    }

    function extractPage(text) {
      const normalized = normalizeText(text);
      const match = normalized.match(/^\u7b2c(\d+)\u9875$/);
      return match ? Number(match[1]) : null;
    }

    function isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function findClickable(el) {
      let current = el;
      let fallback = el;

      for (let depth = 0; current && depth < 6; depth += 1) {
        try {
          if (isVisible(current)) fallback = current;

          const style = window.getComputedStyle(current);
          const className = String(current.className || "");
          const clickable =
            current.tagName === "BUTTON" ||
            current.tagName === "A" ||
            current.getAttribute("role") === "button" ||
            current.tabIndex >= 0 ||
            typeof current.onclick === "function" ||
            String(style.cursor || "").includes("pointer") ||
            /page|thumb|item|card|preview|cover|list/i.test(className);

          if (clickable && isVisible(current)) {
            return current;
          }
        } catch {
          // Ignore clickable traversal errors.
        }

        current = current.parentElement;
      }

      return fallback;
    }

    const markers = [];
    Array.from(document.querySelectorAll("*")).forEach((el) => {
      try {
        if (!isVisible(el)) return;
        const markerText = String(el.innerText || el.textContent || "").trim();
        if (!markerText || markerText.length > 12) return;

        const pageNumberFromText = extractPage(markerText);
        if (!pageNumberFromText) return;

        markers.push({
          page: pageNumberFromText,
          label: `page_${pageNumberFromText}`,
          el,
        });
      } catch {
        // Ignore marker extraction errors.
      }
    });

    markers.sort((a, b) => a.page - b.page);
    const marker = markers.find((item) => item.page === targetPage);
    if (!marker) {
      return {
        requestedPage: targetPage,
        label: `page_${targetPage}`,
        clicked: false,
        reason: "marker_not_found",
        availablePages: markers.map((item) => item.label),
      };
    }

    const target = findClickable(marker.el);
    try {
      target.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
      // Ignore scroll failures.
    }

    const rect = target.getBoundingClientRect();
    const clientX = Math.max(
      rect.left + Math.min(rect.width / 2, Math.max(rect.width - 8, 1)),
      1
    );
    const clientY = Math.max(
      rect.top + Math.min(rect.height / 2, Math.max(rect.height - 8, 1)),
      1
    );
    let clicked = false;

    function dispatchMouse(el, type) {
      try {
        el.dispatchEvent(
          new MouseEvent(type, {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            buttons: 1,
          })
        );
        return true;
      } catch {
        return false;
      }
    }

    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      if (dispatchMouse(target, type)) {
        clicked = true;
      }
    });

    try {
      target.click();
      clicked = true;
    } catch {
      // Ignore direct click failures.
    }

    if (marker.el !== target) {
      try {
        marker.el.click();
        clicked = true;
      } catch {
        // Ignore marker click failures.
      }
    }

    try {
      const overlay = document.elementFromPoint(clientX, clientY);
      if (overlay && overlay !== target && overlay !== marker.el) {
        overlay.click();
        clicked = true;
      }
    } catch {
      // Ignore overlay click failures.
    }

    try {
      target.focus({ preventScroll: true });
    } catch {
      // Ignore focus failures.
    }

    return {
      requestedPage: targetPage,
      label: `page_${targetPage}`,
      clicked,
      reason: clicked ? "clicked" : "no_click_effect",
      availablePages: markers.map((item) => item.label),
    };
  }, pageNumber);
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
  let browser = null;

  try {
    const launchOptions = {
      headless: options.headless !== false ? "new" : false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 1 });
    await page.setUserAgent(getRandomUserAgent());
    await page.setExtraHTTPHeaders({
      "Accept-Language": COMMON_HEADERS["Accept-Language"],
      Referer: "https://818ps.com/",
      Origin: "https://818ps.com",
    });

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const resourceType = request.resourceType();
      if (["font", "media"].includes(resourceType)) {
        request.abort();
        return;
      }

      request.continue();
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeout || BROWSER_TIMEOUT,
    });

    await delay(5000);

    let pageData = mergeDynamicCapture({}, await captureDynamicSnapshot(page));
    let previousImageCount = (pageData.imageUrls || []).length;
    let idleRounds = 0;

    for (let roundIndex = 0; roundIndex < 8; roundIndex += 1) {
      const scrollState = await scrollDynamicPage(page, roundIndex);
      await delay(1200);

      const snapshot = await captureDynamicSnapshot(page);
      snapshot.scrollState = scrollState;
      pageData = mergeDynamicCapture(pageData, snapshot);

      const currentImageCount = (pageData.imageUrls || []).length;
      const gainedImages = currentImageCount - previousImageCount;
      previousImageCount = currentImageCount;

      if ((scrollState.moved || 0) <= 0 && gainedImages <= 0) {
        idleRounds += 1;
      } else {
        idleRounds = 0;
      }

      if (idleRounds >= 2) {
        break;
      }
    }

    const pageTargets = dedupeKeepOrder(
      (pageData.pageMarkers || [])
        .map(extractPageNumber)
        .filter((pageNumber) => Number.isInteger(pageNumber))
        .map(String)
    ).map((value) => Number(value));

    const pageSnapshots = [];
    const pageSpecificImages = [];
    const seenSnapshotUrls = new Set(
      dedupeKeepOrder((pageData.imageUrls || []).concat(pageData.resourceUrls || []))
    );

    for (const pageNumber of pageTargets) {
      const activationState = await activateDynamicPage(page, pageNumber);
      await delay(1200);

      const snapshot = await captureDynamicSnapshot(page);
      snapshot.page = pageNumber;
      snapshot.label = `page_${pageNumber}`;
      snapshot.activation = activationState;

      const snapshotUrlPool = dedupeKeepOrder(
        (snapshot.imageUrls || []).concat(snapshot.resourceUrls || [])
      );
      const newUrls = snapshotUrlPool.filter((imageUrl) => !seenSnapshotUrls.has(imageUrl));
      const previewUrls = selectSnapshotPreviewUrls(snapshot, newUrls, 3);

      snapshot.newUrls = newUrls;
      snapshot.previewUrls = previewUrls;

      pageData = mergeDynamicCapture(pageData, snapshot);
      pageSnapshots.push(snapshot);

      if (previewUrls.length) {
        pageSpecificImages.push(previewUrls[0]);
      }

      snapshotUrlPool.forEach((item) => seenSnapshotUrls.add(item));
    }

    pageData.pageSnapshots = pageSnapshots;
    pageData.pageSpecificImages = dedupeKeepOrder(pageSpecificImages);

    return pageData;
  } finally {
    if (browser) {
      await browser.close();
    }
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
  const pageSpecificUrls = await extractPageSpecificImageUrls(dynamicData);
  if (pageSpecificUrls.length > 1) {
    return buildSuccessResult(pageSpecificUrls, {
      source: "dynamic_page_activation",
      originalUrl,
      metadata: {
        totalFound: (dynamicData.imageUrls || []).length,
        afterFilter: pageSpecificUrls.length,
        afterDedup: pageSpecificUrls.length,
      },
    });
  }

  const structuredGroups = [];
  for (const jsonBlock of dynamicData.jsonData || []) {
    collectPreviewGroupsFromData(jsonBlock, "browser.json", structuredGroups);
  }

  for (const windowBlock of Object.values(dynamicData.windowData || {})) {
    collectPreviewGroupsFromData(windowBlock, "browser.window", structuredGroups);
  }

  for (const group of structuredGroups) {
    const entries = group.urls.map((candidateUrl) => ({
      url: candidateUrl,
      source: "json",
      score: scoreDynamicImage(candidateUrl, "json"),
    }));

    const validUrls = await validateImageEntryUrls(entries);
    if (validUrls.length > 1) {
      return buildSuccessResult(validUrls, {
        source: `dynamic_structured_${group.source}`,
        originalUrl,
        metadata: {
          totalFound: (dynamicData.imageUrls || []).length,
          afterFilter: group.urls.length,
          afterDedup: validUrls.length,
        },
      });
    }
  }

  const candidateEntries = collectDynamicImageCandidates(dynamicData);
  const pageCandidates = candidateEntries.filter((entry) =>
    isDesignPageCandidate(entry.url)
  );

  if (pageCandidates.length) {
    const validPageUrls = await validateImageEntryUrls(pageCandidates);
    if (validPageUrls.length) {
      const mergedPageUrls = [];
      const seenPageUrls = new Set();

      for (const imageUrl of pageSpecificUrls.concat(validPageUrls)) {
        const normalizedUrl = normalizeCandidateUrl(imageUrl);
        if (!normalizedUrl || seenPageUrls.has(normalizedUrl)) {
          continue;
        }

        seenPageUrls.add(normalizedUrl);
        mergedPageUrls.push(normalizedUrl);
      }

      return buildSuccessResult(mergedPageUrls, {
        source:
          pageSpecificUrls.length > 0
            ? "dynamic_page_activation"
            : mergedPageUrls.length > 1
              ? "dynamic_multi_page_extraction"
              : "dynamic_json_extraction",
        originalUrl,
        metadata: {
          totalFound: candidateEntries.length,
          afterFilter: pageCandidates.length,
          afterDedup: mergedPageUrls.length,
        },
      });
    }
  }

  if (pageSpecificUrls.length) {
    return buildSuccessResult(pageSpecificUrls, {
      source: "dynamic_page_activation",
      originalUrl,
      metadata: {
        totalFound: candidateEntries.length,
        afterFilter: pageSpecificUrls.length,
        afterDedup: pageSpecificUrls.length,
      },
    });
  }

  const bestCandidate = [...candidateEntries].sort((a, b) => b.score - a.score)[0];
  if (bestCandidate && (await validateImageUrl(bestCandidate.url))) {
    return buildSuccessResult([bestCandidate.url], {
      source: "dynamic_json_extraction",
      originalUrl,
      metadata: {
        totalFound: candidateEntries.length,
        afterFilter: candidateEntries.length,
        afterDedup: 1,
      },
    });
  }

  return null;
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
  } catch {
    return null;
  }
}

function extractExpectedPageCountFromShareApiPayloads(payloads = {}) {
  const counts = [];

  const shareTemplateData = payloads.share_template && payloads.share_template.data;
  if (shareTemplateData && Array.isArray(shareTemplateData.preview)) {
    counts.push(shareTemplateData.preview.length);
  }

  const teamSharePayload = payloads.team_share_get_templ;
  if (teamSharePayload && typeof teamSharePayload === "object") {
    if (teamSharePayload.page_map && typeof teamSharePayload.page_map === "object") {
      counts.push(Object.keys(teamSharePayload.page_map).length);
    }

    if (Array.isArray(teamSharePayload.preview)) {
      counts.push(teamSharePayload.preview.length);
    }

    const pageInfo =
      teamSharePayload.doc &&
      teamSharePayload.doc.pageAttr &&
      teamSharePayload.doc.pageAttr.pageInfo;

    if (Array.isArray(pageInfo)) {
      counts.push(pageInfo.length);
    }
  }

  const pageDataPayload = payloads.get_template_page_data;
  if (pageDataPayload && pageDataPayload.url && Array.isArray(pageDataPayload.url.preview)) {
    counts.push(pageDataPayload.url.preview.length);
  }

  return Math.max(...counts.filter((count) => count > 0), 0);
}

function extractShareApiPreviewGroups(payloads = {}) {
  const groups = [];
  const expectedPageCount = extractExpectedPageCountFromShareApiPayloads(payloads);

  function addGroup(source, rawUrls) {
    const urls = normalizePreviewGroupUrls(rawUrls);
    if (urls.length) {
      groups.push({
        source,
        urls,
      });
    }
  }

  const shareTemplateData = payloads.share_template && payloads.share_template.data;
  if (shareTemplateData && Array.isArray(shareTemplateData.preview)) {
    addGroup("share_template", shareTemplateData.preview);
  }

  const teamSharePayload = payloads.team_share_get_templ;
  if (teamSharePayload && Array.isArray(teamSharePayload.preview)) {
    addGroup("team_share_get_templ", teamSharePayload.preview);
  }

  const pageDataPayload = payloads.get_template_page_data;
  if (pageDataPayload && pageDataPayload.url && Array.isArray(pageDataPayload.url.preview)) {
    addGroup(
      "get_template_page_data",
      extractPreviewUrlsFromArray(pageDataPayload.url.preview)
    );
  }

  return {
    groups,
    expectedPageCount,
  };
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

  const { groups, expectedPageCount } = extractShareApiPreviewGroups(payloads);
  if (!groups.length) {
    return null;
  }

  let bestPartialResult = null;

  for (const group of groups) {
    const entries = group.urls.map((candidateUrl) => ({
      url: candidateUrl,
      source: `share_api_${group.source}`,
      score: scoreDynamicImage(candidateUrl, `share_api_${group.source}`),
    }));

    const validUrls = await validateImageEntryUrls(entries);
    if (!validUrls.length) {
      continue;
    }

    const result = buildSuccessResult(validUrls, {
      source: `share_api_${group.source}`,
      originalUrl: url,
      expectedPageCount,
      metadata: {
        totalFound: group.urls.length,
        afterFilter: group.urls.length,
        afterDedup: validUrls.length,
        expectedPageCount,
      },
    });

    if (expectedPageCount <= 1 || validUrls.length >= expectedPageCount || validUrls.length > 1) {
      return result;
    }

    if (!bestPartialResult || validUrls.length > bestPartialResult.imageUrls.length) {
      bestPartialResult = result;
    }
  }

  return bestPartialResult;
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
  const jsonBlocks = extractJsonData(html);
  const metaImage = extractMetaImageFromHtml($);
  const cheerioUrls = extractWithCheerio($);
  const regexUrls = extractWithRegexFallback(html);
  const jsonUrls = dedupeKeepOrder(
    jsonBlocks.flatMap((block) => extractImageUrlsFromData(block))
  );

  const previewGroups = [];
  jsonBlocks.forEach((block, index) =>
    collectPreviewGroupsFromData(block, `static.json[${index}]`, previewGroups)
  );

  for (const group of previewGroups) {
    const entries = group.urls.map((candidateUrl) => ({
      url: candidateUrl,
      source: "json",
      score: scoreDynamicImage(candidateUrl, "json"),
    }));

    const validUrls = await validateImageEntryUrls(entries);
    if (validUrls.length > 1) {
      return buildSuccessResult(validUrls, {
        source: `static_group_${group.source}`,
        originalUrl: url,
        metadata: {
          totalFound: group.urls.length,
          afterFilter: group.urls.length,
          afterDedup: validUrls.length,
        },
      });
    }
  }

  const combinedUrls = dedupeKeepOrder(
    []
      .concat(cheerioUrls)
      .concat(jsonUrls)
      .concat(regexUrls)
      .concat(metaImage ? [metaImage] : [])
  );

  const pageCandidates = combinedUrls.filter((candidateUrl) =>
    isDesignPageCandidate(candidateUrl)
  );

  if (pageCandidates.length) {
    const entries = pageCandidates
      .map((candidateUrl) => ({
        url: candidateUrl,
        source: "page_source",
        score: scoreDynamicImage(candidateUrl, "page_source"),
      }))
      .sort((a, b) => b.score - a.score);

    const validUrls = await validateImageEntryUrls(entries);
    if (validUrls.length > 1) {
      return buildSuccessResult(validUrls, {
        source: "static_multi_page_extraction",
        originalUrl: url,
        metadata: {
          totalFound: combinedUrls.length,
          afterFilter: pageCandidates.length,
          afterDedup: validUrls.length,
        },
      });
    }
  }

  if (metaImage) {
    const metaCandidates = [metaImage].concat(build818psVariants(metaImage));
    const bestMeta = await findFirstValidCandidate(metaCandidates);
    if (bestMeta) {
      return buildSuccessResult([bestMeta], {
        source: "meta_image",
        originalUrl: url,
        metadata: {
          totalFound: combinedUrls.length,
          afterFilter: pageCandidates.length,
          afterDedup: 1,
        },
      });
    }
  }

  const bestSingleCandidate = combinedUrls
    .map((candidateUrl) => ({
      url: candidateUrl,
      source: "page_source",
      score: scoreDynamicImage(candidateUrl, "page_source"),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const validSingleUrls = await validateImageEntryUrls(bestSingleCandidate);
  if (validSingleUrls.length) {
    return buildSuccessResult([validSingleUrls[0]], {
      source: "static_best_candidate",
      originalUrl: url,
      metadata: {
        totalFound: combinedUrls.length,
        afterFilter: bestSingleCandidate.length,
        afterDedup: 1,
      },
    });
  }

  return null;
}

async function extract818ps(url, options = {}) {
  try {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      return buildFailureResult("missing_url");
    }

    const resolvedUrl = await resolve818psShareUrl(normalizedUrl);
    const extractionUrl = resolvedUrl || normalizedUrl;
    const queryParams = extractShareQueryParams(extractionUrl);

    if (queryParams.shareId) {
      const shareApiResult = await extractFromShareApi(extractionUrl);
      if (shareApiResult && shareApiResult.success && shareApiResult.imageUrl) {
        return attachResolvedUrlContext(
          shareApiResult,
          normalizedUrl,
          extractionUrl
        );
      }
    }

    if (queryParams.upicId) {
      const directResult = await extractWithUpicIdPriority(
        queryParams.upicId,
        queryParams.picId,
        extractionUrl
      );
      if (directResult && directResult.success && directResult.imageUrl) {
        return attachResolvedUrlContext(directResult, normalizedUrl, extractionUrl);
      }
    }

    const staticResult = await scrapeWebpageEnhanced(extractionUrl, options);
    if (staticResult && staticResult.success && staticResult.imageUrl) {
      return attachResolvedUrlContext(staticResult, normalizedUrl, extractionUrl);
    }

    const dynamicData = await extractDynamicContent(extractionUrl, options);
    const dynamicResult = await analyzeDynamicData(dynamicData, extractionUrl);
    if (dynamicResult && dynamicResult.success && dynamicResult.imageUrl) {
      return attachResolvedUrlContext(dynamicResult, normalizedUrl, extractionUrl);
    }

    if (queryParams.upicId) {
      const directRetryResult = await extractWithUpicIdPriority(
        queryParams.upicId,
        queryParams.picId,
        extractionUrl
      );
      if (directRetryResult && directRetryResult.success && directRetryResult.imageUrl) {
        return attachResolvedUrlContext(
          directRetryResult,
          normalizedUrl,
          extractionUrl
        );
      }
    }

    return attachResolvedUrlContext(
      buildFailureResult("no_valid_image_found"),
      normalizedUrl,
      extractionUrl
    );
  } catch (error) {
    return buildFailureResult(error);
  }
}

module.exports = {
  extract818ps,
  validateImageUrl,
  normalizeResultImages,
};
