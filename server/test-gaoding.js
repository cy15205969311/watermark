const assert = require("assert");
const { __internals } = require("./extractors/gaoding");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("normalizeGaodingInputUrl strips share fragments", () => {
  const normalized = __internals.normalizeGaodingInputUrl(
    "https://www.gaoding.com/dam/share/RgQONAoAy0AkCoQVR0PHE#我分享了「[放假通知爆款热点大字...]」"
  );

  assert.strictEqual(
    normalized,
    "https://www.gaoding.com/dam/share/RgQONAoAy0AkCoQVR0PHE"
  );
});

test("extractPreviewBundleFromHtml prefers source preview info", () => {
  const htmlContent = `
    <script>
    {&quot;preview_info&quot;:{&quot;url&quot;:&quot;https://gdesign-dam-hw.dancf.com/work/preview/page-1-watermark.jpg?auth_key=a&quot;},
     &quot;source_preview_info&quot;:{&quot;url&quot;:&quot;https://gdesign-dam-hw.dancf.com/work/export/page-1.jpg?auth_key=z&quot;},
     &quot;extends_previews&quot;:[
        {&quot;url&quot;:&quot;https://gdesign-dam-hw.dancf.com/work/preview/page-2.jpg?auth_key=b&quot;}
     ]}
    </script>
  `;

  const bundle = __internals.extractPreviewBundleFromHtml(htmlContent);

  assert.deepStrictEqual(
    bundle.map(([url]) => url),
    [
      "https://gdesign-dam-hw.dancf.com/work/export/page-1.jpg?auth_key=z",
      "https://gdesign-dam-hw.dancf.com/work/preview/page-2.jpg?auth_key=b",
    ]
  );
});

test("normalizeCandidateUrl strips embedded JSON suffix and x-oss-process", () => {
  const normalized = __internals.normalizeCandidateUrl(
    'https://gdesign-dam-hw.dancf.com/work/export/final-artboard.jpg?auth_key=test123&x-oss-process=image/resize","width":1242,"height":1656'
  );

  assert.strictEqual(
    normalized,
    "https://gdesign-dam-hw.dancf.com/work/export/final-artboard.jpg?auth_key=test123"
  );
});

test("isGaodingDesignCandidate blocks gaoding app assets", () => {
  assert.strictEqual(
    __internals.isGaodingDesignCandidate(
      "https://gaoding-market.dancf.com/market-operations/market/side/abc/1769158051967.png"
    ),
    true
  );

  assert.strictEqual(
    __internals.isGaodingDesignCandidate(
      "https://cdn.dancf.com/apps/gaoding/assets/logo.png"
    ),
    false
  );
});

test("selectBestMultiPageGroup prefers page-like JSON paths", () => {
  const pageOne = "https://gaoding-market.dancf.com/work/pages/page1.png";
  const pageTwo = "https://gaoding-market.dancf.com/work/pages/page2.png";
  const banner =
    "https://gaoding-market.dancf.com/market-operations/market/side/banner.png";

  const entries = __internals.extractCandidatesFromData(
    {
      work: {
        pages: [{ image: pageOne }, { image: pageTwo }],
        banner: {
          image: banner,
        },
      },
    },
    "root"
  );

  const bestGroup = __internals.selectBestMultiPageGroup(entries);

  assert.deepStrictEqual(
    bestGroup.map(([url]) => url),
    [pageOne, pageTwo]
  );
});

console.log("Gaoding helper tests passed.");
