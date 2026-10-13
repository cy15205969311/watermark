function normalizeExtractPayload(result = {}) {
  const urls = [];
  const pages = [];
  const seen = new Set();

  const isBlockedPreviewAssetUrl = (value) => {
    if (typeof value !== "string") {
      return true;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    if (/^data:image\//.test(normalized) || /^blob:/.test(normalized)) {
      return false;
    }

    if (/^https?:\/\/hm\.baidu\.com\/hm\.gif/.test(normalized)) return true;
    if (/googletagmanager|google-analytics|doubleclick|umeng|clarity/.test(normalized)) {
      return true;
    }
    if (/\/distheadless\/img\//.test(normalized)) return true;
    if (/full-screen|fullscreen|favicon|tracker|tracking|pixel/.test(normalized)) {
      return true;
    }

    return false;
  };

  const addUrl = (value) => {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    if (!normalized || isBlockedPreviewAssetUrl(normalized) || seen.has(normalized)) {
      return null;
    }

    seen.add(normalized);
    urls.push(normalized);
    return normalized;
  };

  const addPage = (page, fallbackPageNumber) => {
    const imageUrl = addUrl(page && page.imageUrl);
    if (!imageUrl) {
      return;
    }

    pages.push({
      ...page,
      page: Number(page && page.page) || fallbackPageNumber || pages.length + 1,
      imageUrl,
    });
  };

  (result.pages || []).forEach((page, index) => addPage(page, index + 1));
  (result.imageUrls || []).forEach(addUrl);
  (result.images || []).forEach(addUrl);
  addUrl(result.imageUrl);
  if (!urls.length) addUrl(result.thumbnailUrl);

  if (!pages.length) {
    urls.forEach((imageUrl, index) => {
      pages.push({
        page: index + 1,
        imageUrl,
      });
    });
  }

  pages.sort((a, b) => a.page - b.page);
  return {
    ...result,
    imageUrl: urls[0] || null,
    thumbnailUrl: result.thumbnailUrl || result.imageUrl || urls[0] || null,
    imageUrls: urls,
    images: urls,
    pages,
    pageCount: urls.length,
    isMultiPage:
      typeof result.isMultiPage === "boolean"
        ? result.isMultiPage
        : urls.length > 1,
  };
}

const DETAIL_FIELDS = ["source", "metadata", "expectedPageCount", "collectedPageCount", "pageCountConfidence", "completenessStatus", "isComplete", "missingPages", "warnings"];
function extractionDetails(result = {}) {
  return Object.fromEntries(DETAIL_FIELDS.filter(key => result[key] !== undefined).map(key => [key, result[key]]));
}
function restoreRecord(row) {
  const parse = (value, fallback) => { try { return typeof value === "string" ? JSON.parse(value) : value || fallback; } catch { return fallback; } };
  return { ...row, ...extractionDetails(parse(row.extraction_metadata_json, {})), imageUrls: parse(row.image_urls_json, []), pages: parse(row.pages_json, []), pageCount: row.page_count, isMultiPage: Boolean(row.is_multi_page) };
}
module.exports = { normalizeExtractPayload, extractionDetails, restoreRecord };
