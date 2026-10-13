// Page evidence is collected before validation: a failed URL must not erase its page.
const PREVIEW_FIELDS = ["originalAnimationUrl", "original_animation_url", "animationUrl", "animation_url", "origin_img", "originImg", "big_img", "bigImg", "previewUrl", "preview_url", "preview", "user_preview_ue", "user_preview", "imageUrl", "image_url", "img", "image", "url", "src", "cover", "coverUrl", "small_img", "thumbnailUrl"];
const PAGE_LISTS = /^(pages|layouts|pageInfo|page_list|pageList)$/i;
const PREVIEW_LISTS = /^(preview|previews|page_previews|pagePreviews)$/i;
const ELEMENTS = /^(work|elements|materials|assets|stickers|children|recommendations|templates|items)$/i;
const COUNT_FIELDS = /^(pageCount|page_count|totalPages|total_pages|total_page)$/;
const MAX_PAGES = 100;

// Business evidence and image decoding are separate requirements. A filename or
// an "original" field alone is never evidence of scope or download permission.
function resourceProof(value, source) {
  const authorization = value?.authorization;
  const declaredRole = value?.resourceRole || value?.resourceType;
  return {
    declaredRole,
    scope: value?.scope,
    provider: authorization?.provider,
    access: authorization?.access,
    canDownload: authorization?.canDownload === true,
    source,
    trustedSource: /^(share_api|static\.|static_html|dynamic\.json)/.test(source),
  };
}

function classifyResource(candidate) {
  const proof = candidate.resourceProof;
  const verified = candidate.validationStatus === "valid" && candidate.isAnimated === true;
  if (verified && proof?.trustedSource && proof.provider === "818ps" && proof.canDownload &&
      ["public", "authenticated"].includes(proof.access) &&
      ["design_page", "full_design"].includes(proof.scope) &&
      (candidate.pageNumber || candidate.pageId) &&
      ["original_animation", "authorized_export"].includes(proof.declaredRole)) return proof.declaredRole;
  if (candidate.resourceRole === "thumbnail") return "thumbnail";
  if (candidate.roleEvidence === "original_reference_unconfirmed" || ["original_animation", "authorized_export"].includes(proof?.declaredRole || candidate.resourceRole)) return "unknown";
  return candidate.isAnimated === true ? "animation_preview" : candidate.isAnimated === false ? "static_preview" : "unknown";
}

function redact(value) {
  return String(value || "").replace(/(%3[fF]|%26)(auth_key|token|signature|sign|key|pram)%3[dD](.*?)(?=%26|["\s]|$)/gi, "$1$2%3D[redacted]").replace(/([?&](?:auth_key|token|signature|sign|key|pram)=)[^&#\s"']*/gi, "$1[redacted]");
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
        candidates.push({ ...meta, imageUrl: imageUrl.startsWith("//") ? `https:${imageUrl}` : imageUrl, role: "page_preview", score: meta.score ?? 1000 - depth * 10, resourceRole: /small|thumb/i.test(meta.resolution || "") ? "thumbnail" : "unknown" });
      }
      return;
    }
    if (typeof value !== "object" || Array.isArray(value)) return;
    for (const field of PREVIEW_FIELDS) {
      if (value[field]) urls(value[field], { ...meta, source: `${meta.source}.${field}`, score: 1000 - PREVIEW_FIELDS.indexOf(field) * 10, resolution: field, resourceProof: resourceProof(value, meta.source), roleEvidence: /^original_?animation/i.test(field) ? "original_reference_unconfirmed" : meta.roleEvidence }, depth + 1);
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
      // Optional explicit platform manifest. No URL is manufactured and no
      // export is triggered. Unknown layouts remain unverified references.
      if (/^(downloadResources|exportResources|originalResources)$/.test(key) && Array.isArray(child)) {
        child.slice(0, MAX_PAGES).forEach((resource, index) => {
          if (!resource || typeof resource !== "object" || !["design_page", "full_design"].includes(resource.scope)) return;
          const pageNumber = positiveNumber(resource.pageNumber ?? resource.page);
          const pageId = resource.pageId ?? resource.page_id ?? null;
          if (!pageNumber && !pageId) return;
          urls(resource, { source: `${path}.${key}[${index}]`, pageNumber, pageId, pageGroupId: "design", score: 1000, roleEvidence: "original_reference_unconfirmed", resourceProof: resourceProof(resource, path) });
        });
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
  const animationRank = entry => entry.isAnimated === true ? entry.resourceRole === "original_animation" ? 6 : entry.resourceRole === "authorized_export" ? 5 : entry.resourceRole === "unknown" ? 1 : entry.detectedFormat === "gif" ? 3 : 2 : 0;
  const valid = candidates.filter(entry => entry.validationStatus === "valid" && entry.role === "page_preview").map(entry => ({ ...entry, resourceRole: classifyResource(entry) })).sort((a, b) => animationRank(b) - animationRank(a) || quality(b) - quality(a));
  for (const entry of valid) {
    const identity = entry.contentHash || entry.imageUrl;
    const pageNumber = positiveNumber(entry.pageNumber);
    const groupKey = pageNumber ? `page:${pageNumber}` : entry.pageId ? `id:${entry.pageId}` : `url:${imageIdentity(entry.imageUrl)}`;
    if (identities.has(identity)) {
      duplicates++;
      if (pageNumber && identities.get(identity) !== pageNumber) rejected.push({ page: pageNumber, reason: "same_resource_on_different_pages" });
      continue;
    }
    if (groups.has(groupKey) || (pageNumber && [...groups.values()].some(item => item.pageNumber === pageNumber))) continue;
    identities.set(identity, pageNumber);
    groups.set(groupKey, entry);
  }
  let selected = [...groups.values()];
  if (selected.some(entry => entry.pageNumber || entry.pageId)) selected = selected.filter(entry => entry.pageNumber || entry.pageId);
  // Loose URLs cannot establish multiple page identities.
  else selected = selected.slice(0, 1);
  selected.sort((a, b) => (a.pageNumber || Infinity) - (b.pageNumber || Infinity));
  const statusFor = entry => !entry ? "unavailable" : entry.resourceRole === "original_animation" ? "original_verified" : entry.resourceRole === "authorized_export" ? "authorized_export_verified" : entry.resourceRole === "unknown" ? "unknown" : "preview_only";
  const pages = selected.map((entry, index) => ({ ...entry, page: entry.pageNumber || index + 1, pageNumber: entry.pageNumber || null, ...(entry.animationTarget || entry.isAnimated === true ? { originalResourceStatus: statusFor(entry), downloadStatus: statusFor(entry), hasVisibleWatermark: "unknown" } : {}) }));
  const mapped = new Set(selected.map(entry => positiveNumber(entry.pageNumber)).filter(Boolean));
  const missingPages = proof.expectedPageCount ? Array.from({ length: Math.min(proof.expectedPageCount, 10000) }, (_, index) => index + 1).filter(page => !mapped.has(page)) : [];
  const complete = Boolean(proof.expectedPageCount && !proof.conflict && !missingPages.length && pages.length === proof.expectedPageCount);
  const completenessStatus = complete ? "complete" : proof.expectedPageCount ? "partial" : "unknown";
  const warnings = [...new Set([...(extras.warnings || []), ...(proof.conflict ? ["page_count_evidence_conflict"] : []), ...(completenessStatus === "partial" ? ["missing_or_unmapped_pages"] : completenessStatus === "unknown" ? ["total_page_count_unknown"] : [])])];
  const imageUrls = pages.map(page => page.imageUrl);
  const main = selected[0];
  const animationTarget = extras.animationTarget || candidates.some(entry => entry.animationTarget || entry.isAnimated === true || /\.gif(?:[!?]|$)/i.test(entry.imageUrl));
  const thumbnail = main && valid.find(entry => entry.isAnimated === false && entry.pageNumber === main.pageNumber && entry.resourceRole === "thumbnail");
  const animationFields = animationTarget ? { mediaType: main?.mediaType || null, detectedFormat: main?.detectedFormat || "unknown", isAnimated: main?.isAnimated ?? null, frameCount: main?.frameCount ?? null, durationMs: main?.durationMs ?? null, loopCount: main?.loopCount ?? null, animationUrl: main?.isAnimated === true ? main.imageUrl : null, resourceRole: main?.resourceRole || "unknown", animationStatus: !main ? "unavailable" : main.isAnimated === true ? "verified_animated" : main.isAnimated === false ? "preview_only" : "unknown" } : {};
  if (animationTarget) {
    // The top-level status covers every returned page, including mixed results.
    const statuses = selected.map(statusFor);
    const originalResourceStatus = !main ? "unavailable" : statuses.every(status => status === "original_verified") ? "original_verified" : statuses.every(status => ["original_verified", "authorized_export_verified"].includes(status)) ? "authorized_export_verified" : statuses.includes("unknown") ? "unknown" : "preview_only";
    Object.assign(animationFields, { originalResourceStatus, downloadStatus: originalResourceStatus, hasVisibleWatermark: "unknown", selectionReason: originalResourceStatus === "original_verified" ? "validated_animation_with_original_business_and_permission_evidence" : originalResourceStatus === "authorized_export_verified" ? "validated_animation_with_official_export_and_permission_evidence" : main?.isAnimated ? "validated_animation_original_not_confirmed" : "best_accessible_static_preview" });
    if (!["original_verified", "authorized_export_verified"].includes(originalResourceStatus)) warnings.push(main?.isAnimated ? "animation_preview_original_unconfirmed" : "no_verified_animation_available");
  }
  return { success: imageUrls.length > 0, platform: "818ps", ...extras, ...proof, ...animationFields, pages, imageUrls, images: imageUrls, imageUrl: imageUrls[0] || null, thumbnailUrl: thumbnail?.imageUrl || imageUrls[0] || null, pageCount: pages.length, collectedPageCount: pages.length, isMultiPage: pages.length > 1 || proof.expectedPageCount > 1, completenessStatus, isComplete: complete ? true : completenessStatus === "partial" ? false : null, missingPages, warnings, metadata: { ...(extras.metadata || {}), pageCountEvidence: evidence, duplicateCandidates: duplicates, alternateVersions: Math.max(0, valid.length - duplicates - pages.length), mediaCandidates: animationTarget ? valid.map(entry => ({ source: entry.source, pageNumber: entry.pageNumber, resourceRole: entry.resourceRole, detectedFormat: entry.detectedFormat, isAnimated: entry.isAnimated, frameCount: entry.frameCount, durationMs: entry.durationMs, fileSize: entry.fileSize, width: entry.width, height: entry.height, contentHash: entry.contentHash })) : undefined, rejectedPageMappings: rejected, results: pages.length } };
}

module.exports = { collectPageData, resolveEvidence, buildPageResult, classifyResource, imageIdentity, redact, MAX_PAGES };
