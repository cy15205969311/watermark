// Deterministic HTML/JSON, real image bytes and Chromium. No production database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const sharp = require('sharp');
const axios = require('axios');
const { extractGaoding, __internals: g } = require('./extractors/gaoding');
const { closeDefaultPool } = require('./services/browser-pool');
const { normalizeExtractPayload, extractionDetails, restoreRecord } = require('./utils/extractPayload');
let server, base, png, small, tall, retryRequests = 0;
const html = data => `<script type="application/json">${JSON.stringify(data)}</script>`;
const page = (number, extra = {}) => ({ id: `p${number}`, pageNumber: number, preview_info: { url: `${base}/page-${number}.png`, width: 600, height: 800 }, ...extra });
const cases = {
  structured: () => ({ shareCode: 'structured', pageCount: 1, pages: [page(1)], recommendations: [{ preview_info: { url: `${base}/ui.png` } }] }),
  cover: () => ({ shareCode: 'cover', preview_info: { url: `${base}/cover.png` }, design_info: { url: `${base}/design.json` } }),
  five: () => ({ shareCode: 'five', preview_info: { url: `${base}/cover.png` }, design_info: { url: `${base}/five.json` } }),
  brokenJson: () => ({ shareCode: 'brokenJson', preview_info: { url: `${base}/cover.png` }, design_info: { url: `${base}/broken.json` } }),
  retryJson: () => ({ shareCode: 'retryJson', preview_info: { url: `${base}/cover.png` }, design_info: { url: `${base}/retry.json` } }),
  single: () => ({ shareCode: 'single', layouts: [page(1)] }),
  partial: () => ({ shareCode: 'partial', pageCount: 3, pages: [page(1)] }),
  mixed: () => ({ shareCode: 'mixed', pages: [page(1, { elements: [{ type: 'image', preview_info: { url: `${base}/ui.png` } }] }), { id: 'p2', elements: [{ type: 'image', preview_info: { url: `${base}/element.png` } }] }] }),
  variants: () => ({ shareCode: 'variants', pageCount: 1, preview_info: { url: `${base}/page-1.png` }, extends_previews: [{ url: `${base}/small.png` }, { url: `${base}/cover.png` }] }),
  unknown: () => ({ shareCode: 'unknown', preview_info: { url: `${base}/page-1.png` } }),
};
before(async () => {
  png = await sharp({ create: { width: 600, height: 800, channels: 3, background: 'blue' } }).png().toBuffer();
  small = await sharp({ create: { width: 30, height: 40, channels: 3, background: 'blue' } }).png().toBuffer();
  tall = await sharp({ create: { width: 600, height: 1000, channels: 3, background: 'green' } }).png().toBuffer();
  server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://fixture').pathname;
    if (path === '/design.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ pages: [page(1), page(2), page(3)], layouts: [page(1), page(2), page(3)] })); }
    if (path === '/five.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ pages: [5, 3, 1, 4, 2].map(n => page(n, { thumbnailUrl: `${base}/small.png` })), layouts: [1, 2, 3, 4, 5].map(n => page(n)) })); }
    if (path === '/broken.json') { res.setHeader('Content-Type', 'text/html'); return res.end('<html>login required</html>'); }
    if (path === '/retry.json') { res.setHeader('Content-Type', 'application/json'); if (++retryRequests === 1) { res.statusCode = 503; return res.end('{}'); } return res.end(JSON.stringify({ pages: [page(1), page(2)] })); }
    if (path === '/failed.png') { res.statusCode = 503; return res.end('temporarily unavailable'); }
    if (path.startsWith('/api/share/')) {
      res.setHeader('Content-Type', 'application/json');
      const three = path.endsWith('/network-three');
      return res.end(JSON.stringify({ shareCode: three ? 'network-three' : 'network', pageCount: three ? 3 : 2, pages: three ? [page(1), page(2), page(3)] : [page(1), page(2)] }));
    }
    if (path === '/api/recommendations') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ shareCode: 'another-share', pageCount: 10, pages: [page(9)] }));
    }
    if (path.endsWith('.png') || path === '/signed-resource') {
      res.setHeader('Content-Type', 'image/png'); const data = path === '/small.png' ? small : path === '/tall.png' ? tall : png;
      res.setHeader('Content-Length', data.length); return res.end(data);
    }
    res.setHeader('Content-Type', 'text/html');
    const key = path.split('/').pop();
    if (key === 'network' || key === 'network-three') return res.end(`<img src="${base}/ui.png"><script>setTimeout(()=>{fetch('/api/share/${key}').then(r=>r.json());fetch('/api/recommendations')},300)</script>`);
    if (key.startsWith('pagination')) {
      const count = key === 'pagination' ? 3 : 2;
      const data = { metaShareCode: key, metaShareInfo: { shareCode: key, fileIds: ['file1'] }, metaFileDetail: { id: 'file1', preview_info: { url: `${base}/page-1.png`, width: 600, height: 800 } } };
      return res.end(`<web-widget contextdata='${JSON.stringify(data)}'></web-widget>
        <main id="dam-preview-container"><div class="gd-dam-space__multi-preview__preview-list" style="width:90px;overflow:auto;display:flex">
        ${Array.from({ length: count }, (_, i) => `<button data-preview-index="${i}" class="${i === 0 ? 'gd-dam-space__multi-preview__preview-item-active' : ''}" style="min-width:70px" onclick="activate(${i})">预览 ${i + 1}</button>`).join('')}</div>
        <div fileid="file1" data-main-preview data-page-number="1"><img id="mainImage" width="300" src="${base}/page-1.png"></div></main>
        <script>function activate(index) { document.querySelectorAll('button').forEach((b,i)=>b.classList.toggle('gd-dam-space__multi-preview__preview-item-active',i===index));
          if (index===0) return;
          const main=document.querySelector('[data-main-preview]');
          ${key === 'pagination-stale' ? 'main.dataset.pageNumber=index+1;return;' : ''}
          setTimeout(()=>{const img=document.getElementById('mainImage');img.onload=()=>{main.dataset.pageNumber=index+1};img.src=index===2?'/tall.png':${key === 'pagination-fail' ? "'/failed.png'" : "'/page-2.png'"};},750);
        }</script>`);
    }
    if (key.startsWith('visible')) return res.end(`<web-widget contextdata='${JSON.stringify({ metaShareCode: key, metaShareInfo: { shareCode: key, fileIds: ['file1'] }, metaFileDetail: { id: 'file1', ...(key === 'visible-single' ? { pageCount: 1, preview_info: { width: 600, height: 800 } } : {}) } })}'></web-widget><main id="dam-preview-container"><div fileId="file1"><img src="${base}/page-1.png"></div></main><img src="${base}/ui.png">`);
    return res.end(cases[key] ? html(cases[key]()) : '<img src="/ui.png">');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await closeDefaultPool(); await new Promise(resolve => server.close(resolve)); });
const extract = (key, options = {}) => extractGaoding(`${base}/dam/share/${key}`, { staticOnly: true, log: false, ...options });

test('A: clean share prose, preserve query and meaningful fragment', () => {
  assert.equal(g.normalizeGaodingInputUrl('https://www.gaoding.com/dam/share/abc?mode=preview#我分享了「某某设计」，点击链接查看吧～'), 'https://www.gaoding.com/dam/share/abc?mode=preview');
  assert.equal(g.normalizeGaodingInputUrl('https://www.gaoding.com/dam/share/abc?mode=preview#page=2'), 'https://www.gaoding.com/dam/share/abc?mode=preview#page=2');
  assert.equal(g.classifyLink('https://www.gaoding.com/dam/share/abc?id=42'), 'share');
});
test('B/E: confirmed one page wins over visible/recommended UI', async () => {
  const r = await extract('structured'); assert.equal(r.source, 'html-preview'); assert.equal(r.pageCount, 1); assert.equal(r.isComplete, true);
  assert.equal(r.imageUrl, `${base}/page-1.png`); assert.equal(r.pages[0].shareId, 'structured'); assert.match(r.pages[0].evidencePath, /pages\[0\].preview_info/);
});
test('C: static cover continues to design JSON; pages/layouts do not duplicate', async () => {
  const r = await extract('cover'); assert.equal(r.source, 'design-json-pages'); assert.equal(r.pageCount, 3); assert.equal(r.isComplete, true);
  assert.deepEqual(r.pages.map(p => p.pageId), ['p1', 'p2', 'p3']); assert.equal(r.imageUrls.includes(`${base}/cover.png`), false);
});

test('B/C: five-page JSON sorts explicit order, merges layouts and ignores size variants', async () => {
  const r = await extract('five'); assert.equal(r.pageCount, 5); assert.equal(r.expectedPageCount, 5); assert.equal(r.completenessStatus, 'complete');
  assert.deepEqual(r.pages.map(p => p.pageNumber), [1, 2, 3, 4, 5]); assert.deepEqual(r.missingPages, []);
  assert.ok(r.metadata.diagnostics.some(d => d.stage === 'design_json' && d.designJsonStatus === 'parsed' && d.jsonParsed && d.status === 200));
});

test('JSON address exists but HTML response is a parse failure, cover remains unknown', async () => {
  const r = await extract('brokenJson'); assert.equal(r.pageCount, 1); assert.equal(r.completenessStatus, 'unknown');
  assert.ok(r.metadata.diagnostics.some(d => d.designJsonStatus === 'parse_failed'));
});

test('transient design JSON failure retries once and completes the page set', async () => {
  const r = await extract('retryJson'); assert.equal(retryRequests, 2); assert.equal(r.pageCount, 2); assert.equal(r.isComplete, true);
  assert.ok(r.metadata.diagnostics.some(d => d.designJsonStatus === 'retrying' && d.status === 503));
});

test('confirmed DAM gdimage bundle preserves main then extensions, including different aspect ratios', async () => {
  const state = g.createExtractionState(`${base}/dam/share/bundle`, { log: false });
  g.collectDesignData({ id: 'bundle-id', format: 'gdimage', preview_info: page(1).preview_info,
    source_preview_info: { url: null }, design_info: {}, extends_previews: [page(2).preview_info, { url: `${base}/tall.png`, width: 600, height: 1000 }] }, state, { trusted: true, damAsset: true, source: 'share-api-preview', path: 'share_api.asset[bundle-id]' });
  const r = await g.finalizeState(state, 'share'); assert.equal(r.pageCount, 3); assert.equal(r.expectedPageCount, 3); assert.equal(r.isComplete, true);
  assert.deepEqual(r.imageUrls, [`${base}/page-1.png`, `${base}/page-2.png`, `${base}/tall.png`]); assert.equal(r.pages[2].height, 1000);
  assert.match(r.metadata.pageCountEvidence[0].source, /dam_multi_preview/);
});

test('A/E: empty DAM extensions never certify a single artboard or invent its number', async () => {
  const state = g.createExtractionState(`${base}/dam/share/empty-extensions`, { log: false });
  g.collectDesignData({ id: 'file1', format: 'gdimage', preview_info: page(1).preview_info,
    source_preview_info: { url: null }, design_info: {}, extends_previews: [] }, state, { trusted: true, damAsset: true });
  const r = await g.finalizeState(state, 'share');
  assert.equal(r.pageCount, 1); assert.equal(r.expectedPageCount, null); assert.equal(r.pageCountConfidence, 'unknown');
  assert.equal(r.completenessStatus, 'unknown'); assert.equal(r.isComplete, null); assert.equal(r.pages[0].pageNumber, null);
  assert.equal(g.shouldAttemptDynamicAfterStatic(r), true); assert.deepEqual(r.metadata.pageCountEvidence, []);
});

test('current live-response fixture links one share file to its three distinct DAM previews', async () => {
  const fixture = require('./fixtures/gaoding-dam-artboards.json');
  const state = g.createExtractionState(`https://www.gaoding.com/dam/share/${fixture.share.share_config_info.share_code}`, { log: false });
  state.designIds.add(fixture.share.file_ids[0]);
  const asset = { ...fixture.asset, preview_info: page(1).preview_info, extends_previews: [page(2).preview_info, page(3).preview_info] };
  g.collectDesignData(asset, state, { trusted: true, damAsset: true, path: 'share_api.asset' });
  const r = await g.finalizeState(state, 'share');
  assert.equal(state.designIds.size, 1); assert.equal(r.pageCount, 3); assert.equal(r.isComplete, true);
  assert.deepEqual(r.pages.map(p => p.designId), Array(3).fill(fixture.asset.id)); assert.deepEqual(r.pages.map(p => p.pageNumber), [1, 2, 3]);
});

test('manifest refresh revalidates share access, requests only the discovered public asset, and runs once', async () => {
  const fixture = require('./fixtures/gaoding-dam-artboards.json'), original = axios.get;
  const state = g.createExtractionState(`https://www.gaoding.com/dam/share/${fixture.share.share_config_info.share_code}`, { log: false });
  const targets = []; let assetReads = 0;
  axios.get = async (url, options) => {
    if (url.includes('/api/dam/shares/')) { targets.push(url); return { status: 200, data: fixture.share }; }
    if (url.includes('/api/dam/asset/')) {
      targets.push(url); assetReads++;
      if (assetReads === 2) assert.equal(options.headers['Cache-Control'], 'no-cache');
      return { status: 200, data: { ...fixture.asset, preview_info: page(1).preview_info,
        extends_previews: assetReads === 1 ? [] : [page(2).preview_info, page(3).preview_info] } };
    }
    return original(url, options);
  };
  try {
    await g.fetchPublicShareData(state);
    assert.equal((await g.finalizeState(state, 'share')).completenessStatus, 'unknown');
    await g.fetchPublicShareData(state, true);
    const r = await g.finalizeState(state, 'share'); assert.equal(r.pageCount, 3); assert.equal(r.isComplete, true);
    await g.fetchPublicShareData(state, true); assert.equal(assetReads, 2); assert.equal(targets.length, 4);
    assert.ok(targets.every(u => /\/api\/dam\/(shares\/[^/]+\/resource|asset\/[^/]+)$/.test(u)));
  } finally { axios.get = original; }
});

test('empty asset never short-circuits dynamic completion, even if browser acquisition fails', async () => {
  const original = axios.get;
  const code = 'initial-cover-only', url = `https://www.gaoding.com/dam/share/${code}`;
  let assetReads = 0, browserAttempts = 0;
  axios.get = async (target, options) => {
    if (target === url) return { status: 200, data: '' };
    if (target.includes('/api/dam/shares/')) return { status: 200, data: { share_config_info: { share_code: code, is_open: true }, file_ids: ['file1'] } };
    if (target.includes('/api/dam/asset/')) return { status: 200, data: { id: 'file1', format: 'gdimage', preview_info: page(1).preview_info,
      extends_previews: ++assetReads === 1 ? [] : [page(2).preview_info, page(3).preview_info], design_info: {} } };
    return original(target, options);
  };
  try {
    const r = await extractGaoding(url, { log: false, browserPool: { acquire: async () => { browserAttempts++; throw new Error('fixture browser unavailable'); } } });
    assert.equal(browserAttempts, 1); assert.equal(assetReads, 2); assert.equal(r.pageCount, 3); assert.equal(r.isComplete, true);
    assert.ok(r.metadata.diagnostics.some(d => d.stage === 'selection' && d.pageCount === 1 && d.expectedPageCount === null));
    assert.ok(r.metadata.diagnostics.some(d => d.stage === 'manifest_refresh'));
  } finally { axios.get = original; }
});

test('manifest refresh with still empty previews preserves unknown; revoked sharing clears resources', async () => {
  const original = axios.get;
  const state = g.createExtractionState('https://www.gaoding.com/dam/share/still-empty', { log: false });
  let closed = false, assetReads = 0;
  axios.get = async (url, options) => {
    if (url.includes('/api/dam/shares/')) return { status: 200, data: { share_config_info: { share_code: 'still-empty', is_open: !closed }, file_ids: ['file1'] } };
    if (url.includes('/api/dam/asset/')) { assetReads++; return { status: 200, data: { id: 'file1', format: 'gdimage', preview_info: page(1).preview_info, extends_previews: [], design_info: {} } }; }
    return original(url, options);
  };
  try {
    await g.fetchPublicShareData(state); await g.fetchPublicShareData(state, true);
    const r = await g.finalizeState(state, 'share'); assert.equal(r.pageCount, 1); assert.equal(r.completenessStatus, 'unknown'); assert.equal(assetReads, 2);
    const revoked = g.createExtractionState(state.url, { log: false });
    await g.fetchPublicShareData(revoked); closed = true; await g.fetchPublicShareData(revoked, true);
    assert.equal((await g.finalizeState(revoked, 'share')).success, false); assert.equal(assetReads, 3);
  } finally { axios.get = original; }
});

test('failed DAM bundle page retains other pages and identifies the missing page', async () => {
  const state = g.createExtractionState(`${base}/dam/share/bundle-failed`, { log: false });
  g.collectDesignData({ id: 'bundle-id', format: 'gdimage', preview_info: page(1).preview_info,
    extends_previews: [{ url: `${base}/failed.png` }, page(3).preview_info] }, state, { trusted: true, damAsset: true });
  const r = await g.finalizeState(state, 'share'); assert.equal(r.pageCount, 2); assert.equal(r.expectedPageCount, 3); assert.equal(r.completenessStatus, 'partial'); assert.deepEqual(r.missingPages, [2]);
});

test('different identified pages sharing one resource survive extraction and normalization', async () => {
  const state = g.createExtractionState(`${base}/dam/share/identical`, { log: false });
  g.collectDesignData({ id: 'identical-id', pages: [page(1), page(2, { preview_info: page(1).preview_info })] }, state, { trusted: true });
  const r = normalizeExtractPayload(await g.finalizeState(state, 'share'));
  assert.equal(r.pageCount, 2); assert.equal(r.pages.length, 2); assert.equal(r.imageUrls.length, 2); assert.equal(r.isComplete, true);
});
test('E: layout single-page document remains complete', async () => {
  const r = await extract('single'); assert.equal(r.pageCount, 1); assert.equal(r.isMultiPage, false); assert.equal(r.expectedPageCount, 1); assert.equal(r.isComplete, true);
  assert.equal(g.shouldAttemptDynamicAfterStatic(r), false);
});
test('F: reliable total three, only cover/page one -> partial and missing', async () => {
  const r = await extract('partial'); assert.equal(r.completenessStatus, 'partial'); assert.equal(r.isComplete, false); assert.deepEqual(r.missingPages, [2, 3]);
  assert.equal(g.shouldAttemptDynamicAfterStatic(r), true);
});
test('G: local elements never impersonate full pages', async () => {
  const r = await extract('mixed'); assert.equal(r.pageCount, 1); assert.equal(r.expectedPageCount, 2); assert.equal(r.isComplete, false);
  assert.deepEqual(r.missingPages, [2]); assert.equal(r.imageUrls.some(u => /element|ui/.test(u)), false);
});
test('same-page extends versions do not multiply page count', async () => {
  const r = await extract('variants'); assert.equal(r.pageCount, 1); assert.equal(r.imageUrl, `${base}/page-1.png`); assert.equal(r.isComplete, true);
});
test('unknown count must stay unknown despite a valid target preview', async () => {
  const r = await extract('unknown'); assert.equal(r.pageCount, 1); assert.equal(r.expectedPageCount, null); assert.equal(r.isComplete, null); assert.equal(r.completenessStatus, 'unknown');
});
test('unscoped visible UI cannot be reported as a design', async () => {
  const r = await extract('ui-only'); assert.equal(r.success, false); assert.equal(r.imageUrl, null); assert.equal(r.pageCount, 0); assert.equal(r.status, 'preview_only');
});
test('SSR contextdata proves share to file association; unrelated file rejected', async () => {
  const state = g.createExtractionState(`${base}/dam/share/mine`, { log: false });
  const data = { metaShareCode: 'mine', metaShareInfo: { shareCode: 'mine', fileIds: ['target'] }, metaFileDetail: { id: 'target', pages: [page(1)] }, other: { fileId: 'other', pages: [page(9)] } };
  g.collectHtmlData(`<web-widget contextdata='${JSON.stringify(data)}'></web-widget>`, state, 'html-preview');
  const r = await g.finalizeState(state, 'share'); assert.equal(r.pageCount, 1); assert.equal(r.pages[0].designId, 'target'); assert.equal(r.isComplete, true);
});
test('signed and extensionless trusted URLs preserve original parameters', async () => {
  const state = g.createExtractionState(`${base}/dam/share/signed`, { log: false });
  const url = `${base}/signed-resource?auth_key=keep&x-oss-process=image/resize,w_600`;
  g.collectDesignData({ pages: [{ preview_info: { url } }] }, state, { trusted: true });
  const r = await g.finalizeState(state, 'share'); assert.equal(r.imageUrl, url); assert.equal(r.isComplete, true);
});
test('modern share API proves code -> file -> preview and bypasses unscoped gateway', async () => {
  const original = axios.get;
  const url = 'https://www.gaoding.com/dam/share/api-fixture';
  const requested = [];
  axios.get = async (target, options) => {
    requested.push(target);
    if (target === url) return { status: 200, data: '<img src="https://cdn.dancf.com/fe-assets/ui.png">' };
    if (target.includes('/api/dam/shares/')) { assert.equal(options.headers['x-channel-id'], '32'); return { status: 200, data: { share_config_info: { share_code: 'api-fixture', is_open: true }, file_ids: ['file-api'] } }; }
    if (target.includes('/api/dam/asset/')) return { status: 200, data: { id: 'file-api', pageCount: 1, preview_info: { url: `${base}/page-1.png` } } };
    return original(target, options);
  };
  try {
    const r = await require('./imageExtractor').extractImage(url, 'Gaoding', { staticOnly: true, log: false });
    assert.equal(r.source, 'share-api-preview'); assert.equal(r.isComplete, true); assert.equal(r.pages[0].designId, 'file-api');
    assert.equal(requested.some(u => /tsgpt/.test(u)), false);
  } finally { axios.get = original; }
});
test('password-protected public share does not fetch asset data', async () => {
  const original = axios.get;
  const requested = [];
  axios.get = async url => { requested.push(url); return url.includes('/api/') ? { status: 200, data: { share_config_info: { share_code: 'locked', is_open: true, is_open_password: true }, file_ids: ['private'] } } : { status: 200, data: '' }; };
  try {
    const r = await extractGaoding('https://www.gaoding.com/dam/share/locked', { staticOnly: true, log: false });
    assert.equal(r.success, false); assert.equal(requested.some(u => /asset/.test(u)), false);
    assert.ok(r.metadata.diagnostics.some(d => d.reason === 'share_password_required'));
  } finally { axios.get = original; }
});
test('long poster with structured provenance is not rejected by size thresholds', async () => {
  const long = await sharp({ create: { width: 100, height: 1500, channels: 3, background: 'blue' } }).png().toBuffer();
  const original = axios.get;
  axios.get = async (url, options) => url === 'https://gdesign.dancf.com/long.png' ? { status: 200, headers: { 'content-type': 'image/png' }, data: long } : original(url, options);
  try {
    const state = g.createExtractionState(`${base}/dam/share/long`, { log: false });
    g.collectDesignData({ pages: [{ preview_info: { url: 'https://gdesign.dancf.com/long.png', width: 100, height: 1500 } }] }, state, { trusted: true });
    assert.equal((await g.finalizeState(state, 'share')).isComplete, true);
  } finally { axios.get = original; }
});
test('D: actual browser delayed network JSON wins; unrelated API ignored', { timeout: 20000 }, async () => {
  const r = await extract('network', { staticOnly: false }); assert.equal(r.source, 'dynamic-network-preview'); assert.equal(r.isComplete, true); assert.equal(r.pageCount, 2); assert.equal(r.expectedPageCount, 2);
});

test('B/D: single DAM cover without JSON reference continues to three-page network manifest', { timeout: 20000 }, async () => {
  const state = g.createExtractionState(`${base}/dam/share/network-three`, { log: false });
  g.collectDesignData({ id: 'file1', format: 'gdimage', preview_info: page(1).preview_info, extends_previews: [], design_info: {} }, state, { trusted: true, damAsset: true });
  assert.equal((await g.finalizeState(state, 'share')).isComplete, null);
  const r = await g.dynamicScraping(state.url, 'share', {}, state);
  assert.equal(r.pageCount, 3); assert.equal(r.expectedPageCount, 3); assert.equal(r.isComplete, true);
  assert.equal(r.source, 'dynamic-network-preview'); assert.equal(state.designIds.size, 1); assert.equal(state.designRefs.size, 0);
});

test('B/F: single DAM asset reaches three artboards through verified navigation', { timeout: 25000 }, async () => {
  const state = g.createExtractionState(`${base}/dam/share/pagination`, { log: false });
  g.collectDesignData({ id: 'file1', format: 'gdimage', preview_info: page(1).preview_info, extends_previews: [], design_info: {} }, state, { trusted: true, damAsset: true });
  const r = await g.dynamicScraping(state.url, 'share', {}, state);
  assert.equal(r.pageCount, 3); assert.equal(r.expectedPageCount, 3); assert.equal(r.isComplete, true); assert.equal(state.designIds.size, 1);
  assert.deepEqual(r.pages.map(p => p.pageNumber), [1, 2, 3]); assert.equal(r.metadata.diagnostics.filter(d => d.stage === 'page_activation' && d.activationSucceeded).length, 3);
});

test('D: real DAM navigation activates delayed pages and captures each main image in order', { timeout: 25000 }, async () => {
  const r = await extract('pagination', { staticOnly: false });
  assert.equal(r.pageCount, 3); assert.equal(r.expectedPageCount, 3); assert.equal(r.completenessStatus, 'complete');
  assert.deepEqual(r.imageUrls, [`${base}/page-1.png`, `${base}/page-2.png`, `${base}/tall.png`]);
  const d = r.metadata.diagnostics.find(d => d.stage === 'dynamic-pagination');
  assert.equal(d.pageNavigationItems, 3); assert.equal(d.successfulPageSnapshots, 3);
});

test('D/F: active marker alone never assigns an unchanged previous image to another page', { timeout: 25000 }, async () => {
  const r = await extract('pagination-stale', { staticOnly: false });
  assert.equal(r.pageCount, 1); assert.equal(r.expectedPageCount, 2); assert.equal(r.completenessStatus, 'partial'); assert.deepEqual(r.missingPages, [2]);
  assert.equal(r.metadata.diagnostics.find(d => d.stage === 'dynamic-pagination').successfulPageSnapshots, 1);
});

test('F: failed activated image is retried with a limit and stays missing', { timeout: 25000 }, async () => {
  const r = await extract('pagination-fail', { staticOnly: false });
  assert.equal(r.pageCount, 1); assert.equal(r.completenessStatus, 'partial'); assert.deepEqual(r.missingPages, [2]);
});
test('dynamic-visible retained with target viewer/file evidence, completeness unknown', { timeout: 20000 }, async () => {
  const r = await extract('visible', { staticOnly: false }); assert.equal(r.source, 'dynamic-visible'); assert.equal(r.pageCount, 1); assert.equal(r.isComplete, null); assert.equal(r.completenessStatus, 'unknown'); assert.equal(r.pages[0].designId, 'file1');
});
test('dynamic-visible can complete a verified single-page target with matching viewer dimensions', { timeout: 20000 }, async () => {
  const r = await extract('visible-single', { staticOnly: false }); assert.equal(r.source, 'dynamic-visible'); assert.equal(r.pageCount, 1); assert.equal(r.isComplete, true); assert.equal(r.expectedPageCount, 1);
});
test('layouts can supply previews for equivalent pages without adding duplicate pages', async () => {
  const state = g.createExtractionState(`${base}/dam/share/peer`, { log: false });
  g.collectDesignData({ pages: [{ id: 'p1', elements: [] }], layouts: [page(1)] }, state, { trusted: true });
  const r = await g.finalizeState(state, 'share'); assert.equal(r.pageCount, 1); assert.equal(r.isComplete, true); assert.match(r.pages[0].evidencePath, /layouts/);
});
test('H: extraction/parse/history HTTP roundtrip isolates DB and keeps main/thumbnail distinct', async () => {
  const mysql = require('mysql2/promise'); const extractor = require('./imageExtractor'); const browserService = require('./services/browser-pool'); const rows = [];
  const originalPool = mysql.createPool, originalExtract = extractor.extractImage;
  const originalInit = browserService.initDefaultPool;
  let apiServer;
  try {
    mysql.createPool = () => ({ getConnection: async () => ({ release() {} }), query: async (sql, values) => {
      if (sql.startsWith('INSERT')) { rows.push({ id: 1, original_url: values[0], platform: values[1], thumbnail_url: values[4], image_urls_json: values[6], pages_json: values[7], page_count: values[8], is_multi_page: values[9], extraction_metadata_json: values[10] }); return [{ insertId: 1 }]; }
      if (sql.startsWith('SELECT')) return [rows]; throw new Error('Unexpected DB access');
    } });
    browserService.initDefaultPool = async () => ({ getStatus: () => ({ available: 0 }) });
    const r = await extract('five'); extractor.extractImage = async () => r;
    const { app } = require('./index');
    apiServer = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const root = `http://127.0.0.1:${apiServer.address().port}/api`, headers = { 'X-Client-Id': 'gaoding-fixture-client' };
    const response = (await axios.post(`${root}/extract-image`, { url: 'https://www.gaoding.com/dam/share/cover', platform: 'Gaoding' })).data;
    const saved = (await axios.post(`${root}/parse`, { ...response, url: 'https://www.gaoding.com/dam/share/cover', thumbnailUrl: `${base}/small.png` }, { headers })).data.data;
    const history = (await axios.get(`${root}/history`, { headers })).data.data[0];
    assert.equal(saved.imageUrl, r.imageUrl); assert.equal(saved.thumbnailUrl, `${base}/small.png`); assert.deepEqual(history.imageUrls, r.imageUrls); assert.deepEqual(history.pages, r.pages); assert.equal(history.isComplete, true); assert.equal(history.source, 'design-json-pages');
    fs.writeFileSync('test-artifacts/gaoding-api-fixture.json', JSON.stringify({ response, saved, history }, null, 2));
    const duplicateState = g.createExtractionState('https://www.gaoding.com/dam/share/duplicate-boards', { log: false });
    g.collectDesignData({ id: 'shared-artwork', pages: [1, 2, 3].map(n => page(n, { id: `board-${n}`, preview_info: page(1).preview_info })) }, duplicateState, { trusted: true });
    const duplicates = await g.finalizeState(duplicateState, 'share');
    const savedDuplicates = (await axios.post(`${root}/parse`, { ...duplicates, url: 'https://www.gaoding.com/dam/share/duplicate-boards' }, { headers })).data.data;
    const duplicateHistory = (await axios.get(`${root}/history`, { headers })).data.data[1];
    for (const record of [savedDuplicates, duplicateHistory]) {
      assert.equal(record.pageCount, 3); assert.equal(record.imageUrls.length, 3); assert.equal(record.pages.length, 3);
      assert.deepEqual(record.pages.map(p => p.pageId), ['board-1', 'board-2', 'board-3']);
    }
  } finally { mysql.createPool = originalPool; extractor.extractImage = originalExtract; browserService.initDefaultPool = originalInit; if (apiServer) await new Promise(resolve => apiServer.close(resolve)); }
});
test('I: other platform arrays and old histories stay compatible', () => {
  for (const platform of ['818ps', 'Chuangkit', 'Gaoding', 'Canva']) {
    const r = normalizeExtractPayload({ platform, imageUrls: [`${base}/a.png`, `${base}/b.png`], thumbnailUrl: `${base}/small.png` });
    assert.equal(r.pageCount, 2); assert.equal(r.imageUrl, `${base}/a.png`);
    assert.deepEqual(restoreRecord({ image_urls_json: JSON.stringify(r.imageUrls), pages_json: JSON.stringify(r.pages), extraction_metadata_json: JSON.stringify(extractionDetails(r)), page_count: 2 }).imageUrls, r.imageUrls);
  }
});

test('H: Chuangkit extractor still returns a validated static page set', async () => {
  const originalGet = axios.get, originalHead = axios.head;
  const url = 'https://www.chuangkit.com/sharedesign?fixture=gaoding-regression';
  const resources = [`${base}/design-page-1.png`, `${base}/design-page-2.png`];
  axios.get = async (target, options) => target === url ? { status: 200, data: `<div class="share-preview">${resources.map(src => `<img src="${src}">`).join('')}</div>` } : originalGet(target, options);
  axios.head = async (target, options) => resources.includes(target) ? { status: 200, headers: { 'content-type': 'image/png' } } : originalHead(target, options);
  try {
    const r = normalizeExtractPayload(await require('./imageExtractor').extractChuangkitImage(url));
    assert.equal(r.source, 'static-scan'); assert.equal(r.pageCount, 2); assert.deepEqual(r.imageUrls, resources);
  } finally { axios.get = originalGet; axios.head = originalHead; }
});
