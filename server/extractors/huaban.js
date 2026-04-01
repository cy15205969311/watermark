const axios = require("axios");

const API_ROOT = "https://api.huaban.com";
const RAW_IMAGE_HOST = "https://hbimg.huabanimg.com";
const DEFAULT_LIST_LIMIT = 24;
const MAX_LIST_LIMIT = 48;
const VALIDATION_MIN_BYTES = 10 * 1024;

const API_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: "https://huaban.com/",
  Origin: "https://huaban.com",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const IMAGE_HEADERS = {
  "User-Agent": API_HEADERS["User-Agent"],
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": API_HEADERS["Accept-Language"],
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "image",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
};

function buildBaseResult(originalUrl, extras = {}) {
  return {
    platform: "Huaban",
    original_url: originalUrl || null,
    ...extras,
  };
}

function buildFailureResult(message, originalUrl, extras = {}) {
  const normalizedMessage =
    typeof message === "string" && message.trim()
      ? message.trim()
      : "huaban_extract_failed";

  return {
    success: false,
    imageUrl: null,
    thumbnailUrl: null,
    imageUrls: [],
    images: [],
    pages: [],
    pageCount: 0,
    isMultiPage: false,
    message: normalizedMessage,
    error: normalizedMessage,
    ...buildBaseResult(originalUrl, extras),
  };
}

function buildImageResult(imageUrls, originalUrl, extras = {}) {
  const normalizedUrls = dedupeKeepOrder(imageUrls).filter(Boolean);
  const pages = normalizedUrls.map((imageUrl, index) => ({
    page: index + 1,
    imageUrl,
  }));

  return {
    success: true,
    imageUrl: normalizedUrls[0] || null,
    thumbnailUrl: normalizedUrls[0] || null,
    imageUrls: normalizedUrls,
    images: normalizedUrls,
    pages,
    pageCount: normalizedUrls.length,
    isMultiPage: normalizedUrls.length > 1,
    ...buildBaseResult(originalUrl, extras),
  };
}

function dedupeKeepOrder(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function classifyLink(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    const hostname = String(parsed.hostname || "").toLowerCase();
    const path = String(parsed.pathname || "").replace(/\/+$/, "").toLowerCase();

    if (hostname.includes("api.huaban.com")) {
      if (/^\/pins\/\d+$/.test(path)) return "pin";
      if (/^\/boards\/\d+$/.test(path)) return "board";
      if (path === "/discovery" || path.startsWith("/discovery/")) {
        return "discovery";
      }
    }

    if (hostname.includes("huaban.com")) {
      if (/^\/pins\/\d+$/.test(path)) return "pin";
      if (/^\/boards\/\d+$/.test(path)) return "board";
      if (!path || path === "/discovery" || path.startsWith("/discovery/")) {
        return "discovery";
      }
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

function extractNumericId(url, segment) {
  try {
    const parts = String(new URL(url).pathname || "")
      .split("/")
      .filter(Boolean);

    for (let index = 0; index < parts.length - 1; index += 1) {
      if (
        String(parts[index]).toLowerCase() === String(segment).toLowerCase() &&
        /^\d+$/.test(parts[index + 1])
      ) {
        return parts[index + 1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function buildDiscoveryApiPath(url) {
  const parsed = new URL(url);
  const hostname = String(parsed.hostname || "").toLowerCase();
  const path = String(parsed.pathname || "").replace(/\/+$/, "");

  if (hostname.includes("api.huaban.com") && path) {
    return `${API_ROOT}${path}`;
  }

  let normalizedPath = path || "/discovery";
  if (!normalizedPath.startsWith("/discovery")) {
    normalizedPath = "/discovery";
  }

  return `${API_ROOT}${normalizedPath}`;
}

function forwardListParams(url) {
  const params = new URL(url).searchParams;
  const forwarded = {};

  ["max", "limit", "wfl", "category", "sort"].forEach((key) => {
    const value = params.get(key);
    if (value) {
      forwarded[key] = value;
    }
  });

  const rawLimit = forwarded.limit;
  if (!rawLimit) {
    forwarded.limit = String(DEFAULT_LIST_LIMIT);
    return forwarded;
  }

  const parsedLimit = Number.parseInt(rawLimit, 10);
  forwarded.limit = String(
    Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(parsedLimit, MAX_LIST_LIMIT))
      : DEFAULT_LIST_LIMIT
  );

  return forwarded;
}

function extractPinsFromPayload(data) {
  if (!data || typeof data !== "object") {
    return [];
  }

  if (data.pin && typeof data.pin === "object" && !Array.isArray(data.pin)) {
    return [data.pin];
  }

  if (Array.isArray(data.pins)) {
    return data.pins.filter((item) => item && typeof item === "object");
  }

  if (data.board && Array.isArray(data.board.pins)) {
    return data.board.pins.filter((item) => item && typeof item === "object");
  }

  return [];
}

function normalizePinImageUrl(pin) {
  const fileInfo = pin && typeof pin.file === "object" ? pin.file : {};
  const fileKey = String(fileInfo.key || "").trim().replace(/^\/+/, "");
  if (fileKey) {
    return `${RAW_IMAGE_HOST}/${fileKey}`;
  }

  const rawUrl = String(fileInfo.url || "").trim();
  if (!rawUrl) {
    return null;
  }

  try {
    const rawPath = String(new URL(rawUrl).pathname || "")
      .trim()
      .replace(/^\/+/, "");
    return rawPath ? `${RAW_IMAGE_HOST}/${rawPath}` : null;
  } catch {
    return null;
  }
}

function isPublicPreviewOnlyPin(pin) {
  const fileMaterial =
    pin && pin.file_material && typeof pin.file_material === "object"
      ? pin.file_material
      : {};
  const extra = pin && pin.extra && typeof pin.extra === "object" ? pin.extra : {};

  const hasMaterialId =
    extra.material_id !== undefined && extra.material_id !== null
      ? true
      : fileMaterial.material_id !== undefined && fileMaterial.material_id !== null;
  const sourceType = String(fileMaterial.source_type || "").trim().toLowerCase();
  const hasExternalSource = Boolean(pin && (pin.source || pin.link || pin.original));

  return Boolean(hasMaterialId && sourceType === "produced" && !hasExternalSource);
}

function buildPreviewOnlyReason(pin) {
  if (!isPublicPreviewOnlyPin(pin)) {
    return "";
  }

  const fileMaterial =
    pin && pin.file_material && typeof pin.file_material === "object"
      ? pin.file_material
      : {};
  const materialType = String(fileMaterial.material_type || "源素材")
    .trim()
    .toUpperCase();

  return (
    `该花瓣素材公开接口仅返回带水印预览图，未暴露公开无水印${materialType}下载字段；` +
    "如需原素材，通常需要在花瓣站内登录有权限的账号后下载。"
  );
}

function buildPinEntry(pin) {
  const imageUrl = normalizePinImageUrl(pin);
  if (!imageUrl) {
    return null;
  }

  const board = pin && pin.board && typeof pin.board === "object" ? pin.board : {};
  const textMeta =
    pin && pin.text_meta && typeof pin.text_meta === "object" ? pin.text_meta : {};
  const tags = Array.isArray(pin && pin.tags)
    ? pin.tags
    : Array.isArray(textMeta.tags)
      ? textMeta.tags
      : [];

  return {
    pinId: pin ? pin.pin_id : null,
    imageUrl,
    title: String((pin && pin.raw_text) || "").trim(),
    tags: tags.filter((tag) => typeof tag === "string"),
    boardTitle: board.title || null,
    previewOnly: isPublicPreviewOnlyPin(pin),
    previewOnlyReason: buildPreviewOnlyReason(pin),
  };
}

function getHotlinkHeaders(imageUrl) {
  const headers = { ...IMAGE_HEADERS };
  let hostname = "";

  try {
    hostname = String(new URL(imageUrl).hostname || "").toLowerCase();
  } catch {
    hostname = "";
  }

  if (hostname.includes("huaban.com") || hostname.includes("huabanimg.com")) {
    headers.Referer = "https://huaban.com/";
    headers.Origin = "https://huaban.com";
  } else {
    headers.Referer = "https://huaban.com/";
    headers.Origin = "https://huaban.com";
  }

  return headers;
}

function extractReportedSize(headers = {}) {
  const contentRange = headers["content-range"] || headers["Content-Range"];
  if (typeof contentRange === "string") {
    const match = contentRange.match(/\/(\d+)$/);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  const contentLength = headers["content-length"] || headers["Content-Length"];
  if (typeof contentLength === "string" && /^\d+$/.test(contentLength)) {
    return Number.parseInt(contentLength, 10);
  }

  return null;
}

function isImageContentType(headers = {}) {
  const contentType =
    String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();

  if (!contentType) {
    return true;
  }

  return contentType.startsWith("image/") || contentType.includes("application/octet-stream");
}

function isValidImageResponse(status, headers = {}) {
  if (![200, 206].includes(status)) {
    return false;
  }

  if (!isImageContentType(headers)) {
    return false;
  }

  const fileSize = extractReportedSize(headers);
  if (fileSize !== null && fileSize < VALIDATION_MIN_BYTES) {
    return false;
  }

  return true;
}

async function validateImageUrl(imageUrl) {
  const headers = getHotlinkHeaders(imageUrl);

  try {
    const headResponse = await axios.head(imageUrl, {
      timeout: 2000,
      maxRedirects: 5,
      headers,
      validateStatus: () => true,
    });

    if (isValidImageResponse(headResponse.status, headResponse.headers)) {
      return true;
    }

    if (headResponse.status === 404) {
      return false;
    }
  } catch {
    // Ignore HEAD failures and try Range GET below.
  }

  try {
    const getResponse = await axios.get(imageUrl, {
      timeout: 2000,
      maxRedirects: 5,
      responseType: "arraybuffer",
      headers: {
        ...headers,
        Range: "bytes=0-0",
      },
      validateStatus: () => true,
    });

    if (isValidImageResponse(getResponse.status, getResponse.headers)) {
      return true;
    }

    if (getResponse.status === 404) {
      return false;
    }
  } catch {
    return false;
  }

  return false;
}

async function filterValidEntries(entries = []) {
  const results = await Promise.allSettled(
    entries.map((entry) => validateImageUrl(entry.imageUrl))
  );

  return entries.filter((entry, index) => results[index].status === "fulfilled" && results[index].value === true);
}

function buildPreviewOnlyResult(originalUrl, extras = {}) {
  const warningText = "公开接口仅提供带水印预览图，未返回无水印原素材下载地址";
  return {
    ...buildFailureResult(extras.reason || warningText, originalUrl, extras),
    status: "preview_only",
    warningText,
    noticeCode: "huaban_preview_only",
    message: warningText,
  };
}

function buildPreviewImageResult(entries, originalUrl, extras = {}) {
  const imageUrls = entries.map((entry) => entry.imageUrl);
  const warningText =
    "已提取公开预览图，可直接下载，但可能包含平台水印，未获取到无水印原素材";
  const result = buildImageResult(imageUrls, originalUrl, extras);

  result.status = "preview_image";
  result.warningText = warningText;
  result.noticeCode = "huaban_preview_image";
  result.message = warningText;
  result.error = extras.reason || warningText;
  result.pages = entries.map((entry, index) => ({
    page: index + 1,
    imageUrl: entry.imageUrl,
    pinId: entry.pinId || null,
    title: entry.title || "",
  }));

  return result;
}

async function buildFeedResult(pins, originalUrl, extras = {}) {
  const listParams = forwardListParams(originalUrl);
  const requestedLimit = Number.parseInt(listParams.limit || "", 10);
  const maxItems = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, MAX_LIST_LIMIT))
    : DEFAULT_LIST_LIMIT;

  const entries = [];
  const seenUrls = new Set();

  for (const pin of pins) {
    const entry = buildPinEntry(pin);
    if (!entry || seenUrls.has(entry.imageUrl)) {
      continue;
    }

    seenUrls.add(entry.imageUrl);
    entries.push(entry);

    if (entries.length >= maxItems) {
      break;
    }
  }

  if (!entries.length) {
    return null;
  }

  const previewOnlyEntries = entries.filter((entry) => entry.previewOnly);
  const publicEntries = entries.filter((entry) => !entry.previewOnly);

  if (!publicEntries.length) {
    if (!previewOnlyEntries.length) {
      return null;
    }

    const validatedPreviewEntries = await filterValidEntries(previewOnlyEntries);
    if (validatedPreviewEntries.length) {
      return buildPreviewImageResult(validatedPreviewEntries, originalUrl, {
        ...extras,
        method: `${extras.method || "huaban"}_preview_image`,
        reason: previewOnlyEntries[0].previewOnlyReason,
      });
    }

    return buildPreviewOnlyResult(originalUrl, {
      ...extras,
      method: `${extras.method || "huaban"}_preview_only`,
      reason: previewOnlyEntries[0].previewOnlyReason,
    });
  }

  const validatedEntries = await filterValidEntries(publicEntries);
  if (!validatedEntries.length) {
    return null;
  }

  const imageUrls = validatedEntries.map((entry) => entry.imageUrl);
  const result = buildImageResult(imageUrls, originalUrl, {
    ...extras,
    pins: validatedEntries,
  });

  result.pages = validatedEntries.map((entry, index) => ({
    page: index + 1,
    imageUrl: entry.imageUrl,
    pinId: entry.pinId || null,
    title: entry.title || "",
  }));

  return result;
}

async function getJson(url, params, options = {}) {
  const response = await axios.get(url, {
    timeout: options.timeout || 15000,
    maxRedirects: 5,
    params,
    headers: API_HEADERS,
    validateStatus: () => true,
  });

  if (response.status !== 200) {
    throw new Error(`Huaban API request failed: HTTP ${response.status} for ${url}`);
  }

  return response.data;
}

async function extractPin(url, options = {}) {
  const pinId = extractNumericId(url, "pins");
  if (!pinId) {
    return null;
  }

  const data = await getJson(`${API_ROOT}/pins/${pinId}`, undefined, options);
  const pin = data && typeof data === "object" ? data.pin : null;
  if (!pin || typeof pin !== "object") {
    return null;
  }

  const entry = buildPinEntry(pin);
  if (!entry) {
    return null;
  }

  const isValid = await validateImageUrl(entry.imageUrl);
  if (!isValid) {
    return null;
  }

  if (entry.previewOnly) {
    return buildPreviewImageResult([entry], url, {
      source: "huaban-pin-api",
      method: "pin_api_preview_image",
      linkType: "pin",
      pinId: entry.pinId || null,
      title: entry.title || "",
      tags: entry.tags || [],
      boardTitle: entry.boardTitle || null,
      reason: entry.previewOnlyReason,
    });
  }

  return buildImageResult([entry.imageUrl], url, {
    source: "huaban-pin-api",
    method: "pin_api",
    linkType: "pin",
    pinId: entry.pinId || null,
    title: entry.title || "",
    tags: entry.tags || [],
    boardTitle: entry.boardTitle || null,
  });
}

async function extractBoard(url, options = {}) {
  const boardId = extractNumericId(url, "boards");
  if (!boardId) {
    return null;
  }

  const [boardMeta, pinsPayload] = await Promise.all([
    getJson(`${API_ROOT}/boards/${boardId}`, undefined, options),
    getJson(`${API_ROOT}/boards/${boardId}/pins`, forwardListParams(url), options),
  ]);

  const result = await buildFeedResult(extractPinsFromPayload(pinsPayload), url, {
    source: "huaban-board-api",
    method: "board_pins_api",
    linkType: "board",
    boardId,
  });

  if (!result) {
    return null;
  }

  const board =
    boardMeta && typeof boardMeta === "object" && boardMeta.board && typeof boardMeta.board === "object"
      ? boardMeta.board
      : null;
  if (board) {
    result.boardId = boardId;
    result.boardTitle = board.title || result.boardTitle || null;
  }

  return result;
}

async function extractDiscovery(url, options = {}) {
  const data = await getJson(buildDiscoveryApiPath(url), forwardListParams(url), options);
  return buildFeedResult(extractPinsFromPayload(data), url, {
    source: "huaban-discovery-api",
    method: "discovery_api",
    linkType: "discovery",
  });
}

async function extractHuaban(url, options = {}) {
  try {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      return buildFailureResult("missing_url", url);
    }

    const linkType = classifyLink(normalizedUrl);
    if (linkType === "pin") {
      const result = await extractPin(normalizedUrl, options);
      return result || buildFailureResult("huaban_pin_extract_failed", normalizedUrl, { linkType });
    }

    if (linkType === "board") {
      const result = await extractBoard(normalizedUrl, options);
      return result || buildFailureResult("huaban_board_extract_failed", normalizedUrl, { linkType });
    }

    if (linkType === "discovery") {
      const result = await extractDiscovery(normalizedUrl, options);
      return result || buildFailureResult("huaban_discovery_extract_failed", normalizedUrl, { linkType });
    }

    return buildFailureResult("huaban_url_not_supported", normalizedUrl, { linkType });
  } catch (error) {
    return buildFailureResult(error.message || "huaban_extract_failed", url);
  }
}

const __internals = {
  API_ROOT,
  RAW_IMAGE_HOST,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  VALIDATION_MIN_BYTES,
  classifyLink,
  extractNumericId,
  buildDiscoveryApiPath,
  forwardListParams,
  extractPinsFromPayload,
  normalizePinImageUrl,
  isPublicPreviewOnlyPin,
  buildPreviewOnlyReason,
  buildPinEntry,
  buildPreviewOnlyResult,
  buildPreviewImageResult,
  buildFeedResult,
  dedupeKeepOrder,
  validateImageUrl,
  getHotlinkHeaders,
  extractReportedSize,
  isImageContentType,
  isValidImageResponse,
};

module.exports = {
  extractHuaban,
  __internals,
};
