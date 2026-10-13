// Page evidence is collected before validation: a failed URL must not erase its page.
const PREVIEW_FIELDS = ["origin_img", "originImg", "big_img", "bigImg", "previewUrl", "preview_url", "preview", "user_preview_ue", "user_preview", "imageUrl", "image_url", "img", "image", "url", "src", "cover", "coverUrl", "small_img", "thumbnailUrl"];
const PAGE_LISTS = /^(pages|layouts|pageInfo|page_list|pageList)$/i;
const PREVIEW_LISTS = /^(preview|previews|page_previews|pagePreviews)$/i;
const ELEMENTS = /^(work|elements|materials|assets|stickers|children|recommendations|templates|items)$/i;
const COUNT_FIELDS = /^(pageCount|page_count|totalPages|total_pages|total_page)$/;
const MAX_PAGES = 100;

function redact(value) {
  return String(value || "").replace(/([?&](?:auth_key|token|signature|sign|key|pram)=)[^&#\s"']*/gi, "$1[redacted]");
}

function imageIdentity(value) {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/![^/]*$/, "");
    // Comparison only. Never use this key as a request URL.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(auth_key|signature|sign|w|h|width|height|quality|x-oss-process)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return value; }
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function collectPageData(data, source = "structured") {
  const candidates = [];
  const evidence = [];
  const excluded = [];
  const visited = new Set();
  let nodes = 0;
  const addEvidence = (count, confidence, path) => {
    count = positiveNumber(count);
    if (count && count <= 10000) evidence.push({ count, confidence, source: path });
  };
  function urls(value, meta, depth = 0) {
    if (depth > 3 || !value) return;
    if (typeof value === "string") {
      const imageUrl = value.replace(/\\\//g, "/").replace(/&amp;/g, "&");
      if (/^(https?:)?\/\//i.test(imageUrl)) {
        candidates.push({ ...meta, imageUrl: imageUrl.startsWith("//") ? `https:${imageUrl}` : imageUrl, role: "page_preview", score: 1000 - depth * 10 });
      }
      return;
    }
    if (typeof value !== "object" || Array.isArray(value)) return;
    for (const field of PREVIEW_FIELDS) {
      if (value[field]) urls(value[field], { ...meta, source: `${meta.source}.${field}`, score: 1000 - PREVIEW_FIELDS.indexOf(field) * 10, resolution: field }, depth + 1);
    }
  }
  function walk(value, path, depth = 0) {
    if (!value || typeof value !== "object" || depth > 18 || visited.has(value) || ++nodes > 12000) return;
    visited.add(value);
    if (Array.isArray(value)) { value.slice(0, MAX_PAGES).forEach((entry, i) => walk(entry, `${path}[${i}]`, depth + 1)); return; }
    const pageMap = value.page_map;
    if (pageMap && typeof pageMap === "object" && !Array.isArray(pageMap)) {
      const keys = Object.keys(pageMap).map(positiveNumber);
      if (keys.length && keys.every(Boolean)) {
        addEvidence(Math.max(...keys), "verified", `${path}.page_map`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (COUNT_FIELDS.test(key)) addEvidence(child, "verified", `${path}.${key}`);
      if (ELEMENTS.test(key)) {
        // Element collections are deliberately never walked for page previews/counts.
        excluded.push({ source: `${path}.${key}`, reason: "element_collection" });
        continue;
      }
      if (Array.isArray(child) && (PAGE_LISTS.test(key) || PREVIEW_LISTS.test(key))) {
        const isPages = PAGE_LISTS.test(key);
        const validList = child.length && child.every(entry => typeof entry === "string" || (entry && typeof entry === "object" && !Array.isArray(entry)));
        if (validList) {
          const explicitPages = child.map(entry => positiveNumber(entry && (entry.pageNumber ?? entry.page ?? entry.page_no)));
          const isSparse = explicitPages.some(Boolean);
          // A sparse list is coverage, not a claim that max(page) is the total.
          if (!isSparse) addEvidence(child.length, isPages ? "verified" : "inferred", `${path}.${key}`);
          child.slice(0, MAX_PAGES).forEach((entry, index) => {
            const pageNumber = explicitPages[index] || (!isSparse ? index + 1 : null);
            const pageId = entry && typeof entry === "object" ? (entry.pageId ?? entry.page_id ?? entry.id ?? null) : null;
            const meta = { pageNumber, pageId: pageId == null ? (pageMap && pageMap[pageNumber]) || null : String(pageId), pageGroupId: "design", source: `${path}.${key}[${index}]`, width: Number(entry?.width) || null, height: Number(entry?.height) || null, pageEvidence: isPages ? "verified" : "inferred" };
            urls(entry, meta);
            if (isPages) walk(entry, `${path}.${key}[${index}]`, depth + 1);
          });
        }
        continue;
      }
      if (child && typeof child === "object" && key !== "page_map") walk(child, `${path}.${key}`, depth + 1);
    }
  }
  walk(data, source);
  return { candidates, evidence, excluded };
}

function resolveEvidence(evidence = []) {
  const verified = evidence.filter(item => item.confidence === "verified");
  const usable = verified.length ? verified : evidence.filter(item => item.confidence === "inferred");
  const counts = [...new Set(usable.map(item => item.count).filter(Boolean))];
  return { expectedPageCount: counts.length ? Math.max(...counts) : null, pageCountConfidence: verified.length ? "verified" : counts.length ? "inferred" : "unknown", conflict: counts.length > 1, evidence };
}

function buildPageResult(candidates = [], evidence = [], extras = {}) {
  const proof = resolveEvidence(evidence);
  const groups = new Map();
  const identities = new Map();
  const rejected = [];
  let duplicates = 0;
  const quality = entry => (Number(entry.score) || 0) + Math.log2((entry.width || 1) * (entry.height || 1)) * 10 + (/origin/i.test(entry.resolution || "") ? 80 : /small|thumb/i.test(entry.resolution || "") ? -100 : 0) + (Number((entry.imageUrl.match(/!l(\d+)/i) || [])[1]) || 0) / 100;
  const valid = candidates.filter(entry => entry.validationStatus === "valid" && entry.role === "page_preview").sort((a, b) => quality(b) - quality(a));
  for (const entry of valid) {
    const identity = imageIdentity(entry.imageUrl);
    const pageNumber = positiveNumber(entry.pageNumber);
    const groupKey = entry.pageId ? `id:${entry.pageId}` : pageNumber ? `page:${pageNumber}` : `url:${identity}`;
    if (identities.has(identity)) {
      duplicates++;
      if (pageNumber && identities.get(identity) !== pageNumber) rejected.push({ page: pageNumber, reason: "same_resource_on_different_pages" });
      continue;
    }
    if (groups.has(groupKey) || (pageNumber && [...groups.values()].some(item => item.pageNumber === pageNumber))) { duplicates++; continue; }
    identities.set(identity, pageNumber);
    groups.set(groupKey, entry);
  }
  let selected = [...groups.values()];
  if (selected.some(entry => entry.pageNumber || entry.pageId)) selected = selected.filter(entry => entry.pageNumber || entry.pageId);
  // Loose URLs cannot establish multiple page identities.
  else selected = selected.slice(0, 1);
  selected.sort((a, b) => (a.pageNumber || Infinity) - (b.pageNumber || Infinity));
  const pages = selected.map((entry, index) => ({ ...entry, page: entry.pageNumber || index + 1, pageNumber: entry.pageNumber || null }));
  const mapped = new Set(selected.map(entry => positiveNumber(entry.pageNumber)).filter(Boolean));
  const missingPages = proof.expectedPageCount ? Array.from({ length: Math.min(proof.expectedPageCount, 10000) }, (_, index) => index + 1).filter(page => !mapped.has(page)) : [];
  const complete = Boolean(proof.expectedPageCount && !proof.conflict && !missingPages.length && pages.length === proof.expectedPageCount);
  const completenessStatus = complete ? "complete" : proof.expectedPageCount ? "partial" : "unknown";
  const warnings = [...new Set([...(extras.warnings || []), ...(proof.conflict ? ["page_count_evidence_conflict"] : []), ...(completenessStatus === "partial" ? ["missing_or_unmapped_pages"] : completenessStatus === "unknown" ? ["total_page_count_unknown"] : [])])];
  const imageUrls = pages.map(page => page.imageUrl);
  return { success: imageUrls.length > 0, platform: "818ps", ...extras, ...proof, pages, imageUrls, images: imageUrls, imageUrl: imageUrls[0] || null, thumbnailUrl: imageUrls[0] || null, pageCount: pages.length, collectedPageCount: pages.length, isMultiPage: pages.length > 1 || proof.expectedPageCount > 1, completenessStatus, isComplete: complete ? true : completenessStatus === "partial" ? false : null, missingPages, warnings, metadata: { ...(extras.metadata || {}), pageCountEvidence: evidence, duplicateCandidates: duplicates, rejectedPageMappings: rejected, results: pages.length } };
}

module.exports = { collectPageData, resolveEvidence, buildPageResult, imageIdentity, redact, MAX_PAGES };
