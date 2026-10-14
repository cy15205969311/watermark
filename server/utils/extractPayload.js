function normalizeExtractPayload(result = {}) {
  if (result.isAnimated === true && result.animationUrl) {
    result = { ...result, imageUrl: result.animationUrl, imageUrls: [result.animationUrl, ...(result.imageUrls || []).filter(url => url !== result.thumbnailUrl)], pages: (result.pages || []).map((page, index) => index === 0 ? { ...page, imageUrl: result.animationUrl } : page) };
  }
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
    const identifiedGaodingPage = result.platform === 'Gaoding' && page?.designId && (page.pageId || page.pageNumber);
    const rawUrl = typeof page?.imageUrl === 'string' ? page.imageUrl.trim() : '';
    const imageUrl = identifiedGaodingPage && rawUrl && !isBlockedPreviewAssetUrl(rawUrl) ? rawUrl : addUrl(rawUrl);
    if (!imageUrl) {
      return;
    }
    if (identifiedGaodingPage) {
      const identity = `${page.designId}|${page.pageId || page.pageNumber}`;
      if (pages.some(p => `${p.designId}|${p.pageId || p.pageNumber}` === identity)) return;
      urls.push(imageUrl);
      seen.add(imageUrl);
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
  const orderedUrls = result.platform === 'Gaoding' && pages.length ? pages.map(p => p.imageUrl) : urls;
  return {
    ...result,
    imageUrl: orderedUrls[0] || null,
    thumbnailUrl: result.thumbnailUrl || result.imageUrl || urls[0] || null,
    imageUrls: orderedUrls,
    images: orderedUrls,
    pages,
    pageCount: orderedUrls.length,
    isMultiPage:
      result.platform === 'Gaoding' ? orderedUrls.length > 1 : typeof result.isMultiPage === "boolean"
        ? result.isMultiPage
        : urls.length > 1,
  };
}

const DETAIL_FIELDS = ["source", "metadata", "expectedPageCount", "collectedPageCount", "pageCountConfidence", "completenessStatus", "isComplete", "missingPages", "warnings", "mediaType", "detectedFormat", "isAnimated", "frameCount", "durationMs", "loopCount", "animationUrl", "animationStatus", "resourceRole", "originalResourceStatus", "downloadStatus", "hasVisibleWatermark", "selectionReason"];
function extractionDetails(result = {}) {
  return Object.fromEntries(DETAIL_FIELDS.filter(key => result[key] !== undefined).map(key => [key, result[key]]));
}
function restoreRecord(row) {
  const parse = (value, fallback) => { try { return typeof value === "string" ? JSON.parse(value) : value || fallback; } catch { return fallback; } };
  return { ...row, ...extractionDetails(parse(row.extraction_metadata_json, {})), imageUrls: parse(row.image_urls_json, []), pages: parse(row.pages_json, []), pageCount: row.page_count, isMultiPage: Boolean(row.is_multi_page) };
}
module.exports = { normalizeExtractPayload, extractionDetails, restoreRecord };
