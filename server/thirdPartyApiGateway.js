/**
 * 第三方 API 网关 - 统一接入多个去水印 API
 * 支持多 API fallback、缓存、速率限制等机制
 */

const axios = require("axios");
const qs = require("querystring");
const { redact } = require("./extractors/818ps-pages");
function classifyRequestError(error) {
  const code = String(error.code || "");
  if (/CERT|TLS|SSL|SELF_SIGNED|VERIFY_LEAF/.test(code)) return "certificate";
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return "dns";
  if (/TIME|ABORT/.test(code)) return "timeout";
  if (error.response) return `http_${error.response.status}`;
  return "connection";
}
function isTransientError(error) {
  return ["timeout", "connection"].includes(classifyRequestError(error)) || error.code === "EAI_AGAIN" || error.response?.status === 429 || error.response?.status >= 500;
}

// ====== API 提供商配置 ======

// 1. kk.tsgpt.top - credentials must come from explicit configuration.
const TSGPT_API = {
  name: "TSGPT",
  baseUrl: "https://kk.tsgpt.top/tgs/info/",
  get token() { return process.env.TSGPT_TOKEN || ""; },
  get enabled() { return Boolean(process.env.TSGPT_TOKEN); },
  priority: 1, // 优先级越高越先调用
};

// 2. 其他免费/收费 API（可选对接）
const OTHER_APIS = {
  // 示例：RapidAPI 的某个去水印服务
  rapidapi: {
    name: "RapidAPI",
    baseUrl: "https://api.rapidapi.com/...",
    key: process.env.RAPIDAPI_KEY || "",
    enabled: false,
    priority: 2,
  },
  // 示例：自建或其他第三方服务
  custom: {
    name: "CustomAPI",
    baseUrl: process.env.CUSTOM_API_URL || "",
    enabled: false,
    priority: 3,
  },
};

// ====== 工具函数 ======

/**
 * 简单的请求重试机制
 */
async function retryRequest(fn, attempts = 3, delayMs = 500) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error)) throw error;
      if (i < attempts - 1) {
        console.warn(
          `  ⚠️ 重试 ${i + 1}/${attempts - 1}，等待 ${delayMs}ms...`
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * 通用 HTTP 请求包装
 */
async function makeRequest(url, options = {}) {
  const config = {
    timeout: 10000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    ...options,
  };

  return axios(url, config);
}

// ====== API 提供商实现 ======

/**
 * 调用 TSGPT API
 */
async function callTSGPT(targetUrl) {
  if (!TSGPT_API.enabled) return null;

  console.log(`  📡 尝试调用 ${TSGPT_API.name} API...`);

  // 先尝试 GET
  try {
    const getUrl = `${TSGPT_API.baseUrl}?token=${
      TSGPT_API.token
    }&url=${encodeURIComponent(targetUrl)}`;
    const resp = await retryRequest(
      () => makeRequest(getUrl, { headers: { Accept: "application/json" } }),
      2,
      300
    );
    const data = resp.data;
    if (data && (data.image || data.imageUrl || data.url)) {
      const imageUrl = data.image || data.imageUrl || data.url;
      console.log(
        `  ✅ ${TSGPT_API.name} 返回图片: ${redact(imageUrl)}`
      );
      return {
        success: true,
        imageUrl,
        provider: TSGPT_API.name,
        source: "thirdparty-get",
      };
    }
  } catch (error) {
    console.warn(`  ❌ ${TSGPT_API.name} GET 请求失败: ${classifyRequestError(error)} (${error.code || error.response?.status || "unknown"})`);
    if (classifyRequestError(error) === "certificate") return null;
  }
  // GET 失败再 POST
  try {
    const resp = await retryRequest(
      () =>
        makeRequest(TSGPT_API.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          data: {
            token: TSGPT_API.token,
            url: targetUrl,
          },
        }),
      2,
      300
    );
    const data = resp.data;
    if (data && (data.image || data.imageUrl || data.url)) {
      const imageUrl = data.image || data.imageUrl || data.url;
      console.log(
        `  ✅ ${TSGPT_API.name} 返回图片 (POST): ${redact(imageUrl)}`
      );
      return {
        success: true,
        imageUrl,
        provider: TSGPT_API.name,
        source: "thirdparty-post",
      };
    }
  } catch (error) {
    console.warn(`  ❌ ${TSGPT_API.name} POST 请求失败: ${classifyRequestError(error)} (${error.code || error.response?.status || "unknown"})`);
  }

  return null;
}

/**
 * 调用 RapidAPI（示例模板）
 */
async function callRapidAPI(targetUrl) {
  if (!OTHER_APIS.rapidapi.enabled) return null;

  console.log(`  📡 尝试调用 ${OTHER_APIS.rapidapi.name} API...`);

  if (!OTHER_APIS.rapidapi.key) {
    console.warn(`  ⚠️ ${OTHER_APIS.rapidapi.name} 未配置密钥`);
    return null;
  }

  try {
    const resp = await retryRequest(
      () =>
        makeRequest(OTHER_APIS.rapidapi.baseUrl, {
          method: "POST",
          headers: {
            "x-rapidapi-key": OTHER_APIS.rapidapi.key,
            "x-rapidapi-host": "api.rapidapi.com",
            "Content-Type": "application/json",
          },
          data: { url: targetUrl },
        }),
      2,
      500
    );

    const data = resp.data;
    if (data && data.image_url) {
      console.log(`  ✅ ${OTHER_APIS.rapidapi.name} 返回图片`);
      return {
        success: true,
        imageUrl: data.image_url,
        provider: OTHER_APIS.rapidapi.name,
        source: "rapidapi",
      };
    }
  } catch (error) {
    console.warn(`  ❌ ${OTHER_APIS.rapidapi.name} 请求失败: ${error.message}`);
  }

  return null;
}

/**
 * 调用自定义 API（示例模板）
 */
async function callCustomAPI(targetUrl) {
  if (!OTHER_APIS.custom.enabled || !OTHER_APIS.custom.baseUrl) return null;

  console.log(`  📡 尝试调用 ${OTHER_APIS.custom.name} API...`);

  try {
    const resp = await retryRequest(
      () =>
        makeRequest(OTHER_APIS.custom.baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          data: { url: targetUrl },
        }),
      2,
      500
    );

    const data = resp.data;
    if (data && data.imageUrl) {
      console.log(`  ✅ ${OTHER_APIS.custom.name} 返回图片`);
      return {
        success: true,
        imageUrl: data.imageUrl,
        provider: OTHER_APIS.custom.name,
        source: "custom",
      };
    }
  } catch (error) {
    console.warn(`  ❌ ${OTHER_APIS.custom.name} 请求失败: ${error.message}`);
  }

  return null;
}

// ====== 主网关入口 ======

/**
 * 统一 API 网关 - 自动 fallback
 * @param {string} targetUrl - 目标分享链接
 * @param {string} platform - 平台识别
 * @returns {Promise<Object>} { success, imageUrl, provider, source }
 */
async function extractViaThirdPartyAPI(targetUrl, platform = "unknown") {
  console.log(`\n🌐 启动第三方 API 网关，平台: ${platform}`);
  console.log(`   目标 URL: ${redact(targetUrl)}`);

  // API 优先级列表（按 priority 排序）
  const apiCandidates = [
    { fn: callTSGPT, name: TSGPT_API.name, priority: TSGPT_API.priority },
    {
      fn: callRapidAPI,
      name: OTHER_APIS.rapidapi.name,
      priority: OTHER_APIS.rapidapi.priority,
    },
    {
      fn: callCustomAPI,
      name: OTHER_APIS.custom.name,
      priority: OTHER_APIS.custom.priority,
    },
  ].sort((a, b) => a.priority - b.priority);

  // 依次尝试每个 API
  for (const api of apiCandidates) {
    try {
      const result = await api.fn(targetUrl);
      if (result && result.success && result.imageUrl) {
        console.log(`\n✅ 第三方 API 网关成功: 使用 ${result.provider}\n`);
        return result;
      }
    } catch (error) {
      console.error(`  ❌ ${api.name} 异常: ${error.message}`);
    }
  }

  console.log(`\n❌ 所有第三方 API 都失败了\n`);
  return null;
}

// ====== 缓存机制（可选）======

const cache = new Map();
const CACHE_TTL = 3600000; // 1 小时

/**
 * 带缓存的提取函数
 */
async function extractViaThirdPartyAPIWithCache(targetUrl, platform) {
  if (/818ps|tuguaishou/i.test(`${platform}:${targetUrl}`)) return extractViaThirdPartyAPI(targetUrl, platform);
  const cacheKey = `${platform}:${targetUrl}`;

  // 检查缓存
  if (cache.has(cacheKey)) {
    const { data, timestamp } = cache.get(cacheKey);
    if (Date.now() - timestamp < CACHE_TTL) {
      console.log(
        `📦 从缓存返回结果 (${Math.round(
          (Date.now() - timestamp) / 1000
        )}s ago)`
      );
      return data;
    } else {
      cache.delete(cacheKey);
    }
  }

  // 调用 API
  const result = await extractViaThirdPartyAPI(targetUrl, platform);

  // 缓存成功结果
  if (result && result.success && result.imageUrl) {
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });
  }

  return result;
}

// ====== 导出 ======

module.exports = {
  extractViaThirdPartyAPI,
  extractViaThirdPartyAPIWithCache,
  // 也导出单个 API 调用函数，便于测试
  callTSGPT,
  callRapidAPI,
  callCustomAPI,
  // 导出配置，供测试或动态修改
  TSGPT_API,
  OTHER_APIS,
  classifyRequestError,
  retryRequest,
};
