/**
 * Puppeteer 自动滚动工具
 * 
 * 功能：
 * - 自动滚动页面到底部
 * - 触发懒加载图片加载
 * - 支持自定义滚动速度和等待时间
 * 
 * @module autoScroll
 */

/**
 * 自动滚动页面到底部，触发懒加载
 * 
 * @param {Page} page - Puppeteer 页面对象
 * @param {Object} options - 配置选项
 * @param {number} options.distance - 每次滚动的距离（像素），默认 100
 * @param {number} options.delay - 每次滚动的延迟（毫秒），默认 100
 * @param {number} options.maxScrolls - 最大滚动次数，默认 50
 * @param {number} options.waitAfterScroll - 滚动完成后等待时间（毫秒），默认 1000
 * @returns {Promise<Object>} 滚动结果信息
 */
async function autoScroll(page, options = {}) {
  const config = {
    distance: options.distance || 100,
    delay: options.delay || 100,
    maxScrolls: options.maxScrolls || 50,
    waitAfterScroll: options.waitAfterScroll || 1000
  };

  console.log('  📜 开始自动滚动页面...');
  console.log(`  ⚙️  配置: 距离=${config.distance}px, 延迟=${config.delay}ms, 最大次数=${config.maxScrolls}`);

  try {
    // 在页面上下文中执行滚动
    const scrollInfo = await page.evaluate(async (config) => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        let scrollCount = 0;
        const startHeight = document.body.scrollHeight;

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          const currentScroll = window.pageYOffset || document.documentElement.scrollTop;

          // 滚动
          window.scrollBy(0, config.distance);
          totalHeight += config.distance;
          scrollCount++;

          // 检查是否到达底部或超过最大滚动次数
          if (
            totalHeight >= scrollHeight ||
            scrollCount >= config.maxScrolls ||
            currentScroll + window.innerHeight >= scrollHeight - 10
          ) {
            clearInterval(timer);

            // 滚动回顶部（可选，有助于触发某些懒加载）
            window.scrollTo(0, 0);

            resolve({
              scrollCount,
              totalHeight,
              startHeight,
              endHeight: scrollHeight,
              heightIncrease: scrollHeight - startHeight
            });
          }
        }, config.delay);
      });
    }, config);

    // 滚动完成后等待一段时间，确保图片加载
    await page.waitForTimeout(config.waitAfterScroll);

    console.log(`  ✅ 滚动完成: 滚动${scrollInfo.scrollCount}次, 页面高度从${scrollInfo.startHeight}px增加到${scrollInfo.endHeight}px`);

    return {
      success: true,
      ...scrollInfo
    };

  } catch (error) {
    console.error('  ❌ 自动滚动失败:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 快速滚动（适用于简单页面）
 * 
 * @param {Page} page - Puppeteer 页面对象
 * @returns {Promise<Object>} 滚动结果
 */
async function quickScroll(page) {
  console.log('  ⚡ 执行快速滚动...');

  try {
    await page.evaluate(async () => {
      // 滚动到底部
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(resolve => setTimeout(resolve, 500));

      // 滚动到中间
      window.scrollTo(0, document.body.scrollHeight / 2);
      await new Promise(resolve => setTimeout(resolve, 500));

      // 滚动回顶部
      window.scrollTo(0, 0);
    });

    await page.waitForTimeout(1000);

    console.log('  ✅ 快速滚动完成');
    return { success: true };

  } catch (error) {
    console.error('  ❌ 快速滚动失败:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 智能滚动（根据页面高度自动选择策略）
 * 
 * @param {Page} page - Puppeteer 页面对象
 * @returns {Promise<Object>} 滚动结果
 */
async function smartScroll(page) {
  try {
    // 获取页面高度
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);

    console.log(`  🧠 智能滚动: 页面高度 ${pageHeight}px`);

    // 根据页面高度选择滚动策略
    if (pageHeight < 3000) {
      // 短页面：快速滚动
      return await quickScroll(page);
    } else if (pageHeight < 10000) {
      // 中等页面：标准滚动
      return await autoScroll(page, {
        distance: 200,
        delay: 100,
        maxScrolls: 30
      });
    } else {
      // 长页面：慢速滚动
      return await autoScroll(page, {
        distance: 300,
        delay: 150,
        maxScrolls: 50
      });
    }

  } catch (error) {
    console.error('  ❌ 智能滚动失败:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 滚动到特定元素
 * 
 * @param {Page} page - Puppeteer 页面对象
 * @param {string} selector - CSS 选择器
 * @returns {Promise<boolean>} 是否成功
 */
async function scrollToElement(page, selector) {
  try {
    await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
      return false;
    }, selector);

    await page.waitForTimeout(500);
    return true;

  } catch (error) {
    console.error(`  ❌ 滚动到元素失败 (${selector}):`, error.message);
    return false;
  }
}

module.exports = {
  autoScroll,
  quickScroll,
  smartScroll,
  scrollToElement
};
