/**
 * 图片提取服务 - 通用版
 * 
 * 核心功能：
 * 1. 提取页面所有真实图片（不只是主图）
 * 2. 支持懒加载图片
 * 3. 自动滚动触发懒加载
 * 4. 过滤无效图片
 * 5. 返回所有有效图片数组
 * 
 * @module imageExtractor
 */

const puppeteer = require('puppeteer');
const { autoScroll } = require('../utils/autoScroll');
const { withPuppeteerExecutablePath } = require('../utils/puppeteer-launch');

/**
 * 图片过滤规则
 */
const IMAGE_FILTER_RULES = {
  // 允许的域名
  allowedDomains: [
    'img.tuguaishou.com',
    'img.818ps.com',
    'hbimg.huabanimg.com',
    'cdn.canva.com',
    'img.chuangkit.com',
    'static.chuangkit.com'
  ],

  // 排除的内容类型
  excludeTypes: [
    'base64',
    'svg',
    'placeholder',
    'data:image'
  ],

  // 排除的关键词
  excludeKeywords: [
    'placeholder',
    'loading',
    'spinner',
    'icon',
    'avatar',
    'logo',
    'badge',
    'button',
    'thumbnail',
    'thumb'
  ],

  // 超时设置
  timeout: 15000
};

/**
 * 从页面提取所有图片 URL
 * 同时读取 src, data-src, data-original
 * 
 * @param {Page} page - Puppeteer 页面对象
 * @returns {Promise<string[]>} 图片 URL 数组
 */
async function extractAllImageUrls(page) {
  console.log('  🔍 提取页面所有图片 URL...');

  const imageUrls = await page.evaluate(() => {
    const urls = new Set();

    // 1. 提取 <img> 标签
    document.querySelectorAll('img').forEach(img => {
      // src 属性
      if (img.src && img.src.startsWith('http')) {
        urls.add(img.src);
      }

      // data-src 属性（懒加载）
      if (img.dataset.src && img.dataset.src.startsWith('http')) {
        urls.add(img.dataset.src);
      }

      // data-original 属性（懒加载）
      if (img.dataset.original && img.dataset.original.startsWith('http')) {
        urls.add(img.dataset.original);
      }

      // data-lazy 属性
      if (img.dataset.lazy && img.dataset.lazy.startsWith('http')) {
        urls.add(img.dataset.lazy);
      }

      // data-image 属性
      if (img.dataset.image && img.dataset.image.startsWith('http')) {
        urls.add(img.dataset.image);
      }

      // srcset 属性
      if (img.srcset) {
        const srcsetUrls = img.srcset.split(',').map(s => {
          const url = s.trim().split(' ')[0];
          return url.startsWith('http') ? url : null;
        }).filter(Boolean);
        srcsetUrls.forEach(url => urls.add(url));
      }
    });

    // 2. 提取 CSS background-image（关键！某些设计图隐藏在这里）
    document.querySelectorAll('*').forEach(el => {
      try {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;

        if (bgImage && bgImage !== 'none') {
          // 提取 url() 中的 URL
          const match = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
          if (match && match[1] && match[1].startsWith('http')) {
            urls.add(match[1]);
          }
        }
      } catch (e) {
        // 忽略样式读取错误
      }
    });

    // 3. 提取 <picture> 和 <source> 标签
    document.querySelectorAll('picture source, source').forEach(source => {
      if (source.srcset) {
        const srcsetUrls = source.srcset.split(',').map(s => {
          const url = s.trim().split(' ')[0];
          return url.startsWith('http') ? url : null;
        }).filter(Boolean);
        srcsetUrls.forEach(url => urls.add(url));
      }

      if (source.src && source.src.startsWith('http')) {
        urls.add(source.src);
      }
    });

    return Array.from(urls);
  });

  console.log(`  ✅ 提取到 ${imageUrls.length} 个图片 URL`);
  return imageUrls;
}

/**
 * 过滤图片 URL
 * 排除 base64, svg, placeholder, data:image
 * 
 * @param {string[]} urls - 图片 URL 数组
 * @returns {string[]} 过滤后的 URL 数组
 */
function filterImageUrls(urls) {
  console.log('  🔍 过滤图片 URL...');

  const filtered = urls.filter(url => {
    try {
      // 1. 排除 base64 和 data URI
      if (url.startsWith('data:')) {
        return false;
      }

      // 2. 排除包含 base64 关键词
      if (url.toLowerCase().includes('base64')) {
        return false;
      }

      // 3. 排除 SVG
      if (url.toLowerCase().endsWith('.svg')) {
        return false;
      }

      // 4. 排除 placeholder
      if (url.toLowerCase().includes('placeholder')) {
        return false;
      }

      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      const pathname = urlObj.pathname.toLowerCase();

      // 5. 检查域名（如果配置了允许的域名）
      if (IMAGE_FILTER_RULES.allowedDomains.length > 0) {
        const isDomainAllowed = IMAGE_FILTER_RULES.allowedDomains.some(
          domain => hostname.includes(domain)
        );
        if (!isDomainAllowed) {
          return false;
        }
      }

      // 6. 排除包含排除关键词的 URL
      const hasExcludedKeyword = IMAGE_FILTER_RULES.excludeKeywords.some(
        keyword => pathname.includes(keyword) || hostname.includes(keyword)
      );
      if (hasExcludedKeyword) {
        return false;
      }

      return true;

    } catch (error) {
      return false;
    }
  });

  console.log(`  ✅ 过滤后剩余 ${filtered.length} 个图片`);
  return filtered;
}

/**
 * 去重图片 URL
 * 
 * @param {string[]} urls - 图片 URL 数组
 * @returns {string[]} 去重后的 URL 数组
 */
function deduplicateUrls(urls) {
  const uniqueUrls = new Map();

  urls.forEach(url => {
    try {
      const urlObj = new URL(url);
      // 使用 origin + pathname 作为唯一标识（忽略查询参数）
      const key = urlObj.origin + urlObj.pathname;

      if (!uniqueUrls.has(key)) {
        uniqueUrls.set(key, url);
      }
    } catch (error) {
      // 如果 URL 解析失败，直接使用原始 URL
      if (!uniqueUrls.has(url)) {
        uniqueUrls.set(url, url);
      }
    }
  });

  const result = Array.from(uniqueUrls.values());
  console.log(`  ✅ 去重后剩余 ${result.length} 个唯一图片`);
  return result;
}

/**
 * 通用图片提取函数
 * 
 * 流程：
 * 1. 启动浏览器
 * 2. 访问页面
 * 3. 自动滚动触发懒加载
 * 4. 提取所有图片
 * 5. 过滤无效图片
 * 6. 去重
 * 7. 返回所有有效图片
 * 
 * @param {string} url - 页面 URL
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 提取结果
 */
async function extractImages(url, options = {}) {
  console.log('🚀 开始提取图片:', url);
  console.log('  ⚠️  注意：返回所有图片，不只是主图');

  const config = {
    headless: options.headless !== false,
    timeout: options.timeout || IMAGE_FILTER_RULES.timeout,
    waitAfterLoad: options.waitAfterLoad || 1000,
    enableScroll: options.enableScroll !== false
  };

  let browser = null;

  try {
    // 1. 启动浏览器
    console.log('  🌐 启动浏览器...');
    browser = await puppeteer.launch(
      withPuppeteerExecutablePath({
        headless: config.headless ? 'new' : false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled'
        ]
      })
    );

    const page = await browser.newPage();

    // 设置视口和 User-Agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 2. 访问页面
    console.log('  📄 加载页面...');
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: config.timeout
    });

    // 等待页面渲染
    await page.waitForTimeout(config.waitAfterLoad);

    // 3. 自动滚动触发懒加载
    if (config.enableScroll) {
      console.log('  📜 自动滚动触发懒加载...');
      await autoScroll(page, {
        distance: 100,
        delay: 100,
        maxScrolls: 50,
        waitAfterScroll: 1500
      });
    }

    // 4. 提取所有图片 URL
    const allUrls = await extractAllImageUrls(page);

    console.log(`  📊 检测到图片数量: ${allUrls.length}`);

    if (allUrls.length === 0) {
      throw new Error('页面中未找到任何图片');
    }

    // 5. 过滤图片
    const filteredUrls = filterImageUrls(allUrls);

    console.log(`  📊 过滤后图片数量: ${filteredUrls.length}`);

    if (filteredUrls.length === 0) {
      throw new Error('未找到符合条件的图片');
    }

    // 6. 去重
    const uniqueUrls = deduplicateUrls(filteredUrls);

    console.log(`  📊 最终返回图片数量: ${uniqueUrls.length}`);

    // 打印所有图片 URL
    uniqueUrls.forEach((url, index) => {
      console.log(`  ${index + 1}. ${url}`);
    });

    // 7. 返回结果
    return {
      success: true,
      images: uniqueUrls,
      metadata: {
        totalFound: allUrls.length,
        afterFilter: filteredUrls.length,
        afterDedup: uniqueUrls.length
      }
    };

  } catch (error) {
    console.error('❌ 图片提取失败:', error.message);

    return {
      success: false,
      message: 'image_extract_failed',
      error: error.message,
      images: []
    };

  } finally {
    // 关闭浏览器
    if (browser) {
      await browser.close();
      console.log('  🔒 浏览器已关闭');
    }
  }
}

module.exports = {
  extractImages,
  extractAllImageUrls,
  filterImageUrls,
  deduplicateUrls,
  IMAGE_FILTER_RULES
};
