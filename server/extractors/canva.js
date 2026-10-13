/**
 * Canva 专用图片提取器
 * 
 * 特点：
 * 1. 针对 Canva 平台优化
 * 2. 支持设计页面
 * 3. 自动处理懒加载
 * 
 * @module canvaExtractor
 */

const puppeteer = require('puppeteer');
const { smartScroll } = require('../utils/autoScroll');
const { withPuppeteerExecutablePath } = require('../utils/puppeteer-launch');

/**
 * Canva 图片过滤规则
 */
const FILTER_RULES = {
  requiredDomains: [
    'cdn.canva.com',
    'media.canva.com'
  ],

  excludeKeywords: [
    'avatar',
    'icon',
    'logo',
    'thumbnail',
    'ui'
  ],

  minSize: 50 * 1024, // 50KB
  maxResults: 5
};

/**
 * 提取 Canva 图片
 * 
 * @param {string} url - Canva 页面 URL
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 提取结果
 */
async function extractCanva(url, options = {}) {
  console.log('🚀 开始提取 Canva 图片:', url);

  const config = {
    headless: options.headless !== false,
    timeout: options.timeout || 15000,
    maxResults: options.maxResults || FILTER_RULES.maxResults
  };

  let browser = null;

  try {
    browser = await puppeteer.launch(
      withPuppeteerExecutablePath({
        headless: config.headless ? 'new' : false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      })
    );

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    );

    console.log('  📄 加载页面...');
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: config.timeout
    });

    await page.waitForTimeout(2000);
    await smartScroll(page);

    // 提取图片
    const imageUrls = await page.evaluate(() => {
      const urls = new Set();

      document.querySelectorAll('img').forEach(img => {
        if (img.src) urls.add(img.src);
        if (img.dataset.src) urls.add(img.dataset.src);
        if (img.dataset.original) urls.add(img.dataset.original);
      });

      // CSS background-image
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;

        if (bgImage && bgImage !== 'none') {
          const match = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
          if (match && match[1]) {
            urls.add(match[1]);
          }
        }
      });

      return Array.from(urls);
    });

    console.log(`  📊 检测到图片数量: ${imageUrls.length}`);

    // 过滤
    const filtered = imageUrls.filter(url => {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        const pathname = urlObj.pathname.toLowerCase();

        const hasDomain = FILTER_RULES.requiredDomains.some(
          domain => hostname.includes(domain)
        );

        const hasExcluded = FILTER_RULES.excludeKeywords.some(
          keyword => pathname.includes(keyword)
        );

        return hasDomain && !hasExcluded && !pathname.endsWith('.svg');
      } catch {
        return false;
      }
    });

    console.log(`  📊 过滤后图片数量: ${filtered.length}`);

    // 去重
    const unique = [...new Set(filtered)];

    // 限制数量
    const results = unique.slice(0, config.maxResults);

    console.log(`  📊 最终返回图片数量: ${results.length}`);

    return {
      success: true,
      platform: 'canva',
      images: results,
      metadata: {
        totalFound: imageUrls.length,
        afterFilter: filtered.length,
        results: results.length
      }
    };

  } catch (error) {
    console.error('❌ 提取失败:', error.message);

    return {
      success: false,
      platform: 'canva',
      message: 'image_extract_failed',
      error: error.message,
      images: []
    };

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  extractCanva,
  FILTER_RULES
};
