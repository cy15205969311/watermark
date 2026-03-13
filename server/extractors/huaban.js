/**
 * 花瓣网（Huaban）专用图片提取器
 * 
 * 特点：
 * 1. 针对花瓣网平台优化
 * 2. 支持画板和采集页面
 * 3. 自动处理懒加载
 * 
 * @module huabanExtractor
 */

const puppeteer = require('puppeteer');
const axios = require('axios');
const { smartScroll } = require('../utils/autoScroll');

/**
 * 花瓣网图片过滤规则
 */
const FILTER_RULES = {
  requiredDomains: [
    'hbimg.huabanimg.com',
    'img.huabanimg.com'
  ],

  excludeKeywords: [
    'avatar',
    'icon',
    'logo',
    'thumbnail'
  ],

  minSize: 30 * 1024, // 30KB
  maxResults: 5
};

/**
 * 提取花瓣网图片
 * 
 * @param {string} url - 花瓣网页面 URL
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 提取结果
 */
async function extractHuaban(url, options = {}) {
  console.log('🚀 开始提取花瓣网图片:', url);

  const config = {
    headless: options.headless !== false,
    timeout: options.timeout || 15000,
    maxResults: options.maxResults || FILTER_RULES.maxResults
  };

  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: config.headless ? 'new' : false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

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
      platform: 'huaban',
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
      platform: 'huaban',
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
  extractHuaban,
  FILTER_RULES
};
