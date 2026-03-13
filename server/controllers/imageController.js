/**
 * 图片提取控制器
 * 
 * 功能：
 * 1. 统一处理图片提取请求
 * 2. 路由到不同的平台提取器
 * 3. 错误处理和日志记录
 * 
 * @module imageController
 */

const { extract818ps } = require('../extractors/818ps');
const { extractHuaban } = require('../extractors/huaban');
const { extractCanva } = require('../extractors/canva');
const { extractImages } = require('../services/imageExtractor');

/**
 * 检测平台类型
 * 
 * @param {string} url - 页面 URL
 * @returns {string} 平台名称
 */
function detectPlatform(url) {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('818ps.com') || urlLower.includes('tuguaishou.com')) {
    return '818ps';
  }

  if (urlLower.includes('huaban.com')) {
    return 'huaban';
  }

  if (urlLower.includes('canva.com')) {
    return 'canva';
  }

  if (urlLower.includes('chuangkit.com')) {
    return 'chuangkit';
  }

  return 'unknown';
}

/**
 * 提取图片 - 主控制器
 * 
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 */
async function extractImageController(req, res) {
  const startTime = Date.now();

  try {
    const { url } = req.body;

    // 验证 URL
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required',
        error: 'missing_url'
      });
    }

    console.log('='.repeat(80));
    console.log('📥 收到图片提取请求');
    console.log('  URL:', url);
    console.log('  时间:', new Date().toISOString());
    console.log('='.repeat(80));

    // 检测平台
    const platform = detectPlatform(url);
    console.log('  🔍 检测到平台:', platform);

    let result;

    // 根据平台选择提取器
    switch (platform) {
      case '818ps':
        result = await extract818ps(url, {
          timeout: 15000,
          maxResults: 5
        });
        break;

      case 'huaban':
        result = await extractHuaban(url, {
          timeout: 15000,
          maxResults: 5
        });
        break;

      case 'canva':
        result = await extractCanva(url, {
          timeout: 15000,
          maxResults: 5
        });
        break;

      default:
        // 使用通用提取器
        console.log('  ⚠️ 未知平台，使用通用提取器');
        result = await extractImages(url, {
          timeout: 15000
        });
        break;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('='.repeat(80));
    console.log('📤 图片提取完成');
    console.log('  状态:', result.success ? '✅ 成功' : '❌ 失败');
    console.log('  平台:', result.platform || platform);
    console.log('  图片数量:', result.images ? result.images.length : 0);
    console.log('  耗时:', duration, '秒');
    console.log('='.repeat(80));

    // 返回结果
    return res.json({
      ...result,
      duration: parseFloat(duration)
    });

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.error('='.repeat(80));
    console.error('❌ 图片提取失败');
    console.error('  错误:', error.message);
    console.error('  耗时:', duration, '秒');
    console.error('='.repeat(80));

    return res.status(500).json({
      success: false,
      message: 'image_extract_failed',
      error: error.message,
      images: [],
      duration: parseFloat(duration)
    });
  }
}

/**
 * 解析 URL - 兼容旧接口
 * 
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 */
async function parseUrlController(req, res) {
  // 复用 extractImageController
  return extractImageController(req, res);
}

module.exports = {
  extractImageController,
  parseUrlController,
  detectPlatform
};
