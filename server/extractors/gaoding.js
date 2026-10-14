if (typeof global.File === "undefined") {
  global.File = class File extends Buffer {};
}
if (typeof global.Blob === "undefined") {
  global.Blob = class Blob {
    constructor(parts = []) {
      this.parts = parts;
    }
  };
}

const axios = require("axios");
const cheerio = require("cheerio");
const { getDefaultPool } = require("../services/browser-pool");
const { redact } = require("./818ps-pages");

const IMAGE_URL_PATTERN =
  /(?<url>(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>\\]*)?)/i;

const POSITIVE_PATH_HINTS = [
  "preview",
  "cover",
  "poster",
  "image",
  "page",
  "pages",
  "artboard",
  "artboards",
  "slide",
  "slides",
  "canvas",
  "frame",
  "frames",
  "work",
  "template",
  "render",
];

const NEGATIVE_PATH_HINTS = [
  "recommend",
  "banner",
  "search",
  "material",
  "resource",
  "sidebar",
  "widget",
  "header",
  "footer",
  "placeholder",
  "avatar",
  "icon",
  "logo",
  "hot",
  "ad",
];

const GAODING_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: "https://www.gaoding.com/",
  Origin: "https://www.gaoding.com",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const STATIC_TIMEOUT = 15000;
const VALIDATE_TIMEOUT = 8000;
const DYNAMIC_TIMEOUT = 45000;
const MIN_PRIMARY_IMAGE_WIDTH = 320;
const MIN_PRIMARY_IMAGE_HEIGHT = 320;
const MIN_PRIMARY_IMAGE_BYTES = 24 * 1024;

const HTML_ENTITY_MAP = {
  "&quot;": '"',
  "&#34;": '"',
  "&#x22;": '"',
  "&amp;": "&",
  "&#38;": "&",
  "&#x26;": "&",
  "&lt;": "<",
  "&#60;": "<",
  "&#x3c;": "<",
  "&gt;": ">",
  "&#62;": ">",
  "&#x3e;": ">",
  "&nbsp;": " ",
  "&#160;": " ",
  "&#xa0;": " ",
  "&#47;": "/",
  "&#x2f;": "/",
};

function buildFailureResult(message, originalUrl, extras = {}) {
  const normalizedMessage =
    typeof message === "string"
      ? message
      : message && typeof message.message === "string"
        ? message.message
        : "gaoding_extract_failed";

  return {
    success: false,
    platform: "Gaoding",
    imageUrl: null,
    thumbnailUrl: null,
    imageUrls: [],
    images: [],
    pages: [],
    pageCount: 0,
    isMultiPage: false,
    original_url: originalUrl || null,
    message: normalizedMessage,
    error: normalizedMessage,
    ...extras,
  };
}

function normalizeGaodingInputUrl(inputUrl) {
  if (typeof inputUrl !== "string") {
    return "";
  }

  const trimmed = inputUrl.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = String(parsed.hostname || "").toLowerCase();

    if (/(^|\.)(gaoding\.com|gaoding\.cn)$/.test(hostname)) {
      let fragment = parsed.hash.slice(1);
      try { fragment = decodeURIComponent(fragment); } catch {}
      if (/我分享了|点击链接查看|点击.*查看吧/.test(fragment)) parsed.hash = "";
    }

    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function classifyLink(url) {
  try {
    const parsed = new URL(url);
    const path = String(parsed.pathname || "")
      .replace(/\/+$/, "")
      .toLowerCase();
    const queryKeys = new Set(
      Array.from(parsed.searchParams.keys()).map((key) =>
        String(key || "").toLowerCase()
      )
    );
    const designQueryKeys = new Set([
      "templateid",
      "template_id",
      "workid",
      "work_id",
      "shareid",
      "share_id",
      "id",
    ]);

    if (path.includes("share") || path.includes("invite")) return "share";
    if (Array.from(designQueryKeys).some((key) => queryKeys.has(key))) {
      if (path.includes("/editor/design")) {
        return "editor";
      }
      if (path.includes("/templates/")) {
        return "template";
      }
      return "detail";
    }

    if (["", "/creation", "/templates", "/create-design"].includes(path)) {
      return "listing";
    }
    if (path.includes("/editor/design")) {
      return "editor";
    }
    if (path.startsWith("/templates/")) {
      return "template";
    }
    if (path.includes("share") || path.includes("invite")) {
      return "share";
    }
    if (path.startsWith("/creation/")) {
      return "creation";
    }

    return "detail";
  } catch {
    return "detail";
  }
}

function decodeHtmlText(text) {
  return String(text || "").replace(
    /&(?:quot|amp|lt|gt|nbsp);|&#(?:34|38|60|62|160|47);|&#x(?:22|26|3c|3e|a0|2f);/gi,
    (match) => HTML_ENTITY_MAP[match.toLowerCase()] || match
  );
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCandidateUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    return null;
  }

  let candidateText = decodeHtmlText(rawUrl).trim();
  if (!candidateText) {
    return null;
  }

  candidateText = candidateText
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u003d/gi, "=")
    .replace(/&amp;/gi, "&")
    .replace(/\\+$/g, "");

  const match = candidateText.match(IMAGE_URL_PATTERN);
  if (!match) {
    return null;
  }

  let candidateUrl = (match.groups && match.groups.url) || match[0];
  candidateUrl = candidateUrl.replace(/[)"',;}\]]+$/g, "");

  if (candidateUrl.startsWith("//")) {
    candidateUrl = `https:${candidateUrl}`;
  }

  if (!/^https?:\/\//i.test(candidateUrl)) {
    return null;
  }

  candidateUrl = candidateUrl.split("#", 1)[0];
  return stripGaodingOssProcess(candidateUrl);
}

function stripGaodingOssProcess(imageUrl) {
  try {
    const parsed = new URL(imageUrl);
    const hostname = String(parsed.hostname || "").toLowerCase();
    if (
      !hostname.includes("dancf.com") &&
      !hostname.includes("gaoding.com") &&
      !hostname.includes("gaoding.cn")
    ) {
      return imageUrl;
    }

    let removed = false;
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (String(key || "").toLowerCase() === "x-oss-process") {
        parsed.searchParams.delete(key);
        removed = true;
      }
    }

    if (!removed) {
      return imageUrl;
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return imageUrl;
  }
}

function candidateKey(imageUrl) {
  try {
    const parsed = new URL(imageUrl);
    parsed.hash = "";

    for (const key of Array.from(parsed.searchParams.keys())) {
      const lowered = String(key || "").toLowerCase();
      if (lowered === "x-oss-process" || lowered === "format") {
        parsed.searchParams.delete(key);
      }
    }

    return parsed.toString();
  } catch {
    return imageUrl;
  }
}

function dedupeEntries(entries) {
  const seen = new Set();
  const ordered = [];

  for (const entry of entries || []) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }

    const [imageUrl, hint] = entry;
    const key = candidateKey(imageUrl);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ordered.push([imageUrl, hint]);
  }

  return ordered;
}

function dedupeUrls(imageUrls) {
  const seen = new Set();
  const ordered = [];

  for (const imageUrl of imageUrls || []) {
    const normalized = normalizeCandidateUrl(imageUrl);
    if (!normalized) {
      continue;
    }

    const key = candidateKey(normalized);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ordered.push(normalized);
  }

  return ordered;
}

function isGaodingDesignCandidate(imageUrl) {
  const normalized = normalizeCandidateUrl(imageUrl);
  if (!normalized) {
    return false;
  }

  const lowered = normalized.toLowerCase();
  const hostname = (() => {
    try {
      return String(new URL(normalized).hostname || "").toLowerCase();
    } catch {
      return "";
    }
  })();

  if (
    !hostname.includes("gaoding.com") &&
    !hostname.includes("gaoding.cn") &&
    !hostname.includes("dancf.com")
  ) {
    return false;
  }

  if (/\.(?:svg|ico|css|js)(?:[?#]|$)/i.test(lowered)) {
    return false;
  }

  const blockedKeywords = [
    "favicon",
    "icon",
    "logo",
    "avatar",
    "badge",
    "button",
    "toolbar",
    "cursor",
    "placeholder",
    "header",
    "footer",
    "sprite",
    "apps/gaoding/assets/",
    "/design-tokens/",
    "/npm:@gdesign/",
  ];

  if (blockedKeywords.some((keyword) => lowered.includes(keyword))) {
    return false;
  }

  return (
    /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(lowered) ||
    lowered.includes("/market-operations/") ||
    ["/preview", "/cover", "/poster", "/render"].some((keyword) =>
      lowered.includes(keyword)
    )
  );
}

function extractCandidatesFromData(data, path) {
  const candidates = [];

  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      candidates.push(...extractCandidatesFromData(item, `${path}[${index}]`));
    });
    return candidates;
  }

  if (data && typeof data === "object") {
    Object.entries(data).forEach(([key, value]) => {
      const nextPath = path ? `${path}.${key}` : key;
      candidates.push(...extractCandidatesFromData(value, nextPath));
    });
    return candidates;
  }

  if (typeof data === "string") {
    const normalized = normalizeCandidateUrl(data);
    if (normalized) {
      candidates.push([normalized, path]);
    }
  }

  return candidates;
}

function extractMetaCandidates($) {
  const candidates = [];
  const metaSelectors = [
    ['meta[property="og:image"]', "content", "meta:og:image"],
    ['meta[name="twitter:image"]', "content", "meta:twitter:image"],
    ['link[rel="image_src"]', "href", "meta:image_src"],
  ];

  metaSelectors.forEach(([selector, attr, hint]) => {
    const element = $(selector).first();
    if (!element || !element.length) {
      return;
    }

    const candidateUrl = normalizeCandidateUrl(element.attr(attr));
    if (candidateUrl) {
      candidates.push([candidateUrl, hint]);
    }
  });

  return candidates;
}

function extractDomCandidates($) {
  const candidates = [];

  $("img").each((_, element) => {
    ["src", "data-src", "data-original", "data-url"].forEach((attr) => {
      const candidateUrl = normalizeCandidateUrl($(element).attr(attr));
      if (candidateUrl) {
        candidates.push([candidateUrl, `img:${attr}`]);
      }
    });

    const srcset = $(element).attr("srcset") || "";
    srcset
      .split(",")
      .map((item) => item.trim().split(/\s+/)[0])
      .forEach((value) => {
        const candidateUrl = normalizeCandidateUrl(value);
        if (candidateUrl) {
          candidates.push([candidateUrl, "img:srcset"]);
        }
      });
  });

  $("source").each((_, element) => {
    const candidateUrl = normalizeCandidateUrl(
      $(element).attr("srcset") || $(element).attr("src")
    );
    if (candidateUrl) {
      candidates.push([candidateUrl, "source"]);
    }
  });

  $("video").each((_, element) => {
    const candidateUrl = normalizeCandidateUrl($(element).attr("poster"));
    if (candidateUrl) {
      candidates.push([candidateUrl, "video:poster"]);
    }
  });

  return candidates;
}

function extractJsonCandidates($) {
  const candidates = [];

  $("script").each((_, element) => {
    const content = $(element).html() || $(element).text() || "";
    const trimmed = content.trim();

    if (!trimmed || !["{", "["].includes(trimmed[0])) {
      return;
    }

    try {
      const data = JSON.parse(trimmed);
      candidates.push(...extractCandidatesFromData(data, "script"));
    } catch {
      // Ignore non-JSON scripts.
    }
  });

  return candidates;
}

function extractContextualUrlsFromText(text) {
  if (!text) {
    return [];
  }

  const candidates = [];
  const pattern =
    /(?<url>(?:https?:)?\/\/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>]*)?)/gi;

  for (const match of text.matchAll(pattern)) {
    const candidateUrl =
      normalizeCandidateUrl(
        (match.groups && match.groups.url) || match[0] || ""
      ) || null;

    if (!candidateUrl) {
      continue;
    }

    const startIndex = typeof match.index === "number" ? match.index : 0;
    const contextStart = Math.max(0, startIndex - 96);
    const context = text.slice(contextStart, startIndex);
    candidates.push([candidateUrl, context]);
  }

  return candidates;
}

function extractObjectUrl(text, fieldName) {
  const pattern = new RegExp(
    `"${escapeRegExp(
      fieldName
    )}"\\s*:\\s*\\{.*?"url"\\s*:\\s*(null|"(?<url>https?:\\/\\/[^"]+)")`,
    "is"
  );
  const match = text.match(pattern);
  if (!match) {
    return null;
  }

  return normalizeCandidateUrl((match.groups && match.groups.url) || "");
}

function extractArrayObjectUrls(text, fieldName) {
  const pattern = new RegExp(
    `"${escapeRegExp(fieldName)}"\\s*:\\s*\\[(?<body>[\\s\\S]*?)\\]`,
    "i"
  );
  const match = text.match(pattern);
  if (!match) {
    return [];
  }

  const body = (match.groups && match.groups.body) || "";
  const urls = [];

  for (const urlMatch of body.matchAll(/"url"\s*:\s*"([^"]+)"/gi)) {
    const normalized = normalizeCandidateUrl(urlMatch[1]);
    if (normalized) {
      urls.push(normalized);
    }
  }

  return dedupeUrls(urls);
}

function extractDesignInfoUrlFromHtml(htmlContent) {
  const decodedText = decodeHtmlText(htmlContent || "");
  if (!decodedText) {
    return null;
  }

  const pattern =
    /"design_info"\s*:\s*\{\s*"url"\s*:\s*(null|"(?<url>https?:\/\/[^"]+)")/i;
  const match = decodedText.match(pattern);
  if (!match) {
    return null;
  }

  return decodeHtmlText((match.groups && match.groups.url) || "").trim() || null;
}

function extractPreviewBundleFromHtml(htmlContent) {
  const decodedText = decodeHtmlText(htmlContent || "");
  if (!decodedText) {
    return [];
  }

  let primaryUrl = extractObjectUrl(decodedText, "source_preview_info");
  let primaryHint = "html.source_preview_info.url";

  if (!primaryUrl) {
    primaryUrl = extractObjectUrl(decodedText, "preview_info");
    primaryHint = "html.preview_info.url";
  }

  const extendsPreviewUrls = extractArrayObjectUrls(
    decodedText,
    "extends_previews"
  );

  const bundleEntries = [];
  if (primaryUrl) {
    bundleEntries.push([primaryUrl, primaryHint]);
  }

  extendsPreviewUrls.forEach((imageUrl, index) => {
    bundleEntries.push([imageUrl, `html.extends_previews[${index}].url`]);
  });

  return dedupeEntries(bundleEntries);
}

function extractPagePreviewUrlsFromDesignData(data) {
  const state = createExtractionState('https://www.gaoding.com/detail');
  collectDesignData(data, state, { trusted: true, source: 'design-json-pages', path: 'design_json' });
  const groups = new Map();
  for (const candidate of state.candidates) {
    const old = groups.get(candidate.pageKey);
    if (!old || candidate.score > old.score) groups.set(candidate.pageKey, candidate);
  }
  return [...groups.values()].map(candidate => candidate.url);
}

function candidateGroupKey(hint) {
  const loweredHint = String(hint || "").toLowerCase();
  if (!loweredHint) {
    return "";
  }

  if (!loweredHint.includes(".") && !loweredHint.includes("[")) {
    return "";
  }

  let groupKey = loweredHint.replace(/\[\d+\]/g, "[]");
  groupKey = groupKey.replace(
    /\.(?:url|src|image|images|cover|covers|preview|previews|poster|thumbnail|source)$/i,
    ""
  );

  return groupKey.replace(/^\.+|\.+$/g, "");
}

function selectBestMultiPageGroup(entries) {
  const groupedEntries = {};

  for (const entry of entries || []) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }

    const [imageUrl, hint] = entry;
    const normalized = normalizeCandidateUrl(imageUrl);
    if (!normalized || !isGaodingDesignCandidate(normalized)) {
      continue;
    }

    const groupKey = candidateGroupKey(hint);
    if (!groupKey) {
      continue;
    }

    if (!groupedEntries[groupKey]) {
      groupedEntries[groupKey] = [];
    }
    groupedEntries[groupKey].push([normalized, hint]);
  }

  let bestGroup = [];
  let bestScore = 0;

  Object.entries(groupedEntries).forEach(([groupKey, groupEntries]) => {
    const dedupedGroup = dedupeEntries(groupEntries);
    if (dedupedGroup.length < 2) {
      return;
    }

    const loweredGroupKey = groupKey.toLowerCase();
    let score = Math.min(dedupedGroup.length, 6);

    if (
      POSITIVE_PATH_HINTS.some((token) => loweredGroupKey.includes(token))
    ) {
      score += 6;
    }
    if (
      NEGATIVE_PATH_HINTS.some((token) => loweredGroupKey.includes(token))
    ) {
      score -= 6;
    }
    if (dedupedGroup.length > 12) {
      score -= 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestGroup = dedupedGroup;
    }
  });

  return bestScore >= 7 ? bestGroup : [];
}

function scoreCandidate(imageUrl, hint, linkType) {
  if (!isGaodingDesignCandidate(imageUrl)) {
    return -1000;
  }

  const urlLower = String(imageUrl || "").toLowerCase();
  const hintLower = String(hint || "").toLowerCase();
  const hostname = (() => {
    try {
      return String(new URL(imageUrl).hostname || "").toLowerCase();
    } catch {
      return "";
    }
  })();

  let score = 0;

  if (hostname.endsWith("gaoding-market.dancf.com")) {
    score += 260;
  } else if (hostname.endsWith("gaoding-market-fat.dancf.com")) {
    score += 240;
  } else if (hostname.endsWith("dancf.com")) {
    score += 120;
  } else if (
    hostname.includes("gaoding.com") ||
    hostname.includes("gaoding.cn")
  ) {
    score += 80;
  }

  if (urlLower.includes("/market-operations/")) {
    score += 90;
  }
  if (urlLower.includes("/side/")) {
    score += 45;
  }

  if (urlLower.includes(".jpg") || urlLower.includes(".jpeg")) {
    score += 35;
  } else if (urlLower.includes(".png")) {
    score += 30;
  } else if (urlLower.includes(".webp")) {
    score += 20;
  } else if (urlLower.includes(".gif")) {
    score += 10;
  }

  if (urlLower.includes("x-oss-process=")) {
    score -= 15;
  }

  [
    ["source_preview_info", 340],
    ["original_preview_info", 320],
    ["export_url", 320],
    ["download_url", 300],
    ["original_url", 280],
    ["origin_url", 260],
    ["source_url", 240],
    ["raw_url", 220],
    ["full_url", 200],
    ["master_url", 200],
    ["hd_url", 180],
  ].forEach(([keyword, bonus]) => {
    if (hintLower.includes(keyword)) {
      score += bonus;
    }
  });

  [
    ["export", 220],
    ["download", 200],
    ["original", 180],
    ["origin", 160],
    ["source", 120],
    ["raw", 100],
    ["full", 80],
    ["master", 80],
    ["hd", 60],
  ].forEach(([keyword, bonus]) => {
    if (urlLower.includes(keyword)) {
      score += bonus;
    }
    if (hintLower.includes(keyword)) {
      score += Math.floor(bonus / 2);
    }
  });

  [
    ["preview", 60],
    ["cover", 120],
    ["poster", 90],
    ["page", 80],
    ["artboard", 90],
    ["slide", 80],
    ["frame", 75],
    ["work", 70],
    ["render", 70],
    ["template", 60],
    ["image", 45],
  ].forEach(([keyword, bonus]) => {
    if (urlLower.includes(keyword)) {
      score += bonus;
    }
    if (hintLower.includes(keyword)) {
      score += Math.floor(bonus / 2);
    }
  });

  if (
    hintLower.includes("preview_info") &&
    !hintLower.includes("source_preview_info")
  ) {
    score -= 120;
  }
  if (
    ["watermark", "with_wm", "with-watermark"].some(
      (token) => urlLower.includes(token) || hintLower.includes(token)
    )
  ) {
    score -= 260;
  }

  if (hintLower.includes("meta:og:image")) {
    score += 220;
  } else if (hintLower.includes("meta:twitter:image")) {
    score += 180;
  } else if (hintLower.includes("video:poster")) {
    score += 140;
  } else if (hintLower.startsWith("img:")) {
    score += 90;
  }

  if (
    linkType === "template" &&
    (urlLower.includes("template") || hintLower.includes("template"))
  ) {
    score += 60;
  } else if (
    linkType === "editor" &&
    ["page", "artboard", "preview", "cover"].some((token) =>
      hintLower.includes(token)
    )
  ) {
    score += 40;
  } else if (linkType === "share" && hintLower.includes("share")) {
    score += 30;
  }

  if (NEGATIVE_PATH_HINTS.some((token) => hintLower.includes(token))) {
    score -= 90;
  }

  return score;
}

async function validateGaodingImageUrl(imageUrl) {
  const normalized = normalizeCandidateUrl(imageUrl);
  if (!normalized) {
    return false;
  }

  const requestHeaders = {
    ...GAODING_HEADERS,
    Accept: "image/*",
  };

  try {
    const headResponse = await axios.head(normalized, {
      timeout: VALIDATE_TIMEOUT,
      maxRedirects: 5,
      headers: requestHeaders,
      validateStatus: () => true,
    });

    if ([200, 206].includes(headResponse.status)) {
      return true;
    }
  } catch {
    // Fallback to range GET.
  }

  try {
    const getResponse = await axios.get(normalized, {
      timeout: VALIDATE_TIMEOUT,
      maxRedirects: 5,
      responseType: "arraybuffer",
      headers: {
        ...requestHeaders,
        Range: "bytes=0-0",
      },
      validateStatus: () => true,
    });

    return [200, 206].includes(getResponse.status);
  } catch {
    return false;
  }
}

async function inspectGaodingImageAsset(imageUrl) {
  const normalized = safeImageUrl(imageUrl);
  if (!normalized) {
    return null;
  }

  const requestHeaders = {
    ...GAODING_HEADERS,
    Accept: "image/*",
  };

  try {
    const response = await axios.get(normalized, {
      timeout: VALIDATE_TIMEOUT,
      maxRedirects: 5,
      responseType: "arraybuffer",
      maxContentLength: 8 * 1024 * 1024,
      headers: {
        ...requestHeaders,
        Range: "bytes=0-65535",
      },
      validateStatus: () => true,
    });

    if (![200, 206].includes(response.status)) {
      return null;
    }

    const contentType = String(
      (response.headers && response.headers["content-type"]) || ""
    ).toLowerCase();
    if (contentType && !contentType.startsWith("image/")) {
      return null;
    }

    let metadata = null;
    try {
      const sharp = require("sharp");
      metadata = await sharp(Buffer.from(response.data)).metadata();
    } catch {
      metadata = null;
    }

    return {
      url: normalized,
      status: response.status,
      contentType,
      bytes: Number(String(response.headers?.['content-range'] || '').split('/')[1]) ||
        Number(
          (response.headers && response.headers["content-length"]) || 0
        ) || Buffer.byteLength(Buffer.from(response.data || [])),
      width: Number(metadata && metadata.width) || 0,
      height: Number(metadata && metadata.height) || 0,
    };
  } catch {
    return null;
  }
}

function isLikelyPrimaryGaodingImage(assetInfo) {
  if (!assetInfo) {
    return false;
  }

  if (
    Number(assetInfo.width) >= MIN_PRIMARY_IMAGE_WIDTH &&
    Number(assetInfo.height) >= MIN_PRIMARY_IMAGE_HEIGHT
  ) {
    return true;
  }

  if (Number(assetInfo.bytes) >= MIN_PRIMARY_IMAGE_BYTES) {
    return true;
  }

  return false;
}

async function validateGaodingPrimaryImageUrl(imageUrl) {
  const assetInfo = await inspectGaodingImageAsset(imageUrl);
  return Boolean(assetInfo && isLikelyPrimaryGaodingImage(assetInfo));
}

async function pickBestSingleCandidate(entries, linkType, limit = 12) {
  const candidatesByKey = new Map();

  for (const entry of entries || []) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }

    const [imageUrl, hint] = entry;
    const normalized = normalizeCandidateUrl(imageUrl);
    if (!normalized) {
      continue;
    }

    const score = scoreCandidate(normalized, hint, linkType);
    if (score <= 0) {
      continue;
    }

    const key = candidateKey(normalized);
    const existing = candidatesByKey.get(key);
    if (existing && existing.score >= score) {
      continue;
    }

    candidatesByKey.set(key, {
      url: normalized,
      hint,
      score,
    });
  }

  const orderedCandidates = Array.from(candidatesByKey.values()).sort(
    (left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return String(left.url).localeCompare(String(right.url));
    }
  );

  for (const candidate of orderedCandidates.slice(0, limit)) {
    if (await validateGaodingImageUrl(candidate.url)) {
      return candidate.url;
    }
  }

  return null;
}

async function pickBestPrimarySingleCandidate(entries, linkType, limit = 12) {
  const candidatesByKey = new Map();

  for (const entry of entries || []) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }

    const [imageUrl, hint] = entry;
    const normalized = normalizeCandidateUrl(imageUrl);
    if (!normalized) {
      continue;
    }

    const score = scoreCandidate(normalized, hint, linkType);
    if (score <= 0) {
      continue;
    }

    const key = candidateKey(normalized);
    const existing = candidatesByKey.get(key);
    if (existing && existing.score >= score) {
      continue;
    }

    candidatesByKey.set(key, {
      url: normalized,
      hint,
      score,
    });
  }

  const orderedCandidates = Array.from(candidatesByKey.values()).sort(
    (left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return String(left.url).localeCompare(String(right.url));
    }
  );

  for (const candidate of orderedCandidates.slice(0, limit)) {
    if (await validateGaodingPrimaryImageUrl(candidate.url)) {
      return candidate.url;
    }
  }

  return null;
}

async function validateUrlsInOrder(imageUrls) {
  const validUrls = [];

  for (const imageUrl of dedupeUrls(imageUrls)) {
    if (await validateGaodingImageUrl(imageUrl)) {
      validUrls.push(imageUrl);
    }
  }

  return validUrls;
}

async function validatePrimaryUrlsInOrder(imageUrls) {
  const validUrls = [];

  for (const imageUrl of dedupeUrls(imageUrls)) {
    if (await validateGaodingPrimaryImageUrl(imageUrl)) {
      validUrls.push(imageUrl);
    }
  }

  return validUrls;
}

function buildResult(imageUrls, originalUrl, source, method, linkType, score = 0) {
  const normalizedUrls = dedupeUrls(imageUrls);
  if (!normalizedUrls.length) {
    return null;
  }

  const pages = normalizedUrls.map((imageUrl, index) => ({
    page: index + 1,
    imageUrl,
  }));

  return {
    success: true,
    imageUrl: normalizedUrls[0],
    thumbnailUrl: normalizedUrls[0],
    imageUrls: normalizedUrls,
    images: normalizedUrls,
    pages,
    pageCount: normalizedUrls.length,
    isMultiPage: normalizedUrls.length > 1,
    platform: "Gaoding",
    source,
    method,
    score,
    linkType,
    original_url: originalUrl,
  };
}

function getResultPageCount(result) {
  if (!result) {
    return 0;
  }

  const explicitPageCount = Number(result.pageCount);
  if (Number.isFinite(explicitPageCount) && explicitPageCount > 0) {
    return explicitPageCount;
  }

  return dedupeUrls([
    ...(Array.isArray(result.imageUrls) ? result.imageUrls : []),
    ...(Array.isArray(result.images) ? result.images : []),
    result.imageUrl,
  ]).length;
}

function shareIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.match(/\/(?:dam\/)?share\/([^/]+)/i)?.[1] ||
      parsed.searchParams.get('share_id') || parsed.searchParams.get('shareId') || null;
  } catch { return null; }
}

function createExtractionState(url, options = {}) {
  return { url, resolvedUrl: url, shareId: shareIdFromUrl(url), designIds: new Set(),
    candidates: [], evidence: [], designRefs: new Map(), fetchedRefs: new Set(),
    validationCache: new Map(), diagnostics: [], fields: new Set(), options,
    deadline: Date.now() + (Number(options.totalTimeout) || 60000), designDimensions: new Map() };
}

function diagnose(state, stage, details) {
  const entry = { stage, ...details };
  state.diagnostics.push(entry);
  if (state.options.log !== false) console.log('Gaoding extraction:', redact(JSON.stringify(entry)));
}

function safeImageUrl(raw, base) {
  if (raw && typeof raw === 'object') raw = raw.url;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(decodeHtmlText(raw).replace(/\\\//g, '/'), base);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

// Parse literal JSON only. Balanced scanning handles assignments/cache.push without eval.
function embeddedJson(text) {
  const decoded = decodeHtmlText(text);
  try { return [JSON.parse(decoded)]; } catch {}
  const objects = [];
  for (let start = 0; start < decoded.length && objects.length < 100; start++) {
    if (!['{', '['].includes(decoded[start])) continue;
    let depth = 0, quoted = false, escaped = false, end = start;
    for (; end < decoded.length; end++) {
      const char = decoded[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') { if (--depth === 0) break; }
    }
    if (depth !== 0) continue;
    try { objects.push(JSON.parse(decoded.slice(start, end + 1))); start = end; } catch {}
  }
  return objects;
}

const PREVIEW_FIELDS = [
  ['source_preview_info', 1000, 'page_preview'], ['sourcePreviewInfo', 1000, 'page_preview'],
  ['preview_info', 900, 'page_preview'], ['previewInfo', 900, 'page_preview'],
  ['previewUrl', 900, 'page_preview'], ['preview_url', 900, 'page_preview'],
  ['imageUrl', 850, 'page_preview'], ['image', 850, 'page_preview'],
  ['thumbnail', 400, 'page_thumbnail'], ['thumbnailUrl', 400, 'page_thumbnail'],
  ['cover', 350, 'cover'], ['poster', 350, 'cover'],
];
const EXCLUDED_BRANCH = /^(?:elements|background|materials?|resources?|recommend.*|related.*|banners?|menus?|header|footer|sidebar|imports|scopes|avatar|icons?)$/i;

function collectDesignData(data, state, context = {}) {
  const walk = (node, ctx, depth = 0) => {
    if (depth > 30 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, { ...ctx, path: `${ctx.path}[${i}]` }, depth + 1)); return; }
    const explicitShare = node.shareCode || node.share_code || node.shareId || node.share_id || node.metaShareCode;
    if (explicitShare && state.shareId && String(explicitShare) !== state.shareId) return;
    let trusted = ctx.trusted || Boolean(explicitShare && String(explicitShare) === state.shareId);
    const share = node.metaShareInfo;
    if (share && String(share.shareCode || '') === state.shareId) {
      trusted = true;
      for (const id of share.fileIds || []) state.designIds.add(String(id));
      if (share.enabled === false || share.isOpen === false) state.diagnostics.push({ stage: 'access', reason: 'share_unavailable' });
    }
    const id = node.designId || node.design_id || node.fileId || node.file_id ||
      (node.id && (node.preview_info || node.source_preview_info || node.design_info || node.pages || node.layouts) ? node.id : null) ||
      (/(?:metaFileDetail|file_detail|design|work|template)(?:$|\[)/i.test(ctx.path || '') ? node.id : null);
    if (id && state.designIds.size && !state.designIds.has(String(id))) return;
    if (id && trusted) state.designIds.add(String(id));
    trusted = trusted || Boolean(id && state.designIds.has(String(id)));
    const current = { ...ctx, trusted, designId: id ? String(id) : ctx.designId };
    if (trusted) {
      const previewSize = node.preview_info || node.previewInfo;
      if (current.designId && previewSize?.width && previewSize?.height) state.designDimensions.set(current.designId, { width: previewSize.width, height: previewSize.height });
      for (const field of ['source_preview_info', 'preview_info', 'extends_previews', 'design_info', 'pages', 'layouts']) {
        if (node[field] !== undefined) state.fields.add(field);
      }
      const count = Number(node.pageCount ?? node.page_count ?? node.totalPages ?? node.total_pages);
      if (Number.isInteger(count) && count > 0 && count <= 1000) {
        state.evidence.push({ count, source: `${ctx.path}.pageCount`, confidence: 'verified', numbered: false });
      }
      const ref = safeImageUrl(node.design_info?.url || node.designInfo?.url, state.resolvedUrl);
      if (ref && state.designRefs.size < 4) state.designRefs.set(ref, current);
    }
    const pages = Array.isArray(node.pages) && node.pages.length ? node.pages : null;
    const layouts = Array.isArray(node.layouts) && node.layouts.length ? node.layouts : null;
    const collection = pages || layouts; // Alternate representations of the same design.
    if (trusted && collection) {
      const label = pages ? 'pages' : 'layouts';
      const explicitCount = Number(node.pageCount ?? node.page_count ?? node.totalPages ?? node.total_pages);
      const declaredNumbers = collection.map(p => Number(p?.pageNumber ?? p?.page_number ?? p?.page));
      const numbered = declaredNumbers.some(n => Number.isInteger(n) && n > 0);
      state.evidence.push({ count: Math.max(collection.length, explicitCount || 0), source: `${ctx.path}.${label}.length`, confidence: 'verified', numbered: !numbered && !(explicitCount > collection.length) });
      collection.forEach((page, index) => {
        if (!page || typeof page !== 'object') return;
        const pageId = page.pageId ?? page.page_id ?? page.id ?? page.uuid ?? null;
        const explicitNumber = Number(page.pageNumber ?? page.page_number ?? page.page);
        const pageNumber = Number.isInteger(explicitNumber) && explicitNumber > 0 ? explicitNumber :
          (!numbered && !(explicitCount > collection.length) ? index + 1 : null);
        const pageContext = { ...current, path: `${ctx.path}.${label}[${index}]`,
          pageId: pageId === null ? null : String(pageId), pageNumber,
          pageKey: pageId !== null ? `id:${pageId}` : pageNumber ? `page:${pageNumber}` : `${ctx.path}.${label}[${index}]` };
        addPreviewNode(page, state, pageContext);
        if (pages && layouts) {
          const peer = pageId !== null ? layouts.find(layout => String(layout?.pageId ?? layout?.page_id ?? layout?.id ?? layout?.uuid ?? '') === String(pageId)) :
            (pages.length === layouts.length ? layouts[index] : null);
          if (peer) addPreviewNode(peer, state, { ...pageContext, path: `${ctx.path}.layouts[${layouts.indexOf(peer)}]` });
        }
      });
    } else if (trusted) {
      addPreviewNode(node, state, { ...current, pageKey: 'primary', pageId: null, pageNumber: null });
      // Only explicit page identity makes extends_previews separate pages.
      for (const [index, preview] of (Array.isArray(node.extends_previews) ? node.extends_previews : []).entries()) {
        const pageId = preview.pageId ?? preview.page_id;
        const number = Number(preview.pageNumber ?? preview.page_number ?? preview.page);
        const pageNumber = Number.isInteger(number) && number > 0 ? number : null;
        addPreviewNode({ preview_info: preview }, state, { ...current, path: `${ctx.path}.extends_previews[${index}]`,
          pageId: pageId == null ? null : String(pageId), pageNumber,
          pageKey: pageId != null ? `id:${pageId}` : pageNumber ? `page:${pageNumber}` : 'primary' });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (EXCLUDED_BRANCH.test(key) || ['pages', 'layouts', 'extends_previews', 'design_info', 'designInfo'].includes(key) || PREVIEW_FIELDS.some(([field]) => field === key)) continue;
      walk(value, { ...current, path: `${ctx.path}.${key}` }, depth + 1);
    }
  };
  walk(data, { source: 'html-preview', path: 'root', ...context });
}

function addPreviewNode(node, state, context) {
  const addFields = (value, path, bonus = 0) => {
    for (const [field, score, role] of PREVIEW_FIELDS) {
      const preview = value[field];
      const url = safeImageUrl(preview, state.resolvedUrl);
      if (!url) continue;
      state.candidates.push({ url, ...context, resourceRole: role, score: score + bonus,
        width: Number(preview?.width || value.width) || null, height: Number(preview?.height || value.height) || null,
        shareId: state.shareId, evidencePath: `${path}.${field}`, selectionReason: 'target_structured_preview', validationStatus: 'pending' });
    }
  };
  addFields(node, context.path);
  // A single layout wrapper may describe the whole page. Other elements never do.
  const elements = Array.isArray(node.elements) ? node.elements : [];
  if (elements.length === 1 && elements[0]?.type === 'layout') addFields(elements[0], `${context.path}.elements[0]`, -50);
}

function collectHtmlData(html, state, source) {
  const $ = cheerio.load(html || '');
  $('[contextdata]').each((_, element) => {
    for (const data of embeddedJson($(element).attr('contextdata') || '')) {
      collectDesignData(data, state, { source, path: 'html.contextdata', trusted: !state.shareId });
    }
  });
  $('script:not([src])').each((_, element) => {
    if (['importmap', 'module'].includes($(element).attr('type'))) return;
    for (const data of embeddedJson($(element).html() || '')) {
      // SSR data from the requested document is evidence, unlike arbitrary network bodies.
      collectDesignData(data, state, { source, path: 'html.script', trusted: true });
    }
  });
  // Older SSR serializes business fields in HTML attributes rather than JSON scripts.
  if (!state.candidates.length && !state.designIds.size) {
    const ref = extractDesignInfoUrlFromHtml(html);
    if (ref) state.designRefs.set(ref, { trusted: true, source, path: 'html.design_info' });
  }
  diagnose(state, source, { fields: [...state.fields], candidates: state.candidates.length, designRefs: state.designRefs.size, designIds: [...state.designIds] });
}

// These public endpoints and ordinary product/channel headers come from the
// share viewer's shipped client. No login credentials or private endpoints.
async function fetchPublicShareData(state) {
  const parsed = new URL(state.url);
  if (!state.shareId || !/^\/dam\/share\//.test(parsed.pathname) || !/(^|\.)(gaoding\.com|gaoding\.cn)$/.test(parsed.hostname)) return;
  const headers = { ...GAODING_HEADERS, Accept: 'application/json', 'x-business-id': '13', 'x-channel-id': '32' };
  const get = path => axios.get(new URL(path, parsed.origin).href, { headers,
    timeout: Math.min(Number(state.options.timeout) || STATIC_TIMEOUT, Math.max(1, state.deadline - Date.now())),
    maxContentLength: 4 * 1024 * 1024, maxRedirects: 5, validateStatus: () => true });
  try {
    const response = await get(`/api/dam/shares/${encodeURIComponent(state.shareId)}/resource`);
    const data = response.data?.data || response.data;
    const config = data?.share_config_info;
    if (response.status !== 200 || String(config?.share_code || '') !== state.shareId) {
      diagnose(state, 'share_api', { status: response.status, reason: 'share_metadata_unavailable' }); return;
    }
    if (config.is_open === false || config.is_open_password === true || (config.expire_at && config.expire_at < Date.now())) {
      state.accessRestriction = config.is_open_password ? 'share_password_required' : 'share_closed_or_expired';
      state.candidates = [];
      diagnose(state, 'share_api', { reason: state.accessRestriction }); return;
    }
    const ids = Array.isArray(data.file_ids) ? data.file_ids.map(String) : [];
    ids.forEach(id => state.designIds.add(id));
    diagnose(state, 'share_api', { shareId: config.share_code, designIds: ids, shareScope: config.share_scope });
    for (const id of ids.slice(0, 4)) {
      if (Date.now() >= state.deadline) break;
      const assetResponse = await get(`/api/dam/asset/${encodeURIComponent(id)}`);
      const asset = assetResponse.data?.data || assetResponse.data;
      if (assetResponse.status !== 200 || String(asset?.id || '') !== id) {
        diagnose(state, 'share_asset', { designId: id, status: assetResponse.status, reason: 'target_asset_unavailable' }); continue;
      }
      collectDesignData(asset, state, { trusted: true, designId: id, source: 'share-api-preview', path: `share_api.asset[${id}]` });
      diagnose(state, 'share_asset', { designId: id, fields: [...state.fields], hasPreviewUrl: Boolean(asset.preview_info?.url), hasDesignJson: Boolean(asset.design_info?.url),
        previewWidth: asset.preview_info?.width, previewHeight: asset.preview_info?.height });
    }
  } catch (error) { diagnose(state, 'share_api', { reason: error.code || error.name }); }
}

async function fetchDesignJsonPageUrls(state) {
  if (state.accessRestriction) return;
  for (const [url, context] of state.designRefs) {
    if (state.fetchedRefs.has(url)) continue;
    if (Date.now() >= state.deadline) break;
    state.fetchedRefs.add(url);
    try {
      const response = await axios.get(url, { headers: { ...GAODING_HEADERS, Accept: 'application/json' },
        timeout: Number(state.options.timeout) || STATIC_TIMEOUT, maxContentLength: 8 * 1024 * 1024, maxRedirects: 5, validateStatus: () => true });
      if (response.status !== 200) { diagnose(state, 'design_json', { status: response.status, reason: 'design_json_unavailable' }); continue; }
      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      collectDesignData(data, state, { ...context, path: 'design_json', source: 'design-json-pages', trusted: true });
      diagnose(state, 'design_json', { pages: data?.pages?.length || 0, layouts: data?.layouts?.length || 0, candidates: state.candidates.length });
    } catch (error) { diagnose(state, 'design_json', { reason: error.code || error.name }); }
  }
}

async function finalizeState(state, linkType) {
  const byPage = new Map();
  const expected = state.evidence.length ? Math.max(...state.evidence.map(e => e.count)) : null;
  const unique = new Map();
  for (const candidate of state.candidates) {
    const key = `${candidate.designId || ''}|${candidate.pageKey}:${candidate.url}`;
    if (!unique.has(key) || unique.get(key).score < candidate.score) unique.set(key, candidate);
  }
  const ordered = [...unique.values()].sort((a, b) => b.score - a.score || (b.width * b.height) - (a.width * a.height));
  let validCount = 0;
  for (const candidate of ordered.slice(0, 64)) {
    if (Date.now() >= state.deadline && !state.validationCache.has(candidate.url)) break;
    const key = `${candidate.designId || ''}|${candidate.pageKey}`;
    // All versions in a page group are inspected so a larger peer can win.
    if (!state.validationCache.has(candidate.url)) state.validationCache.set(candidate.url, inspectGaodingImageAsset(candidate.url));
    const asset = await state.validationCache.get(candidate.url);
    if (!asset?.width || !asset?.height) { candidate.validationStatus = 'invalid'; continue; }
    if (candidate.width && candidate.height && Math.abs((asset.width / asset.height) / (candidate.width / candidate.height) - 1) > 0.08) {
      candidate.validationStatus = 'aspect_mismatch'; continue;
    }
    validCount++;
    const validated = { ...candidate, width: asset.width, height: asset.height, contentType: asset.contentType,
      fileSize: asset.bytes, aspectRatio: asset.width / asset.height, validationStatus: 'valid' };
    const old = byPage.get(key);
    if (!old || candidate.score > old.score || (candidate.score === old.score && asset.width * asset.height > old.width * old.height)) byPage.set(key, validated);
  }
  // A document cover must never become an extra page beside its actual pages.
  for (const key of [...byPage.keys()]) {
    if (!key.endsWith('|primary')) continue;
    const designPrefix = key.slice(0, -'primary'.length);
    if ([...byPage.keys()].some(other => other !== key && other.startsWith(designPrefix))) byPage.delete(key);
  }
  let selected = [...byPage.values()].sort((a, b) => (a.pageNumber || Infinity) - (b.pageNumber || Infinity));
  const seen = new Set();
  selected = selected.filter(c => { if (seen.has(c.url)) return false; seen.add(c.url); return true; });
  const count = selected.length;
  const fullPreviews = selected.every(c => c.resourceRole === 'page_preview');
  const complete = Boolean(count && expected === count && fullPreviews && state.designIds.size <= 1);
  const completenessStatus = complete ? 'complete' : expected ? 'partial' : 'unknown';
  const numbers = selected.map(c => c.pageNumber);
  const canIdentifyMissing = expected && (state.evidence.some(e => e.numbered) || (numbers.length && numbers.every(n => n !== null)));
  const missingPages = !complete && canIdentifyMissing ? Array.from({ length: expected }, (_, i) => i + 1).filter(n => !numbers.includes(n)) : [];
  const pages = selected.map((c, index) => ({ page: c.pageNumber || index + 1, pageNumber: c.pageNumber, pageId: c.pageId,
    imageUrl: c.url, source: c.source, resourceRole: c.resourceRole, shareId: state.shareId, designId: c.designId || null,
    width: c.width, height: c.height, contentType: c.contentType, fileSize: c.fileSize, validationStatus: c.validationStatus,
    evidencePath: c.evidencePath, selectionReason: c.selectionReason }));
  const source = selected[0]?.source || null;
  diagnose(state, 'selection', { rawCandidates: state.candidates.length, fullPreviewCandidates: state.candidates.filter(c => c.resourceRole === 'page_preview').length,
    thumbnailCandidates: state.candidates.filter(c => c.resourceRole === 'page_thumbnail').length, validCandidates: validCount,
    filtered: state.candidates.filter(c => ['invalid', 'aspect_mismatch'].includes(c.validationStatus)).map(c => ({ field: c.evidencePath, reason: c.validationStatus })),
    source, pageCount: count, expectedPageCount: expected, completenessStatus });
  return { success: count > 0, platform: 'Gaoding', imageUrl: selected[0]?.url || null, thumbnailUrl: selected[0]?.url || null,
    imageUrls: selected.map(c => c.url), images: selected.map(c => c.url), pages, pageCount: count, isMultiPage: count > 1,
    source, linkType, original_url: state.url, expectedPageCount: expected, collectedPageCount: count,
    pageCountConfidence: expected ? 'verified' : 'unknown', completenessStatus, isComplete: complete ? true : expected ? false : null, missingPages,
    resourceRole: fullPreviews && count ? 'page_preview' : count ? 'partial_preview' : 'unavailable',
    selectionReason: count ? selected[0].selectionReason : 'no_verified_target_preview',
    status: complete ? 'success' : count ? 'preview_image' : 'preview_only',
    message: count ? undefined : state.accessRestriction === 'share_password_required' ? '该分享需要密码，当前未取得设计稿资源。' : state.accessRestriction ? '该分享已关闭或过期。' : '未获取到与该分享关联的设计稿预览；当前访问响应未提供可用资源。',
    warningText: complete ? undefined : count ? '仅取得目标预览，设计稿完整性尚未确认。' : '分享页面可读取，但未取得目标设计稿资源。',
    metadata: { inputUrl: redact(state.inputUrl || state.url), normalizedUrl: redact(state.url), resolvedUrl: redact(state.resolvedUrl),
      shareId: state.shareId, designIds: [...state.designIds], pageCountEvidence: state.evidence, diagnostics: state.diagnostics } };
}

function shouldAttemptDynamicAfterStatic(result) {
  return !result || result.isComplete !== true;
}

function selectPreferredResult(primary, secondary) {
  if (!primary) return secondary || null;
  if (!secondary) return primary;
  const rank = r => (r.isComplete === true ? 10000 : 0) + (r.pages || []).filter(p => p.resourceRole === 'page_preview').length * 100 +
    (/design-json|network|html-preview/.test(r.source || '') ? 10 : 0);
  return rank(secondary) > rank(primary) ? secondary : primary;
}

async function staticScraping(url, linkType, options = {}, state = createExtractionState(url, options)) {
  try {
    const response = await axios.get(url, { headers: GAODING_HEADERS, timeout: Number(options.timeout) || STATIC_TIMEOUT,
      maxContentLength: 4 * 1024 * 1024, maxRedirects: 5, validateStatus: () => true });
    state.resolvedUrl = response.request?.res?.responseUrl || url;
    diagnose(state, 'static', { status: response.status, resolvedUrl: redact(state.resolvedUrl) });
    if (response.status === 200) collectHtmlData(String(response.data), state, 'html-preview');
    await fetchPublicShareData(state);
    await fetchDesignJsonPageUrls(state);
  } catch (error) { diagnose(state, 'static', { reason: error.code || error.name }); }
  return finalizeState(state, linkType);
}

async function dynamicScraping(url, linkType, options = {}, state = createExtractionState(url, options)) {
  const pool = options.browserPool || getDefaultPool();
  let browser, page;
  const pending = new Set();
  let accepting = true, readCount = 0;
  try {
    browser = await pool.acquire(10000);
    page = await browser.newPage();
    page.on('response', response => {
      const type = response.request().resourceType();
      const contentType = String(response.headers()['content-type'] || '');
      if (!accepting || readCount >= 80 || !['document', 'fetch', 'xhr'].includes(type) || !/json|html|text\/plain/i.test(contentType)) return;
      readCount++;
      const task = (async () => {
        if (Number(response.headers()['content-length'] || 0) > 4 * 1024 * 1024) return;
        const responseUrl = response.url();
        const associated = responseUrl === url || (state.shareId && responseUrl.includes(state.shareId)) || [...state.designIds].some(id => responseUrl.includes(id));
        if ([401, 403].includes(response.status()) && associated) diagnose(state, 'network', { url: redact(responseUrl), status: response.status(), reason: 'access_denied' });
        if (response.status() !== 200) return;
        const body = await response.text().catch(() => '');
        if (body.length > 4 * 1024 * 1024) return;
        if (type === 'document' && responseUrl === page.url()) collectHtmlData(body, state, 'dynamic-html-preview');
        else {
          try { collectDesignData(JSON.parse(body), state, { trusted: Boolean(associated), source: 'dynamic-network-preview', path: `network:${redact(responseUrl)}` }); }
          catch { /* Non-JSON network text cannot establish design ownership. */ }
        }
      })().catch(error => diagnose(state, 'network', { reason: error.code || error.name }));
      pending.add(task); task.finally(() => pending.delete(task));
    });
    page.on('pageerror', error => diagnose(state, 'browser_script', { reason: String(error.message).slice(0, 200) }));
    await page.setViewport({ width: 1600, height: 1200 });
    await page.setUserAgent(GAODING_HEADERS['User-Agent']);
    await page.setExtraHTTPHeaders({ 'Accept-Language': GAODING_HEADERS['Accept-Language'] });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DYNAMIC_TIMEOUT, referer: GAODING_HEADERS.Referer });
    state.resolvedUrl = page.url();
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 900)));
    await page.waitForTimeout(1500);
    collectHtmlData(await page.content(), state, 'dynamic-html-preview');
    // Bounded lazy page activation, scoped to the actual viewer rather than recommendations.
    const buttons = await page.$$('#dam-preview-container [data-page-number], #dam-preview-container button[data-page]');
    for (const button of buttons.slice(0, 10)) {
      if (Date.now() >= state.deadline) break;
      await button.click().catch(() => {}); await page.waitForTimeout(350);
      collectHtmlData(await page.content(), state, 'dynamic-html-preview');
    }
    await Promise.allSettled([...pending]);
    await fetchDesignJsonPageUrls(state);
    const current = await finalizeState(state, linkType);
    if (!current.isComplete) {
      const visible = await page.evaluate((designIds) => {
        const viewer = document.querySelector('#dam-preview-container');
        if (!viewer) return [];
        return [...viewer.querySelectorAll('img')].filter(img => img.complete && img.naturalWidth > 0 && img.getClientRects().length).map(img => {
          const owner = img.closest('[fileid], [data-file-id], [data-design-id]');
          const id = owner?.getAttribute('fileid') || owner?.getAttribute('data-file-id') || owner?.getAttribute('data-design-id');
          if (!id || !designIds.includes(id)) return null;
          const pageNode = img.closest('[data-page-number], [data-page-id]');
          return { url: img.currentSrc, designId: id, width: img.naturalWidth, height: img.naturalHeight,
            pageId: pageNode?.getAttribute('data-page-id'), pageNumber: Number(pageNode?.getAttribute('data-page-number')) || null };
        }).filter(Boolean);
      }, [...state.designIds]);
      for (const image of visible) {
        const url = safeImageUrl(image.url, state.resolvedUrl);
        if (!url || /\.(?:svg|ico)(?:\?|$)/i.test(url)) continue;
        const dimensions = state.designDimensions.get(image.designId);
        if (dimensions && Math.abs((image.width / image.height) / (dimensions.width / dimensions.height) - 1) > 0.08) continue;
        state.candidates.push({ ...image, url, source: 'dynamic-visible', resourceRole: dimensions ? 'page_preview' : 'visible_preview', score: 200,
          pageKey: image.pageId ? `id:${image.pageId}` : image.pageNumber ? `page:${image.pageNumber}` : 'primary',
          evidencePath: 'dom.#dam-preview-container[fileId].img', selectionReason: 'target_viewer_fallback_structured_resources_unavailable' });
      }
      diagnose(state, 'dynamic-visible', { associatedViewerImages: visible.length, reason: 'structured_result_incomplete', structuredCandidates: state.candidates.filter(c => c.source !== 'dynamic-visible').length });
    }
  } catch (error) { diagnose(state, 'dynamic', { reason: error.code || error.name, message: String(error.message).slice(0, 160) }); }
  finally {
    accepting = false;
    if (page) await page.close().catch(() => {});
    await Promise.allSettled([...pending]);
    if (browser) pool.release(browser);
  }
  return finalizeState(state, linkType);
}

async function extractGaoding(inputUrl, options = {}) {
  const url = normalizeGaodingInputUrl(inputUrl);
  if (!url) return buildFailureResult('missing_url', inputUrl);
  const state = createExtractionState(url, options); state.inputUrl = inputUrl;
  const linkType = classifyLink(url);
  diagnose(state, 'url', { inputUrl: redact(inputUrl), normalizedUrl: redact(url), shareId: state.shareId, linkType });
  const result = await staticScraping(url, linkType, options, state);
  if (!shouldAttemptDynamicAfterStatic(result) || linkType === 'listing' || options.staticOnly || Date.now() >= state.deadline || state.accessRestriction) return result;
  return dynamicScraping(url, linkType, options, state);
}

module.exports = {
  extractGaoding,
  __internals: {
    normalizeGaodingInputUrl,
    classifyLink,
    normalizeCandidateUrl,
    stripGaodingOssProcess,
    isGaodingDesignCandidate,
    extractPreviewBundleFromHtml,
    extractDesignInfoUrlFromHtml,
    extractPagePreviewUrlsFromDesignData,
    extractCandidatesFromData,
    selectBestMultiPageGroup,
    scoreCandidate,
    buildResult,
    shouldAttemptDynamicAfterStatic,
    selectPreferredResult,
    createExtractionState,
    collectDesignData,
    collectHtmlData,
    finalizeState,
    staticScraping,
    dynamicScraping,
    safeImageUrl,
  },
};
