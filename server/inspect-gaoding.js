// Read-only live diagnosis; artifacts redact credentials and keep business evidence.
const fs = require('fs');
const axios = require('axios');
const { getDefaultPool, closeDefaultPool } = require('./services/browser-pool');
const { redact } = require('./extractors/818ps-pages');
const sharp = require('sharp');
async function main() {
  const url = process.argv[2] || 'https://www.gaoding.com/dam/share/ZKZqaGEo5aMBudoBxbzCJ';
  const staticResponse = await axios.get(url, { timeout: 15000, validateStatus: () => true });
  fs.writeFileSync('test-artifacts/gaoding-static.html', redact(String(staticResponse.data)));
  console.log('static', staticResponse.status, staticResponse.request?.res?.responseUrl);
  const pool = getDefaultPool(); const browser = await pool.acquire(); const page = await browser.newPage();
  const evidence = []; const pending = [];
  page.on('response', r => { if (['xhr', 'fetch', 'document'].includes(r.request().resourceType())) pending.push((async()=> {
    const body = await r.text().catch(()=> '');
    evidence.push({ url: redact(r.url()), status: r.status(), type: r.headers()['content-type'], body: redact(body).slice(0, 150000) });
  })()); });
  try {
    await page.setViewport({ width: 1600, height: 1200 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForTimeout(4000); await Promise.allSettled(pending);
    const state = await page.evaluate(()=> ({ url: location.href, text: document.body.innerText, images: [...document.images].map(i=> ({ url: i.currentSrc, width:i.naturalWidth,height:i.naturalHeight, html:i.outerHTML, parent:i.parentElement.outerHTML.slice(0,2000) })) }));
    fs.writeFileSync('test-artifacts/gaoding-network.json',JSON.stringify(evidence,null,2));
    fs.writeFileSync('test-artifacts/gaoding-dom.json',redact(JSON.stringify(state,null,2)));
    fs.writeFileSync('test-artifacts/gaoding-rendered.html',redact(await page.content()));
    await page.screenshot({path:'test-artifacts/gaoding-page.png',fullPage:true});
    console.log(redact(JSON.stringify(state,null,2)));
    const before = JSON.parse(fs.readFileSync('test-artifacts/gaoding-before.json'));
    const asset = await axios.get(before.imageUrl,{responseType:'arraybuffer',timeout:15000});
    fs.writeFileSync('test-artifacts/gaoding-before-asset.png',asset.data);
    console.log('before asset',asset.headers['content-type'],await sharp(asset.data).metadata());
  } finally { await page.close(); pool.release(browser); await closeDefaultPool(); }
}
main().catch(e=>{ console.error(e.message); process.exitCode=1; });
