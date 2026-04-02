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
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

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

    if (hostname.includes("gaoding.com") || hostname.includes("gaoding.cn")) {
      parsed.hash = "";
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
  const pages = Array.isArray(data && data.pages) ? data.pages : [];
  if (!pages.length) {
    return [];
  }

  const pageUrls = [];

  pages.forEach((page, pageIndex) => {
    const candidates = [];
    const addCandidate = (rawUrl, hint, bonus = 0) => {
      const normalized = normalizeCandidateUrl(rawUrl);
      if (!normalized) {
        return;
      }

      candidates.push({
        url: normalized,
        score:
          scoreCandidate(
            normalized,
            `design_json.pages[${pageIndex}].${hint}`,
            "detail"
          ) + bonus,
      });
    };

    addCandidate(page && page.preview_info && page.preview_info.url, "preview_info.url", 420);
    addCandidate(page && page.previewInfo && page.previewInfo.url, "previewInfo.url", 420);
    addCandidate(
      page && page.source_preview_info && page.source_preview_info.url,
      "source_preview_info.url",
      460
    );
    addCandidate(
      page && page.sourcePreviewInfo && page.sourcePreviewInfo.url,
      "sourcePreviewInfo.url",
      460
    );
    addCandidate(page && page.thumbnail && page.thumbnail.url, "thumbnail.url", 260);
    addCandidate(page && page.cover && page.cover.url, "cover.url", 220);
    addCandidate(page && page.poster && page.poster.url, "poster.url", 220);

    const elements = Array.isArray(page && page.elements) ? page.elements : [];
    elements.forEach((element, elementIndex) => {
      const hintPrefix = `elements[${elementIndex}]`;
      const elementType = String(element && element.type || "").toLowerCase();

      if (elementType === "layout") {
        addCandidate(
          element && element.thumbnail && element.thumbnail.url,
          `${hintPrefix}.thumbnail.url`,
          360
        );
        addCandidate(
          element &&
            element.background &&
            element.background.image &&
            element.background.image.url,
          `${hintPrefix}.background.image.url`,
          180
        );
      }

      addCandidate(element && element.preview_info && element.preview_info.url, `${hintPrefix}.preview_info.url`, 260);
      addCandidate(element && element.previewInfo && element.previewInfo.url, `${hintPrefix}.previewInfo.url`, 260);
      addCandidate(element && element.thumbnail && element.thumbnail.url, `${hintPrefix}.thumbnail.url`, 220);
      addCandidate(element && element.cover && element.cover.url, `${hintPrefix}.cover.url`, 180);
    });

    const bestCandidate = candidates.sort((left, right) => right.score - left.score)[0];
    if (bestCandidate && bestCandidate.url) {
      pageUrls.push(bestCandidate.url);
    }
  });

  return dedupeUrls(pageUrls);
}

async function fetchDesignJsonPageUrls(designInfoUrl, options = {}) {
  if (!designInfoUrl) {
    return [];
  }

  try {
    const response = await axios.get(designInfoUrl, {
      headers: {
        ...GAODING_HEADERS,
        Accept: "application/json,text/plain,*/*",
      },
      timeout: Number(options.timeout) || STATIC_TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      return [];
    }

    const data =
      typeof response.data === "string" ? JSON.parse(response.data) : response.data;

    return extractPagePreviewUrlsFromDesignData(data);
  } catch {
    return [];
  }
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

async function validateUrlsInOrder(imageUrls) {
  const validUrls = [];

  for (const imageUrl of dedupeUrls(imageUrls)) {
    if (await validateGaodingImageUrl(imageUrl)) {
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

function shouldAttemptDynamicAfterStatic(staticResult, linkType) {
  if (!staticResult || !staticResult.success || !staticResult.imageUrl) {
    return true;
  }

  if (getResultPageCount(staticResult) > 1) {
    return false;
  }

  if (!["share", "detail", "editor", "creation"].includes(linkType)) {
    return false;
  }

  const source = String(staticResult.source || "").toLowerCase();
  return (
    !source ||
    source.includes("candidate") ||
    source.includes("meta") ||
    source.includes("cover") ||
    source.includes("preview") ||
    Number(staticResult.score || 0) < 1600
  );
}

function selectPreferredResult(primaryResult, secondaryResult, linkType) {
  if (!primaryResult) {
    return secondaryResult || null;
  }
  if (!secondaryResult) {
    return primaryResult;
  }

  const scoreResult = (result) => {
    const pageCount = getResultPageCount(result);
    const source = String(result.source || "").toLowerCase();
    let score = Number(result.score || 0);

    if (pageCount > 1) {
      score += 10000 + pageCount * 120;
    }

    if (source.includes("multi-page") || source.includes("preview-bundle")) {
      score += 900;
    }

    if (source.includes("dynamic")) {
      score += ["share", "detail", "editor", "creation"].includes(linkType)
        ? 220
        : 60;
    }

    if (source.includes("design-json")) {
      score += 320;
    }

    if (source.includes("candidate") || source === "meta") {
      score -= 120;
    }

    return score;
  };

  return scoreResult(secondaryResult) > scoreResult(primaryResult)
    ? secondaryResult
    : primaryResult;
}

function looksLikeAntiBotPage(htmlContent) {
  const lowered = String(htmlContent || "").toLowerCase();
  const antiBotTexts = [
    "\u0034\u0030\u0035\u5f02\u5e38\u8bbf\u95ee",
    "\u8bf7\u6c42\u6709\u5f02\u5e38\u884c\u4e3a",
    "\u8bbf\u95ee\u88ab\u963b\u6b62\u4e86",
  ];

  return (
    antiBotTexts.some((text) => String(htmlContent || "").includes(text)) ||
    lowered.includes("security threat")
  );
}

async function analyzeHtmlContent(htmlContent, originalUrl, linkType, stage) {
  if (!htmlContent || looksLikeAntiBotPage(htmlContent)) {
    return null;
  }

  const $ = cheerio.load(htmlContent);
  const metaEntries = extractMetaCandidates($);
  const domEntries = extractDomCandidates($);
  const jsonEntries = extractJsonCandidates($);
  const textEntries = extractContextualUrlsFromText(htmlContent);
  const previewBundleEntries = extractPreviewBundleFromHtml(htmlContent);

  if (previewBundleEntries.length) {
    const validUrls = await validateUrlsInOrder(
      previewBundleEntries.map(([imageUrl]) => imageUrl)
    );
    if (validUrls.length >= 2) {
      return buildResult(
        validUrls,
        originalUrl,
        stage === "dynamic"
          ? "dynamic-html-preview-bundle"
          : "html-preview-bundle",
        stage === "dynamic"
          ? "browser_html_preview_bundle"
          : "static_html_preview_bundle",
        linkType,
        stage === "dynamic" ? 1800 : 1900
      );
    }
  }

  const multiPageEntries = selectBestMultiPageGroup(jsonEntries);
  if (multiPageEntries.length) {
    const validUrls = await validateUrlsInOrder(
      multiPageEntries.map(([imageUrl]) => imageUrl)
    );
    if (validUrls.length >= 2) {
      return buildResult(
        validUrls,
        originalUrl,
        stage === "dynamic" ? "dynamic-multi-page" : "json-multi-page",
        stage === "dynamic"
          ? "browser_dynamic_group"
          : "static_json_group",
        linkType,
        stage === "dynamic" ? 1700 : 1600
      );
    }
  }

  if (metaEntries.length) {
    const metaUrl = await pickBestSingleCandidate(metaEntries, linkType, 4);
    if (metaUrl) {
      return buildResult(
        [metaUrl],
        originalUrl,
        stage === "dynamic" ? "dynamic-meta" : "meta",
        stage === "dynamic" ? "browser_meta" : "static_meta",
        linkType,
        stage === "dynamic" ? 1000 : 900
      );
    }
  }

  const bestUrl = await pickBestSingleCandidate(
    metaEntries.concat(jsonEntries, domEntries, textEntries),
    linkType
  );
  if (bestUrl) {
    return buildResult(
      [bestUrl],
      originalUrl,
      stage === "dynamic" ? "dynamic-candidate" : "static-candidate",
      stage === "dynamic"
        ? "browser_dynamic_candidate"
        : "static_candidate_selection",
      linkType,
      stage === "dynamic" ? 1100 : 700
    );
  }

  return null;
}

async function staticScraping(url, linkType, options = {}) {
  try {
    const response = await axios.get(url, {
      headers: GAODING_HEADERS,
      timeout: Number(options.timeout) || STATIC_TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      return null;
    }

    const htmlContent =
      typeof response.data === "string" ? response.data : String(response.data);
    const htmlResult = await analyzeHtmlContent(
      htmlContent,
      url,
      linkType,
      "static"
    );
    if (getResultPageCount(htmlResult) > 1) {
      return htmlResult;
    }

    const designInfoUrl = extractDesignInfoUrlFromHtml(htmlContent);
    const designJsonPageUrls = await fetchDesignJsonPageUrls(designInfoUrl, options);
    const designJsonResult =
      designJsonPageUrls.length >= 2
        ? buildResult(
            designJsonPageUrls,
            url,
            "design-json-pages",
            "static_design_json_pages",
            linkType,
            1500
          )
        : null;

    return selectPreferredResult(htmlResult, designJsonResult, linkType);
  } catch {
    return null;
  }
}

async function dynamicScraping(url, linkType, options = {}) {
  let browser = null;
  let page = null;

  try {
    const launchOptions = {
      headless: options.headless === false ? false : "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();
    const responseTasks = [];
    const networkStructuredEntries = [];
    const networkLooseEntries = [];
    const networkPreviewBundleEntries = [];

    page.on("response", (response) => {
      responseTasks.push(
        (async () => {
          const resourceType = response.request().resourceType();
          const contentType = String(
            (response.headers() && response.headers()["content-type"]) || ""
          ).toLowerCase();
          const contentLength = Number(
            (response.headers() && response.headers()["content-length"]) || 0
          );

          if (contentLength && contentLength > 2 * 1024 * 1024) {
            return;
          }

          const shouldReadText =
            ["document", "xhr", "fetch"].includes(resourceType) ||
            contentType.includes("json") ||
            contentType.includes("html") ||
            contentType.includes("text") ||
            contentType.includes("javascript");

          if (!shouldReadText) {
            return;
          }

          const payloadText = await response.text().catch(() => "");
          if (!payloadText || payloadText.length > 2 * 1024 * 1024) {
            return;
          }

          const hintRoot = `network.${resourceType}`;
          const previewBundleEntries = extractPreviewBundleFromHtml(payloadText).map(
            ([imageUrl, hint]) => [imageUrl, hint.replace(/^html/i, hintRoot)]
          );

          if (previewBundleEntries.length) {
            networkPreviewBundleEntries.push(...previewBundleEntries);
          }

          const trimmedPayload = decodeHtmlText(payloadText).trim();
          if (trimmedPayload && ["{", "["].includes(trimmedPayload[0])) {
            try {
              const data = JSON.parse(trimmedPayload);
              networkStructuredEntries.push(
                ...extractCandidatesFromData(data, hintRoot)
              );
            } catch {
              // Ignore non-JSON payloads.
            }
          }

          networkLooseEntries.push(
            ...extractContextualUrlsFromText(payloadText).map(
              ([imageUrl], index) => [imageUrl, `${hintRoot}.text[${index}]`]
            )
          );
        })().catch(() => {})
      );
    });

    await page.setViewport({ width: 1600, height: 1200 });
    await page.setUserAgent(GAODING_HEADERS["User-Agent"]);
    await page.setExtraHTTPHeaders({
      "Accept-Language": GAODING_HEADERS["Accept-Language"],
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: Math.max(Number(options.timeout) || 0, DYNAMIC_TIMEOUT),
      referer: GAODING_HEADERS.Referer,
    });

    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      window.scrollBy(0, Math.max(window.innerHeight, 900));
    });
    await page.waitForTimeout(1500);
    await Promise.allSettled(responseTasks);

    const renderedHtml = await page.content();
    const renderedResult = await analyzeHtmlContent(
      renderedHtml,
      url,
      linkType,
      "dynamic"
    );

    const visibleUrls = await page.evaluate(() => {
      const seen = new Set();
      const urls = [];

      const addUrl = (value) => {
        if (typeof value !== "string") {
          return;
        }

        const normalized = value.trim();
        if (!normalized || seen.has(normalized)) {
          return;
        }

        seen.add(normalized);
        urls.push(normalized);
      };

      document.querySelectorAll("img").forEach((image) => {
        [
          image.src,
          image.getAttribute("src"),
          image.getAttribute("data-src"),
          image.getAttribute("data-original"),
          image.getAttribute("data-url"),
        ].forEach(addUrl);

        const srcset = image.getAttribute("srcset") || "";
        srcset
          .split(",")
          .map((item) => item.trim().split(/\s+/)[0])
          .forEach(addUrl);
      });

      document.querySelectorAll("source").forEach((source) => {
        [source.src, source.getAttribute("src"), source.getAttribute("srcset")]
          .filter(Boolean)
          .forEach((value) => {
            String(value)
              .split(",")
              .map((item) => item.trim().split(/\s+/)[0])
              .forEach(addUrl);
          });
      });

      document.querySelectorAll("video").forEach((video) => {
        addUrl(video.poster);
        addUrl(video.getAttribute("poster"));
      });

      document.querySelectorAll("*").forEach((element) => {
        try {
          const backgroundImage =
            window.getComputedStyle(element).backgroundImage || "";
          const matches = backgroundImage.matchAll(
            /url\(["']?([^"'()]+)["']?\)/g
          );
          for (const match of matches) {
            addUrl(match[1]);
          }
        } catch {
          // Ignore style access failures.
        }
      });

      return urls;
    });

    const visibleEntries = visibleUrls.map((candidateUrl, index) => [
      candidateUrl,
      `dynamic-visible[${index}]`,
    ]);

    let supplementalResult = null;
    const structuredNetworkEntries = dedupeEntries(networkStructuredEntries);
    const previewBundleNetworkEntries = dedupeEntries(networkPreviewBundleEntries);
    const looseNetworkEntries = dedupeEntries(networkLooseEntries);

    if (previewBundleNetworkEntries.length) {
      const validUrls = await validateUrlsInOrder(
        previewBundleNetworkEntries.map(([imageUrl]) => imageUrl)
      );
      if (validUrls.length >= 2) {
        supplementalResult = buildResult(
          validUrls,
          url,
          "dynamic-network-preview-bundle",
          "browser_network_preview_bundle",
          linkType,
          1820
        );
      }
    }

    if (!supplementalResult && structuredNetworkEntries.length) {
      const groupedEntries = selectBestMultiPageGroup(structuredNetworkEntries);
      if (groupedEntries.length) {
        const validUrls = await validateUrlsInOrder(
          groupedEntries.map(([imageUrl]) => imageUrl)
        );
        if (validUrls.length >= 2) {
          supplementalResult = buildResult(
            validUrls,
            url,
            "dynamic-network-multi-page",
            "browser_network_group",
            linkType,
            1720
          );
        }
      }
    }

    const preferredDynamicResult = selectPreferredResult(
      renderedResult,
      supplementalResult,
      linkType
    );
    if (preferredDynamicResult) {
      return preferredDynamicResult;
    }

    const bestVisibleUrl = await pickBestSingleCandidate(
      structuredNetworkEntries.concat(looseNetworkEntries, visibleEntries),
      linkType,
      8
    );
    if (bestVisibleUrl) {
      return buildResult(
        [bestVisibleUrl],
        url,
        "dynamic-visible",
        "browser_visible_candidate",
        linkType,
        1200
      );
    }

    return null;
  } catch {
    return null;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function extractGaoding(url, options = {}) {
  const normalizedUrl = normalizeGaodingInputUrl(url);
  if (!normalizedUrl) {
    return buildFailureResult("missing_url", url);
  }

  const linkType = classifyLink(normalizedUrl);

  try {
    const staticResult = await staticScraping(normalizedUrl, linkType, options);
    if (staticResult && !shouldAttemptDynamicAfterStatic(staticResult, linkType)) {
      return staticResult;
    }

    if (linkType === "listing") {
      return (
        staticResult ||
        buildFailureResult("gaoding_listing_not_supported", normalizedUrl, {
          linkType,
        })
      );
    }

    const dynamicResult = await dynamicScraping(
      normalizedUrl,
      linkType,
      options
    );
    const preferredResult = selectPreferredResult(
      staticResult,
      dynamicResult,
      linkType
    );
    if (preferredResult) {
      return preferredResult;
    }

    return buildFailureResult("gaoding_image_not_found", normalizedUrl, {
      linkType,
    });
  } catch (error) {
    return buildFailureResult(error, normalizedUrl, { linkType });
  }
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
  },
};
