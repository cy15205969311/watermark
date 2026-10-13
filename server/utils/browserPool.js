/**
 * 浏览器池管理器
 * 
 * 功能：
 * 1. 复用浏览器实例
 * 2. 提高性能
 * 3. 自动管理生命周期
 * 
 * @module browserPool
 */

const puppeteer = require('puppeteer');
const { withPuppeteerExecutablePath } = require('./puppeteer-launch');

/**
 * 浏览器池配置
 */
const POOL_CONFIG = {
  min: 1,           // 最小实例数
  max: 3,           // 最大实例数
  idleTimeout: 60000, // 空闲超时（毫秒）
  launchOptions: {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  }
};

/**
 * 浏览器池类
 */
class BrowserPool {
  constructor(config = {}) {
    this.config = { ...POOL_CONFIG, ...config };
    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers = new Set();
    this.initialized = false;
  }

  /**
   * 初始化浏览器池
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('🚀 初始化浏览器池...');
    console.log(`  ⚙️  配置: min=${this.config.min}, max=${this.config.max}`);

    // 创建最小数量的浏览器实例
    for (let i = 0; i < this.config.min; i++) {
      await this.createBrowser();
    }

    this.initialized = true;
    console.log(`✅ 浏览器池初始化完成，当前实例数: ${this.browsers.length}`);
  }

  /**
   * 创建新的浏览器实例
   */
  async createBrowser() {
    try {
      const browser = await puppeteer.launch(
        withPuppeteerExecutablePath(this.config.launchOptions)
      );

      const browserInfo = {
        browser,
        id: `browser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        useCount: 0
      };

      this.browsers.push(browserInfo);
      this.availableBrowsers.push(browserInfo);

      console.log(`  ✅ 创建浏览器实例: ${browserInfo.id}`);

      return browserInfo;

    } catch (error) {
      console.error('  ❌ 创建浏览器实例失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取可用的浏览器实例
   */
  async acquire() {
    if (!this.initialized) {
      await this.initialize();
    }

    // 如果有可用的浏览器，直接返回
    if (this.availableBrowsers.length > 0) {
      const browserInfo = this.availableBrowsers.shift();
      this.busyBrowsers.add(browserInfo);

      browserInfo.lastUsed = Date.now();
      browserInfo.useCount++;

      console.log(`  📦 获取浏览器实例: ${browserInfo.id} (使用次数: ${browserInfo.useCount})`);

      return browserInfo.browser;
    }

    // 如果没有可用的浏览器，且未达到最大数量，创建新的
    if (this.browsers.length < this.config.max) {
      const browserInfo = await this.createBrowser();
      this.availableBrowsers.shift(); // 从可用列表移除
      this.busyBrowsers.add(browserInfo);

      browserInfo.lastUsed = Date.now();
      browserInfo.useCount++;

      console.log(`  📦 获取新创建的浏览器实例: ${browserInfo.id}`);

      return browserInfo.browser;
    }

    // 如果已达到最大数量，等待可用的浏览器
    console.log('  ⏳ 等待可用的浏览器实例...');

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.availableBrowsers.length > 0) {
          clearInterval(checkInterval);

          const browserInfo = this.availableBrowsers.shift();
          this.busyBrowsers.add(browserInfo);

          browserInfo.lastUsed = Date.now();
          browserInfo.useCount++;

          console.log(`  📦 获取浏览器实例: ${browserInfo.id}`);

          resolve(browserInfo.browser);
        }
      }, 100);
    });
  }

  /**
   * 释放浏览器实例
   */
  async release(browser) {
    const browserInfo = this.browsers.find(b => b.browser === browser);

    if (!browserInfo) {
      console.warn('  ⚠️ 尝试释放未知的浏览器实例');
      return;
    }

    this.busyBrowsers.delete(browserInfo);
    this.availableBrowsers.push(browserInfo);

    console.log(`  🔓 释放浏览器实例: ${browserInfo.id}`);

    // 检查是否需要清理空闲的浏览器
    this.cleanupIdleBrowsers();
  }

  /**
   * 清理空闲的浏览器实例
   */
  async cleanupIdleBrowsers() {
    const now = Date.now();

    // 保留最小数量的浏览器
    if (this.availableBrowsers.length <= this.config.min) {
      return;
    }

    // 查找超过空闲超时的浏览器
    const idleBrowsers = this.availableBrowsers.filter(
      browserInfo => now - browserInfo.lastUsed > this.config.idleTimeout
    );

    for (const browserInfo of idleBrowsers) {
      // 保留最小数量
      if (this.browsers.length <= this.config.min) {
        break;
      }

      try {
        await browserInfo.browser.close();

        // 从列表中移除
        this.browsers = this.browsers.filter(b => b.id !== browserInfo.id);
        this.availableBrowsers = this.availableBrowsers.filter(b => b.id !== browserInfo.id);

        console.log(`  🗑️  清理空闲浏览器实例: ${browserInfo.id}`);

      } catch (error) {
        console.error(`  ❌ 清理浏览器实例失败: ${browserInfo.id}`, error.message);
      }
    }
  }

  /**
   * 关闭所有浏览器实例
   */
  async destroy() {
    console.log('🔒 关闭浏览器池...');

    for (const browserInfo of this.browsers) {
      try {
        await browserInfo.browser.close();
        console.log(`  ✅ 关闭浏览器实例: ${browserInfo.id}`);
      } catch (error) {
        console.error(`  ❌ 关闭浏览器实例失败: ${browserInfo.id}`, error.message);
      }
    }

    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers.clear();
    this.initialized = false;

    console.log('✅ 浏览器池已关闭');
  }

  /**
   * 获取池状态
   */
  getStatus() {
    return {
      total: this.browsers.length,
      available: this.availableBrowsers.length,
      busy: this.busyBrowsers.size,
      config: {
        min: this.config.min,
        max: this.config.max,
        idleTimeout: this.config.idleTimeout
      }
    };
  }
}

// 创建全局浏览器池实例
const globalBrowserPool = new BrowserPool();

/**
 * 使用浏览器池执行任务
 * 
 * @param {Function} task - 任务函数，接收 browser 参数
 * @returns {Promise<any>} 任务结果
 */
async function withBrowser(task) {
  const browser = await globalBrowserPool.acquire();

  try {
    return await task(browser);
  } finally {
    await globalBrowserPool.release(browser);
  }
}

module.exports = {
  BrowserPool,
  globalBrowserPool,
  withBrowser
};
