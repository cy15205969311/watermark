/**
 * 818ps（图怪兽）平台专用图片提取器 - 强化版
 * 
 * 核心功能：
 * 1. 全量提取所有图片（img 标签 + CSS background-image）
 * 2. 支持懒加载图片（data-src, data-original）
 * 3. 阶梯式平滑滚动触发懒加载（100% 抓全）
 * 4. 优化 CSS 背景图正则（兼容所有引号格式）
 * 5. 改进去重逻辑（防止误杀）
 * 6. 移除图片处理后缀，获取最高清原图
 * 7. 反爬避让（User-Agent 随机化、隐身模式）
 * 
 * @module 818psExtractor
 */

const puppeteer = require('puppeteer');

/**
 * User-Agent 池（随机化避免反爬）
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
];

/**
 * 随机获取 User-Agent
 * @returns {string} User-Agent 字符串
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * 阶梯式平滑滚动（强化版）
 * 
 * 策略：
 * 1. 每次向下滚动 300-500 像素
 * 2. 每次滚动后等待 200-300ms
 * 3. 滚动到底部后等待 3000ms
 * 4. 确保所有懒加载图片完全加载
 * 
 * @param {Page} page - Puppeteer 页面对象
 * @returns {Promise<Object>} 滚动结果
 */
async function enhancedSmoothScroll(page) {
  console.log('  📜 开始阶梯式平滑滚动（强化版）...');

  try {
    const scrollInfo = await page.evaluate(async () => {
      return new Promise((resolve) => {
        let scrollCount = 0;
        let lastScrollHeight = 0;
        let unchangedCount = 0;
        const startHeight = document.body.scrollHeight;

        const scrollStep = () => {
          const currentScrollHeight = document.body.scrollHeight;
          const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
          const windowHeight = window.innerHeight;

          // 检查是否到达底部
          const isAtBottom = currentScrollTop + windowHeight >= currentScrollHeight - 100;

          // 检查页面高度是否不再变化
          if (currentScrollHeight === lastScrollHeight) {
            unchangedCount++;
          } else {
            unchangedCount = 0;
            lastScrollHeight = currentScrollHeight;
          }

          // 如果到达底部或页面高度连续 3 次不变，停止滚动
          if (isAtBottom || unchangedCount >= 3) {
            resolve({
              scrollCount,
              startHeight,
              endHeight: currentScrollHeight,
              heightIncrease: currentScrollHeight - startHeight
            });
            return;
          }

          // 阶梯式滚动：每次 300-500 像素
          const scrollDistance = 300 + Math.floor(Math.random() * 200);
          window.scrollBy(0, scrollDistance);
          scrollCount++;

          // 每次滚动后等待 200-300ms
          const waitTime = 200 + Math.floor(Math.random() * 100);
          setTimeout(scrollStep, waitTime);
        };

        // 开始滚动
        scrollStep();
      });
    });

    console.log(`  ✅ 滚动完成: 滚动 ${scrollInfo.scrollCount} 次, 页面高度从 ${scrollInfo.startHeight}px 增加到 ${scrollInfo.endHeight}px`);

    // 滚动到底部后，等待 3000ms 确保所有图片加载
    console.log('  ⏳ 等待 3000ms 确保所有图片完全加载...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    return {
      success: true,
      ...scrollInfo
    };

  } catch (error) {
    console.error('  ❌ 滚动失败:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 从页面全量提取所有图片 URL（强化版）
 * 
 * 提取策略：
 * 1. 遍历所有 <img> 标签（src, data-src, data-original, data-lazy）
 * 2. 遍历所有元素的 CSS background-image（优化正则）
 * 3. 使用 Set 去重
 * 
 * @param {Page} page - Puppeteer 页面对象
 * @returns {Promise<string[]>} 图片 URL 数组
 */
async function extractAllImages(page) {
  console.log('  🔍 全量提取页面所有图片（强化版）...');

  const imageUrls = await page.evaluate(() => {
    const urls = new Set();

    // ========== 1. 提取所有 <img> 标签 ==========
    const imgElements = document.querySelectorAll('img');
    console.log(`[Browser] 找到 ${imgElements.length} 个 <img> 标签`);

    let imgCount = 0;
    imgElements.forEach((img) => {
      // src 属性
      if (img.src && img.src.startsWith('http')) {
        urls.add(img.src);
        imgCount++;
      }

      // data-src 属性（懒加载）
      if (img.dataset && img.dataset.src) {
        const dataSrc = img.dataset.src;
        if (dataSrc.startsWith('http')) {
          urls.add(dataSrc);
          imgCount++;
        } else if (dataSrc.startsWith('//')) {
          urls.add('https:' + dataSrc);
          imgCount++;
        }
      }

      // data-original 属性（懒加载）
      if (img.dataset && img.dataset.original) {
        const dataOriginal = img.dataset.original;
        if (dataOriginal.startsWith('http')) {
          urls.add(dataOriginal);
          imgCount++;
        } else if (dataOriginal.startsWith('//')) {
          urls.add('https:' + dataOriginal);
          imgCount++;
        }
      }

      // data-lazy 属性
      if (img.dataset && img.dataset.lazy) {
        const dataLazy = img.dataset.lazy;
        if (dataLazy.startsWith('http')) {
          urls.add(dataLazy);
          imgCount++;
        } else if (dataLazy.startsWith('//')) {
          urls.add('https:' + dataLazy);
          imgCount++;
        }
      }

      // srcset 属性
      if (img.srcset) {
        const srcsetUrls = img.srcset.split(',').map(s => {
          const url = s.trim().split(' ')[0];
          if (url.startsWith('http')) return url;
          if (url.startsWith('//')) return 'https:' + url;
          return null;
        }).filter(Boolean);
        srcsetUrls.forEach(url => {
          urls.add(url);
          imgCount++;
        });
      }
    });

    console.log(`[Browser] 从 <img> 标签提取到 ${imgCount} 个 URL`);

    // ========== 2. 提取所有 CSS background-image（优化正则）==========
    // 关键！818ps 详情页的设计图通常作为 div 背景存在
    const allElements = document.querySelectorAll('*');
    console.log(`[Browser] 检查 ${allElements.length} 个元素的 background-image`);

    let bgImageCount = 0;
    allElements.forEach(el => {
      try {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;

        if (bgImage && bgImage !== 'none') {
          // 优化正则：兼容单引号、双引号、无引号的 url(...) 格式
          // 匹配：url("..."), url('...'), url(...)
          const urlRegex = /url\(\s*(['"]?)([^'"()]+)\1\s*\)/g;
          let match;

          while ((match = urlRegex.exec(bgImage)) !== null) {
            let url = match[2].trim();

            // 处理相对路径
            if (url.startsWith('http')) {
              urls.add(url);
              bgImageCount++;
            } else if (url.startsWith('//')) {
              urls.add('https:' + url);
              bgImageCount++;
            }
          }
        }
      } catch (e) {
        // 忽略样式读取错误
      }
    });

    console.log(`[Browser] 从 background-image 提取到 ${bgImageCount} 个 URL`);
    console.log(`[Browser] 总共提取到 ${urls.size} 个唯一 URL`);

    return Array.from(urls);
  });

  console.log(`  ✅ 全量提取到 ${imageUrls.length} 个图片 URL`);
  return imageUrls;
}

/**
 * 清洗图片 URL
 * 
 * 清洗规则：
 * 1. 移除图片处理后缀（!l1600, !740 等）
 * 2. 过滤 base64
 * 3. 过滤 SVG
 * 4. 过滤占位符
 * 5. 只保留 img.tuguaishou.com 域名
 * 
 * @param {string[]} urls - 原始 URL 数组
 * @returns {string[]} 清洗后的 URL 数组
 */
function cleanImageUrls(urls) {
  console.log('  🧹 正则清洗图片 URL...');

  const cleaned = urls
    .map(url => {
      try {
        // 移除图片处理后缀（获取最高清原图）
        // 例如：https://img.tuguaishou.com/xxx.jpg!l1600 → https://img.tuguaishou.com/xxx.jpg
        url = url.replace(/![a-zA-Z0-9]+$/, '');

        // 移除查询参数中的图片处理参数
        url = url.replace(/[?&](x-oss-process|imageMogr2|imageView2)=[^&]*/g, '');

        // 清理多余的 ? 和 &
        url = url.replace(/[?&]$/, '');

        return url;
      } catch (e) {
        return url;
      }
    })
    .filter(url => {
      try {
        // 1. 排除 base64
        if (url.includes('base64')) {
          return false;
        }

        // 2. 排除 data URI
        if (url.startsWith('data:')) {
          return false;
        }

        // 3. 排除 SVG
        if (url.toLowerCase().endsWith('.svg')) {
          return false;
        }

        // 4. 排除占位符（placeholder, loading, spinner 等）
        const excludeKeywords = ['placeholder', 'loading', 'spinner', 'blank', 'default', 'avatar', 'icon'];
        const urlLower = url.toLowerCase();
        if (excludeKeywords.some(keyword => urlLower.includes(keyword))) {
          return false;
        }

        // 5. 只保留 img.tuguaishou.com 域名
        if (!url.includes('img.tuguaishou.com')) {
          return false;
        }

        return true;

      } catch (error) {
        return false;
      }
    });

  console.log(`  ✅ 清洗后剩余 ${cleaned.length} 个有效图片`);
  return cleaned;
}

/**
 * 去重图片 URL（改进版 - 防止误杀）
 * 
 * 去重策略：
 * 1. 先移除图片处理后缀（!l1600 等）
 * 2. 使用完整 URL（包括查询参数）作为唯一标识
 * 3. 只有完全相同的 URL 才会被去重
 * 
 * @param {string[]} urls - 图片 URL 数组
 * @returns {string[]} 去重后的 URL 数组
 */
function deduplicateUrls(urls) {
  console.log('  🔄 去重图片 URL（防止误杀）...');

  const uniqueSet = new Set();
  const result = [];

  urls.forEach(url => {
    // 使用完整 URL 作为唯一标识（包括查询参数）
    // 这样可以保留实质不同的图片
    if (!uniqueSet.has(url)) {
      uniqueSet.add(url);
      result.push(url);
    }
  });

  console.log(`  ✅ 去重前: ${urls.length} 个, 去重后: ${result.length} 个`);
  return result;
}

/**
 * 提取 818ps 图片 - 主函数（强化版）
 * 
 * 优化点：
 * 1. 全量提取（不使用 find() 或单一选择器）
 * 2. CSS background-image 识别（优化正则）
 * 3. 阶梯式平滑滚动（100% 抓全）
 * 4. 正则清洗与去重（防止误杀）
 * 5. 移除图片处理后缀
 * 6. User-Agent 随机化
 * 7. 隐身模式
 * 
 * @param {string} url - 818ps 页面 URL
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 提取结果
 */
async function extract818ps(url, options = {}) {
  console.log('='.repeat(80));
  console.log('🚀 开始提取 818ps 图片（强化版 - 100% 抓全）');
  console.log('  URL:', url);
  console.log('  策略: 阶梯式滚动 + CSS 背景图 + 防误杀去重');
  console.log('='.repeat(80));

  const config = {
    headless: options.headless !== false,
    timeout: options.timeout || 20000
  };

  let browser = null;

  try {
    // ========== 1. 启动浏览器（隐身模式 + 反爬配置）==========
    console.log('  🌐 启动浏览器（隐身模式）...');

    const randomUserAgent = getRandomUserAgent();
    console.log('  🎭 随机 User-Agent:', randomUserAgent.substring(0, 50) + '...');

    browser = await puppeteer.launch({
      headless: config.headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    // 使用隐身模式上下文
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();

    // ========== 2. 配置页面（反爬避让）==========
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1
    });

    await page.setUserAgent(randomUserAgent);

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    // 隐藏 webdriver 特征
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });

      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en']
      });

      window.chrome = {
        runtime: {}
      };

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    // ========== 3. 访问页面 ==========
    console.log('  📄 加载页面...');

    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: config.timeout
      });
    } catch (error) {
      console.log('  ⚠️  networkidle2 超时，尝试 domcontentloaded...');
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: config.timeout
      });
    }

    console.log('  ✅ 页面加载完成');

    // ========== 4. 阶梯式平滑滚动触发懒加载（关键！）==========
    await enhancedSmoothScroll(page);

    // ========== 5. 全量提取所有图片 ==========
    const allUrls = await extractAllImages(page);

    console.log(`  📊 检测到图片数量: ${allUrls.length}`);

    if (allUrls.length === 0) {
      throw new Error('页面中未找到任何图片');
    }

    // ========== 6. 正则清洗 ==========
    const cleanedUrls = cleanImageUrls(allUrls);

    console.log(`  📊 清洗后图片数量: ${cleanedUrls.length}`);

    if (cleanedUrls.length === 0) {
      throw new Error('清洗后未找到有效的 818ps 图片');
    }

    // ========== 7. 去重（防止误杀）==========
    const uniqueUrls = deduplicateUrls(cleanedUrls);

    console.log(`  📊 最终返回图片数量: ${uniqueUrls.length}`);

    // 打印所有图片 URL
    console.log('');
    console.log('  📷 提取到的图片列表:');
    uniqueUrls.forEach((imgUrl, index) => {
      console.log(`    ${index + 1}. ${imgUrl}`);
    });
    console.log('');

    // ========== 8. 返回结果 ==========
    console.log('='.repeat(80));
    console.log('✅ 提取成功');
    console.log('='.repeat(80));

    return {
      success: true,
      platform: '818ps',
      images: uniqueUrls,
      metadata: {
        totalFound: allUrls.length,
        afterClean: cleanedUrls.length,
        afterDedup: uniqueUrls.length
      }
    };

  } catch (error) {
    console.error('='.repeat(80));
    console.error('❌ 提取失败:', error.message);
    console.error('='.repeat(80));

    return {
      success: false,
      platform: '818ps',
      message: 'image_extract_failed',
      error: error.message,
      images: []
    };

  } finally {
    if (browser) {
      await browser.close();
      console.log('  🔒 浏览器已关闭');
    }
  }
}

module.exports = {
  extract818ps,
  extractAllImages,
  cleanImageUrls,
  deduplicateUrls,
  getRandomUserAgent,
  enhancedSmoothScroll
};
