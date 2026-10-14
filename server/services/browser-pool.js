/**
 * 浏览器连接池
 * 复用浏览器实例，避免频繁启动/关闭的性能开销
 *
 * 用途：
 * - 减少内存占用
 * - 提升并发处理能力
 * - 降低响应时间
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const {
  getPuppeteerExecutablePath,
  withPuppeteerExecutablePath,
  launchTracked,
} = require("../utils/puppeteer-launch");

puppeteer.use(StealthPlugin());

class BrowserPool {
  constructor(options = {}) {
    this.minInstances = options.minInstances || 1; // 最少实例数
    this.maxInstances = options.maxInstances || 3; // 最多实例数
    this.instances = []; // 实例池
    this.waiting = []; // 等待队列
    this.inUse = new Set(); // 正在使用的实例
    this.creating = 0;
    this.launchOptions = options.launchOptions || {};
    this.initialized = false;
    this.closing = false;

    console.log(
      `🔧 浏览器池配置: min=${this.minInstances}, max=${this.maxInstances}`
    );
  }

  /**
   * 初始化池
   */
  async init() {
    if (this.initialized) return;

    console.log(`📦 初始化浏览器池 (创建 ${this.minInstances} 个实例)...`);

    for (let i = 0; i < this.minInstances; i++) {
      try {
        const browser = await this._createBrowser();
        this.instances.push(browser);
        console.log(`  ✅ 创建实例 ${i + 1}/${this.minInstances}`);
      } catch (error) {
        console.error(`  ❌ 创建实例失败: ${error.message}`);
        const executablePath =
          getPuppeteerExecutablePath() || this.launchOptions.executablePath;
        if (executablePath) {
          console.error(`  Chromium executablePath: ${executablePath}`);
        }
      }
    }

    this.initialized = true;
    console.log(`✅ 浏览器池初始化完成，可用实例: ${this.instances.length}`);
  }

  /**
   * 创建浏览器实例
   * @private
   */
  async _createBrowser() {
    const browser = await launchTracked(puppeteer,
      withPuppeteerExecutablePath({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-extensions",
        ],
        ...this.launchOptions,
      })
    );

    return browser;
  }

  /**
   * 获取一个浏览器实例
   * 如果没有可用实例且未达上限，则创建新实例
   */
  async acquire(timeoutMs = 10000) {
    if (this.closing) throw new Error('browser_pool_closed');
    this.instances = this.instances.filter(browser => browser.isConnected());
    // 如果有可用实例，直接返回
    if (this.instances.length > 0) {
      const browser = this.instances.pop();
      this.inUse.add(browser);
      console.log(
        `✅ 获取浏览器实例 (可用: ${this.instances.length}, 使用中: ${this.inUse.size})`
      );
      return browser;
    }

    // 如果未达上限，创建新实例
    if (this.inUse.size + this.creating < this.maxInstances) {
      this.creating += 1;
      try {
        console.log(
          `⚙️ 创建新浏览器实例 (当前使用中: ${this.inUse.size}/${this.maxInstances})`
        );
        const browser = await this._createBrowser();
        this.inUse.add(browser);
        return browser;
      } catch (error) {
        console.error(`❌ 创建新实例失败: ${error.message}`);
        throw error;
      } finally {
        this.creating -= 1;
      }
    }

    // 达到上限，等待可用实例
    console.log(
      `⏳ 等待可用实例 (使用中: ${this.inUse.size}/${this.maxInstances})`
    );
    return new Promise((resolve, reject) => {
      const waiter = (browser) => { clearTimeout(timer); resolve(browser); };
      waiter.cancel = () => { clearTimeout(timer); reject(new Error('browser_pool_closed')); };
      const timer = setTimeout(() => {
        this.waiting = this.waiting.filter(item => item !== waiter);
        reject(new Error("browser_pool_acquire_timeout"));
      }, timeoutMs);
      this.waiting.push(waiter);
    });
  }

  /**
   * 归还浏览器实例
   */
  release(browser) {
    if (!this.inUse.has(browser)) return;
    this.inUse.delete(browser);
    if (this.closing || !browser.isConnected()) { browser.close().catch(() => {}); return; }

    // 如果有等待的请求，分配给它
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      this.inUse.add(browser);
      console.log(`✅ 分配实例给等待的请求 (等待中: ${this.waiting.length})`);
      resolve(browser);
    } else {
      // 否则放回池中
      this.instances.push(browser);
      console.log(`♻️ 实例已归还池 (可用: ${this.instances.length})`);
    }
  }

  /**
   * 关闭所有实例
   */
  async closeAll() {
    this.closing = true;
    this.waiting.forEach(waiter => waiter.cancel?.());
    this.waiting = [];
    console.log(`🛑 关闭所有浏览器实例...`);

    const allBrowsers = [...this.instances, ...this.inUse];

    for (const browser of allBrowsers) {
      try {
        if (browser.isConnected()) await browser.close();
      } catch (error) {
        console.warn(`⚠️ 关闭实例异常: ${error.message}`);
      }
    }

    this.instances = [];
    this.inUse.clear();
    this.waiting = [];
    this.initialized = false;

    console.log(`✅ 所有实例已关闭`);
  }

  /**
   * 获取池状态
   */
  getStatus() {
    return {
      available: this.instances.length,
      inUse: this.inUse.size,
      waiting: this.waiting.length,
      total: this.instances.length + this.inUse.size,
      maxInstances: this.maxInstances,
    };
  }
}

// 全局默认池实例
let defaultPool = null;

/**
 * 获取全局浏览器池
 */
function getDefaultPool() {
  if (!defaultPool) {
    defaultPool = new BrowserPool({
      minInstances: 1,
      maxInstances: 3,
    });
  }
  return defaultPool;
}

/**
 * 初始化全局池
 */
async function initDefaultPool() {
  const pool = getDefaultPool();
  await pool.init();
  return pool;
}

/**
 * 关闭全局池
 */
async function closeDefaultPool() {
  if (defaultPool) {
    await defaultPool.closeAll();
    defaultPool = null;
  }
}

// ==================== 导出 ====================

module.exports = {
  BrowserPool,
  getDefaultPool,
  initDefaultPool,
  closeDefaultPool,
};
