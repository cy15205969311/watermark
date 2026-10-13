// Stable fixtures and real Chromium interactions. No remote services or production DB.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const sharp = require("sharp");
const axios = require("axios");
const { inspectMedia, parseGif } = require("./extractors/818ps-animation");
const { collectPageData, buildPageResult, redact } = require("./extractors/818ps-pages");
const { extract818ps, validateImageResource, _test } = require("./extractors/818ps");
const { normalizeExtractPayload, extractionDetails, restoreRecord } = require("./utils/extractPayload");
const { retryRequest, classifyRequestError } = require("./thirdPartyApiGateway");
const { getDefaultPool, closeDefaultPool } = require("./services/browser-pool");
let server, base, animated, watermarked, single, png, webp, thumbnail;
const markValid = collection => collection.candidates.map(entry => ({ ...entry, validationStatus: "valid" }));
const evidence = count => [{ count, confidence: "verified", source: "fixture.pageCount" }];
const entry = (page, extra = {}) => ({ imageUrl: `${base}/page-${page}.png`, pageNumber: page, role: "page_preview", validationStatus: "valid", score: 1000, ...extra });

before(async () => {
  animated = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).gif({ delay: [100, 200], loop: 0 }).toBuffer();
  // A real pixel stamp in both fixture frames; classification must still avoid
  // claiming automatic watermark detection or an original resource.
  const stamped = await sharp(Buffer.from('<svg width="64" height="128"><rect width="64" height="64" fill="red"/><rect y="64" width="64" height="64" fill="blue"/><g font-size="12" fill="white"><text x="2" y="32">PREVIEW</text><text x="2" y="96">PREVIEW</text></g></svg>')).ensureAlpha().raw().toBuffer();
  watermarked = await sharp(stamped, { raw: { width: 64, height: 128, channels: 4, pageHeight: 64 } }).gif({ delay: [100, 200] }).toBuffer();
  single = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).gif().toBuffer();
  png = await sharp({ create: { width: 600, height: 800, channels: 3, background: "blue" } }).png().toBuffer();
  thumbnail = await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).png().toBuffer();
  webp = await sharp(animated, { animated: true }).webp().toBuffer();
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixture");
    if (url.pathname === "/resource-discovery") {
      res.setHeader("Content-Type", "text/html");
      const manifest = { pageCount: 1, downloadResources: [{ page: 1, scope: "design_page", resourceRole: "original_animation", authorization: { provider: "818ps", access: "public", canDownload: true }, url: `${base}/authorized-anim.gif` }] };
      // Runtime-only data proves that an API preview doesn't end discovery.
      return res.end(`<script>setTimeout(()=>{const s=document.createElement('script');s.type='application/json';s.textContent=${JSON.stringify(JSON.stringify(manifest))};document.body.appendChild(s)},250)</script>`);
    }
    if (url.pathname.startsWith("/dynamic")) {
      const pages = Array.from({ length: 5 }, (_, i) => ({ page: i + 1, previewUrl: `${base}/page-${i + 1}.png` }));
      res.setHeader("Content-Type", "text/html");
      return res.end(`<script type="application/json">${JSON.stringify({ pages: [pages[0]], pageCount: 5 })}</script><div class="page-list">${pages.map(page => `<button data-page="${page.page}" aria-selected="${page.page === 1}" onclick="switchPage(${page.page},this)">第 ${page.page} 页</button>`).join("")}</div><img id="main" src="${pages[0].previewUrl}" style="width:300px;height:400px"><script>function switchPage(n,button){document.querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b===button)));${url.pathname === "/dynamic" ? "if(n===3)return;" : ""}setTimeout(()=>{document.querySelector('#main').src='${base}/page-'+n+'.png';document.querySelector('script[type=\"application/json\"]').textContent=JSON.stringify({pageCount:5,pages:[{page:n,previewUrl:'${base}/page-'+n+'.png'}]})},500)}</script>`);
    }
    if (url.pathname === "/static") {
      res.setHeader("Content-Type", "text/html");
      return res.end(`<script type="application/json">${JSON.stringify({ pageCount: 5, pages: [{ page: 1, previewUrl: `${base}/page-1.png` }] })}</script>`);
    }
    if (url.pathname === "/expired.gif") { res.statusCode = 403; return res.end("expired"); }
    if (url.pathname === "/error.gif") { res.setHeader("Content-Type", "image/gif"); return res.end("<html>error page</html>"); }
    let buffer = url.pathname.includes("watermarked") ? watermarked : url.pathname.includes("thumbnail") ? thumbnail : url.pathname.includes("single") ? single : url.pathname.includes("webp") ? webp : url.pathname.includes("anim") ? animated : url.pathname.includes("truncated") ? animated.subarray(0, -2) : png;
    const type = buffer === png ? "image/png" : buffer === webp ? "image/webp" : "image/gif";
    res.setHeader("Content-Type", url.pathname === "/wrong-type.gif" ? "text/plain" : type);
    res.setHeader("Content-Length", buffer.length);
    if (req.method === "HEAD") { if (url.pathname.includes("nohead")) res.statusCode = 405; return res.end(); }
    res.end(buffer);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await closeDefaultPool(); await new Promise(resolve => server.close(resolve)); });

test("A: verified single page stays valid and complete", () => {
  const data = collectPageData({ doc: { pageAttr: { pageInfo: [{}] } }, preview: [`${base}/page-1.png`] });
  const result = buildPageResult(markValid(data), data.evidence);
  assert.equal(result.pageCount, 1); assert.equal(result.isComplete, true);
});
test("B/F: five pages sorted; same-page thumbnail does not add pages", () => {
  const data = collectPageData({ pageCount: 5, pages: [5, 2, 1, 4, 3].map(page => ({ page, pageId: `id-${page}`, previewUrl: `${base}/page-${page}.png`, thumbnailUrl: `${base}/thumb-${page}.png` })) });
  const result = buildPageResult(markValid(data), data.evidence);
  assert.deepEqual(result.pages.map(page => page.page), [1, 2, 3, 4, 5]);
  assert.equal(result.completenessStatus, "complete"); assert.equal(result.imageUrls.some(url => url.includes("thumb")), false);
});
test("C/G: static cover keeps expected count and missing page numbers", async () => {
  const result = await _test.scrapeWebpageEnhanced(`${base}/static`);
  assert.equal(result.pageCount, 1); assert.equal(result.completenessStatus, "partial"); assert.deepEqual(result.missingPages, [2, 3, 4, 5]);
  const partial = buildPageResult([1, 2, 4, 5].map(page => entry(page)), evidence(5));
  assert.deepEqual(partial.missingPages, [3]);
  const normalized = require("./extractors/818ps").normalizeResultImages(partial);
  assert.deepEqual(normalized.pages.map(page => page.page), [1, 2, 4, 5]);
  assert.equal(_test.mergeStageResults([{ ...partial, candidates: [1, 2, 4, 5].map(page => entry(page)) }, { candidates: [entry(3)], evidence: evidence(5), success: true, source: "dynamic" }]).isComplete, true);
});
test("E: element resources and their counts never contaminate pages", () => {
  const data = collectPageData({ pages: [1, 2, 3].map(page => ({ page, previewUrl: `${base}/page-${page}.png`, elements: Array.from({ length: 40 }, (_, i) => ({ previewUrl: `${base}/element-${i}.png`, pageCount: 40 })) })), doc: { work: [[{ attribute: { picUrl: `${base}/psd_import/1.png` } }]] } });
  assert.equal(data.candidates.length, 3); assert.equal(buildPageResult(markValid(data), evidence(3)).pageCount, 3);
});
test("unknown total and arbitrary URL numbers cannot establish completeness", () => {
  const result = buildPageResult([entry(null, { imageUrl: `${base}/psd_import/5.png` })], []);
  assert.equal(result.completenessStatus, "unknown"); assert.equal(result.isComplete, null);
  assert.equal(result.pages[0].pageNumber, null);
});
test("GIF target without valid resources stays unavailable", () => {
  const result = _test.mergeStageResults([{ animationTarget: true, candidates: [], evidence: evidence(1) }]);
  assert.equal(result.success, false);
  assert.equal(result.animationStatus, "unavailable");
  assert.equal(result.animationUrl, null);
  assert.equal(result.isAnimated, null);
});
test("expired share business message ends extraction without browser activation", async () => {
  const oldGet = axios.get;
  let browserAcquired = false;
  axios.get = async () => ({ status: 200, data: '<div class="div-child"><span class="font1">邀请链接失效</span></div>' });
  try {
    const result = await extract818ps("https://818ps.com/?share_id=fixture", { browserPool: { acquire() { browserAcquired = true; throw new Error("must_not_acquire"); } } });
    assert.equal(result.success, false);
    assert.ok(result.warnings.includes("share_link_expired"));
    assert.equal(browserAcquired, false);
  } finally { axios.get = oldGet; }
});
test("conflicting reliable counts cannot report complete", () => {
  const result = buildPageResult([entry(1)], [...evidence(1), ...evidence(5)]);
  assert.equal(result.isComplete, false); assert.ok(result.warnings.includes("page_count_evidence_conflict"));
});
test("GIF A: full two-frame GIF parsed, downloaded bytes remain animated", async () => {
  const result = await validateImageResource(`${base}/anim.gif`);
  assert.equal(result.isAnimated, true); assert.equal(result.frameCount, 2); assert.equal(result.durationMs, 300); assert.equal(result.loopCount, 0);
  const response = await axios.get(`${base}/anim.gif`, { responseType: "arraybuffer" });
  assert.deepEqual(Buffer.from(response.data), animated);
  assert.equal((await inspectMedia(response.data)).frameCount, 2);
});
test("GIF B: single-frame GIF is static", async () => {
  const result = await validateImageResource(`${base}/single.gif`);
  assert.equal(result.isAnimated, false); assert.equal(result.frameCount, 1);
});
test("GIF E: .gif URL returning PNG is static by bytes; wrong content-type tolerated", async () => {
  const result = await validateImageResource(`${base}/wrong-type.gif`);
  assert.equal(result.valid, true); assert.equal(result.detectedFormat, "png"); assert.equal(result.isAnimated, false);
});
test("GIF I: expired URLs, HTML errors and truncated files rejected", async () => {
  assert.equal((await validateImageResource(`${base}/expired.gif?auth_key=expired`)).reason, "forbidden_or_expired_signature");
  assert.equal((await validateImageResource(`${base}/error.gif`)).reason, "non_image_body");
  assert.equal((await validateImageResource(`${base}/truncated.gif`)).valid, false);
  assert.throws(() => parseGif(animated.subarray(0, -1)), /trailer|truncated/);
});
test("HEAD unsupported and tiny valid images remain usable", async () => {
  assert.equal((await validateImageResource(`${base}/single-nohead.gif`)).valid, true);
});
test("GIF C/D/F: animated preview wins static variants; content hashes drive duplicate count", async () => {
  const resources = await Promise.all([`${base}/anim.gif!l1600`, `${base}/same.gif!l1000_b`, `${base}/animated-webp.gif!w380_webp`, `${base}/thumbnail.gif!w128_h128`].map(imageUrl => validateImageResource(imageUrl, { animationTarget: true }).then(meta => entry(1, { imageUrl, ...meta, resourceRole: meta.isAnimated ? "animation_preview" : "static_preview" }))));
  const result = buildPageResult(resources, evidence(1));
  assert.equal(result.animationStatus, "verified_animated"); assert.equal(result.detectedFormat, "gif"); assert.equal(result.animationUrl, resources[0].imageUrl);
  assert.equal(result.metadata.duplicateCandidates, 0); assert.equal(result.metadata.alternateVersions, 3);
  assert.equal(result.resourceRole, "animation_preview");
  const preview = buildPageResult([resources[1]], evidence(1), { animationTarget: true });
  assert.equal(preview.animationStatus, "preview_only"); assert.equal(preview.animationUrl, null);
});
test("original animation wins only with business permission evidence and decoded frames", () => {
  const result = buildPageResult([entry(1, { imageUrl: `${base}/original.gif`, resourceProof: { trustedSource: true, provider: "818ps", access: "public", canDownload: true, scope: "design_page", declaredRole: "original_animation" }, isAnimated: true, detectedFormat: "gif", frameCount: 2 }), entry(1, { resourceRole: "static_preview", isAnimated: false, score: 999999 })], evidence(1));
  assert.equal(result.resourceRole, "original_animation"); assert.equal(result.isAnimated, true);
  assert.equal(result.originalResourceStatus, "original_verified");
});

test("resource A/D: animated preview stays preview_only; no automatic watermark guess", async () => {
  const collection = collectPageData({ pageCount: 1, preview: [`${base}/watermarked-anim.gif`] }, "share_api.fixture");
  collection.animationTarget = true;
  const result = await _test.validatePageCollection(collection, "share_api");
  assert.equal(result.resourceRole, "animation_preview");
  assert.equal(result.frameCount, 2); assert.equal(result.animationStatus, "verified_animated");
  assert.equal(result.downloadStatus, "preview_only"); assert.equal(result.originalResourceStatus, "preview_only");
  assert.equal(result.hasVisibleWatermark, "unknown");
});

test("resource C: authorized original and export manifests outrank even larger GIF previews", async () => {
  for (const role of ["original_animation", "authorized_export"]) {
    const collection = collectPageData({ pageCount: 1, preview: [`${base}/anim.gif!l1600`], downloadResources: [{ page: 1, scope: "design_page", resourceRole: role, authorization: { provider: "818ps", access: "public", canDownload: true }, url: `${base}/authorized-anim.gif?auth_key=valid` }] }, "share_api.fixture");
    const result = await _test.validatePageCollection({ ...collection, animationTarget: true }, "share_api");
    assert.equal(result.resourceRole, role);
    assert.equal(result.imageUrl, `${base}/authorized-anim.gif?auth_key=valid`);
    assert.equal(result.frameCount, 2); assert.equal(result.downloadStatus, role === "original_animation" ? "original_verified" : "authorized_export_verified");
    assert.equal(result.pages[0].downloadStatus, result.downloadStatus);
    assert.deepEqual(Buffer.from((await axios.get(result.imageUrl, { responseType: "arraybuffer" })).data), animated);
  }
});

test("misleading original field, element scope, denied permission, static or expired originals cannot verify", async () => {
  const misleading = collectPageData({ pages: [{ page: 1, originalAnimationUrl: `${base}/anim.gif` }] }, "share_api.fixture");
  const unconfirmed = await _test.validatePageCollection({ ...misleading, animationTarget: true }, "share_api");
  assert.equal(unconfirmed.resourceRole, "unknown"); assert.equal(unconfirmed.originalResourceStatus, "unknown");
  for (const overrides of [{ scope: "element" }, { authorization: { provider: "818ps", access: "public", canDownload: false } }, { url: `${base}/single.gif` }, { url: `${base}/expired.gif?auth_key=expired` }]) {
    const data = collectPageData({ pageCount: 1, preview: [`${base}/anim.gif`], exportResources: [{ page: 1, scope: "design_page", resourceRole: "original_animation", authorization: { provider: "818ps", access: "public", canDownload: true }, url: `${base}/authorized-anim.gif`, ...overrides }] }, "share_api.fixture");
    const result = await _test.validatePageCollection({ ...data, animationTarget: true }, "share_api");
    assert.equal(result.originalResourceStatus, "preview_only"); assert.equal(result.resourceRole, "animation_preview");
  }
});

test("complete animated API preview still inspects passive page business data for original resource", { timeout: 25000 }, async () => {
  const oldGet = axios.get;
  axios.get = async (url, options) => {
    if (url.includes("share-template")) return { status: 200, data: { data: { preview: [`${base}/anim.gif`], pageCount: 1 } } };
    return oldGet(url, options);
  };
  try {
    const result = await extract818ps(`${base}/resource-discovery?share_id=fixture`, { totalTimeout: 20000 });
    assert.equal(result.originalResourceStatus, "original_verified");
    assert.ok(result.imageUrl.includes("authorized-anim"));
    assert.equal(result.pageCount, 1); assert.equal(result.frameCount, 2);
    assert.equal(result.warnings.includes("animation_preview_original_unconfirmed"), false);
  } finally { axios.get = oldGet; }
});

test("mixed original and preview pages cannot claim all returned resources are originals", () => {
  const result = buildPageResult([entry(1, { imageUrl: `${base}/original.gif`, isAnimated: true, resourceProof: { trustedSource: true, provider: "818ps", access: "public", canDownload: true, scope: "design_page", declaredRole: "original_animation" } }), entry(2, { imageUrl: `${base}/preview.gif`, isAnimated: true })], evidence(2));
  assert.equal(result.isComplete, true);
  assert.equal(result.pages[0].downloadStatus, "original_verified");
  assert.equal(result.pages[1].downloadStatus, "preview_only");
  assert.equal(result.originalResourceStatus, "preview_only");
});
test("H/GIF G: certificate errors never retry, transient errors retry once", async () => {
  let calls = 0;
  const error = Object.assign(new Error("expired"), { code: "CERT_HAS_EXPIRED" });
  assert.equal(classifyRequestError(error), "certificate");
  await assert.rejects(retryRequest(() => { calls++; throw error; }, 2, 1)); assert.equal(calls, 1);
  calls = 0;
  await retryRequest(() => { if (++calls === 1) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); return true; }, 2, 1);
  assert.equal(calls, 2);
});
test("signed URLs preserved; redaction removes temporary credentials", () => {
  const url = `${base}/anim.gif!l1600?auth_key=secret&resource=abc`;
  assert.deepEqual(_test.build818psVariants(url), [url]); assert.equal(redact(url).includes("secret"), false);
});
test("J/GIF I: API normalizer and stored JSON restore all pages and animation metadata", () => {
  const result = buildPageResult([entry(1, { imageUrl: `${base}/anim.gif`, isAnimated: true, frameCount: 2, durationMs: 300, resourceRole: "animation_preview", detectedFormat: "gif" }), entry(2)], evidence(2));
  const payload = normalizeExtractPayload({ ...result, thumbnailUrl: `${base}/thumb.png` });
  assert.equal(payload.imageUrls.length, 2); assert.equal(payload.imageUrl, result.animationUrl);
  const restored = restoreRecord({ image_urls_json: JSON.stringify(payload.imageUrls), pages_json: JSON.stringify(payload.pages), extraction_metadata_json: JSON.stringify(extractionDetails(payload)), page_count: 2, is_multi_page: 1 });
  assert.deepEqual(restored.imageUrls, payload.imageUrls); assert.equal(restored.animationUrl, result.animationUrl); assert.equal(restored.durationMs, 300);
  assert.equal(restoreRecord({ thumbnail_url: "old" }).pages.length, 0);
});
test("K: other platform multi-page normalization remains compatible", () => {
  for (const platform of ["Chuangkit", "Gaoding", "Canva", "Huaban"]) {
    const result = normalizeExtractPayload({ platform, imageUrls: [`${base}/a.png`, `${base}/b.png`], thumbnailUrl: `${base}/thumb.png` });
    assert.equal(result.platform, platform); assert.equal(result.pageCount, 2); assert.equal(result.isMultiPage, true);
  }
});
test("share API actual field shapes: ips_user_preview_api is full preview; GIF elements excluded", async () => {
  const oldGet = axios.get;
  axios.get = async (url, options) => {
    if (url.includes("share-template")) return { status: 200, data: { data: { preview: [`${base}/anim.gif!l1600?auth_key=valid`] } } };
    if (url.includes("team-share")) return { status: 200, data: { doc: { pageAttr: { pageInfo: [{ gifInfo: [{ imagePath: `${base}/element.gif` }] }] }, work: [[{ attribute: { picUrl: `${base}/element.png` } }]] }, preview: [`${base}/cover.gif!l1000_b`] } };
    if (url.includes("get-template-page-data")) return { status: 200, data: { url: { preview: [{ big_img: `${base}/webp.gif!w380_webp`, small_img: `${base}/small.gif!w128_h128` }], work: [[{}]] } } };
    if (url.includes("get-template-info")) return { status: 200, data: { data: false } };
    return oldGet(url, options);
  };
  try {
    const result = await _test.extractFromShareApi("https://gif.818ps.com/?share_id=fixture&share_uid=1&upicId=1");
    assert.equal(result.frameCount, 2); assert.equal(result.resourceRole, "animation_preview"); assert.equal(result.pageCount, 1); assert.equal(result.thumbnailUrl.includes("small"), true);
  } finally { axios.get = oldGet; }
});
test("D: real browser delayed page switching rejects unchanged previous image", { timeout: 20000 }, async () => {
  const pool = getDefaultPool();
  const browser = await pool.acquire();
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/dynamic`);
    const before = await _test.captureDynamicSnapshot(page);
    const page2 = await _test.captureActivatedPage(page, 2, before, Date.now() + 5000);
    assert.equal(page2.activation.confirmed, true); assert.ok(page2.previewUrls[0].includes("page-2"));
    const failed3 = await _test.captureActivatedPage(page, 3, page2, Date.now() + 4000);
    assert.equal(failed3.activation.confirmed, false); assert.deepEqual(failed3.previewUrls, []);
    const page4 = await _test.captureActivatedPage(page, 4, failed3, Date.now() + 5000);
    assert.equal(page4.activation.confirmed, true); assert.ok(page4.previewUrls[0].includes("page-4"));
  } finally { await page.close(); pool.release(browser); }
});
test("C: incomplete static cover proceeds into dynamic and merges five pages", { timeout: 30000 }, async () => {
  const result = await extract818ps(`${base}/dynamic-all`, { totalTimeout: 25000, dynamicTimeout: 18000 });
  assert.equal(result.pageCount, 5); assert.equal(result.isComplete, true);
});

test("HTTP extraction/parse/history and binary proxy roundtrip with isolated DB adapter", async () => {
  const mysql = require("mysql2/promise");
  const browserService = require("./services/browser-pool");
  const extractor = require("./imageExtractor");
  const originals = { createPool: mysql.createPool, init: browserService.initDefaultPool, extract: extractor.extractImage, request: axios.request };
  const rows = [];
  const result = buildPageResult([entry(1, { imageUrl: "https://img.tuguaishou.com/fixture.gif?auth_key=fixture-only", isAnimated: true, detectedFormat: "gif", mediaType: "image/gif", resourceRole: "animation_preview", frameCount: 2, durationMs: 300 }), entry(2, { isAnimated: false, detectedFormat: "png", resourceRole: "static_preview" })], evidence(2));
  let apiServer;
  try {
    mysql.createPool = () => ({ getConnection: async () => ({ release() {} }), query: async (sql, values) => {
      if (sql.startsWith("SHOW")) return [[{ Type: "varchar(32)" }]];
      if (sql.startsWith("INSERT")) {
        assert.equal(values.length, 11);
        rows.push({ id: 1, original_url: values[0], platform: values[1], thumbnail_url: values[4], image_urls_json: values[6], pages_json: values[7], page_count: values[8], is_multi_page: values[9], extraction_metadata_json: values[10] });
        return [{ insertId: 1 }];
      }
      if (sql.startsWith("SELECT")) return [rows];
      throw new Error("Unexpected SQL mutation in test");
    } });
    browserService.initDefaultPool = async () => ({ getStatus: () => ({ available: 0 }) });
    extractor.extractImage = async () => result;
    const { app, ensureParseRecordColumns } = require("./index");
    await ensureParseRecordColumns();
    apiServer = await new Promise(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const root = `http://127.0.0.1:${apiServer.address().port}/api`;
    const extracted = (await axios.post(`${root}/extract-image`, { url: "https://818ps.com/?fixture", platform: "818ps.com" })).data;
    assert.equal(extracted.frameCount, 2); assert.equal(extracted.animationUrl, result.animationUrl);
    const saved = (await axios.post(`${root}/parse`, { ...extracted, url: "https://818ps.com/?fixture", thumbnailUrl: "https://img.tuguaishou.com/static.png" }, { headers: { "X-Client-Id": "fixture-client" } })).data.data;
    assert.equal(saved.imageUrl, result.animationUrl); assert.equal(saved.thumbnailUrl.endsWith("static.png"), true);
    const history = (await axios.get(`${root}/history`, { headers: { "X-Client-Id": "fixture-client" } })).data.data[0];
    assert.equal(history.animationUrl, result.animationUrl); assert.equal(history.frameCount, 2); assert.equal(history.pageCount, 2); assert.equal(history.imageUrls.length, 2); assert.equal(history.pages.length, 2);
    assert.equal(history.downloadStatus, "preview_only"); assert.equal(history.originalResourceStatus, "preview_only"); assert.equal(history.hasVisibleWatermark, "unknown");
    const { Readable } = require("stream");
    let proxyOptions;
    axios.request = async options => {
      proxyOptions = options;
      return { status: options.headers.Range ? 206 : 200, headers: { "content-type": "image/gif", "content-length": animated.length, ...(options.headers.Range ? { "content-range": `bytes 0-${animated.length - 1}/${animated.length}` } : {}) }, data: Readable.from(options.method === "HEAD" ? [] : [animated]) };
    };
    const proxyUrl = `${root}/proxy-image?url=${encodeURIComponent(result.animationUrl)}`;
    const binary = await axios.get(proxyUrl, { responseType: "arraybuffer" });
    assert.deepEqual(Buffer.from(binary.data), animated); assert.equal(binary.headers["content-type"], "image/gif");
    assert.equal((await inspectMedia(binary.data)).frameCount, 2);
    assert.equal(proxyOptions.headers.Referer, "https://tuguaishou.com/");
    assert.throws(() => proxyOptions.beforeRedirect({ hostname: "127.0.0.1" }), /not_allowed/);
    const range = await axios.get(proxyUrl, { headers: { Range: "bytes=0-90" }, responseType: "arraybuffer" });
    assert.equal(range.status, 206); assert.deepEqual(Buffer.from(range.data), animated);
    const head = await axios.head(proxyUrl); assert.equal(head.status, 200); assert.equal(proxyOptions.method, "HEAD");
  } finally {
    mysql.createPool = originals.createPool; browserService.initDefaultPool = originals.init; extractor.extractImage = originals.extract; axios.request = originals.request;
    if (apiServer) await new Promise(resolve => apiServer.close(resolve));
  }
});
