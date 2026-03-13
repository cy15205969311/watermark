/**
 * 提取器测试脚本
 * 
 * 用法：
 * node server/test-extractors.js <platform> <url>
 * 
 * 示例：
 * node server/test-extractors.js 818ps "https://818ps.com/..."
 * node server/test-extractors.js huaban "https://huaban.com/..."
 * node server/test-extractors.js canva "https://canva.com/..."
 */

const { extract818ps } = require('./extractors/818ps');
const { extractHuaban } = require('./extractors/huaban');
const { extractCanva } = require('./extractors/canva');
const { extractImages } = require('./services/imageExtractor');

async function test() {
  const platform = process.argv[2];
  const url = process.argv[3];

  if (!platform || !url) {
    console.error('❌ 请提供平台和 URL');
    console.log('\n用法:');
    console.log('  node server/test-extractors.js <platform> <url>');
    console.log('\n支持的平台:');
    console.log('  - 818ps');
    console.log('  - huaban');
    console.log('  - canva');
    console.log('  - generic (通用)');
    console.log('\n示例:');
    console.log('  node server/test-extractors.js 818ps "https://818ps.com/..."');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('图片提取器测试');
  console.log('='.repeat(80));
  console.log('');
  console.log('平台:', platform);
  console.log('URL:', url);
  console.log('');
  console.log('='.repeat(80));
  console.log('');

  const startTime = Date.now();

  try {
    let result;

    switch (platform.toLowerCase()) {
      case '818ps':
        result = await extract818ps(url);
        break;

      case 'huaban':
        result = await extractHuaban(url);
        break;

      case 'canva':
        result = await extractCanva(url);
        break;

      case 'generic':
        result = await extractImages(url);
        break;

      default:
        throw new Error(`不支持的平台: ${platform}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('');
    console.log('='.repeat(80));
    console.log('测试结果');
    console.log('='.repeat(80));
    console.log('');
    console.log('状态:', result.success ? '✅ 成功' : '❌ 失败');
    console.log('平台:', result.platform || platform);
    console.log('耗时:', duration, '秒');
    console.log('');

    if (result.success) {
      console.log('找到的图片:');
      result.images.forEach((url, index) => {
        console.log(`  ${index + 1}. ${url}`);
      });

      if (result.metadata) {
        console.log('');
        console.log('元数据:');
        console.log('  总共找到:', result.metadata.totalFound || 'N/A');
        console.log('  过滤后:', result.metadata.afterFilter || 'N/A');
        console.log('  去重后:', result.metadata.afterDedup || 'N/A');
        console.log('  最终返回:', result.metadata.results || result.images.length);
      }

      console.log('');
      console.log('JSON 输出:');
      console.log(JSON.stringify({
        success: result.success,
        platform: result.platform || platform,
        images: result.images
      }, null, 2));

    } else {
      console.log('错误:', result.error || result.message);
    }

    console.log('');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('');
    console.error('='.repeat(80));
    console.error('❌ 测试失败');
    console.error('='.repeat(80));
    console.error('');
    console.error('错误信息:', error.message);
    console.error('');
    console.error('堆栈跟踪:');
    console.error(error.stack);
    console.error('');
    console.error('='.repeat(80));
    process.exit(1);
  }
}

// 运行测试
test().catch(error => {
  console.error('未捕获的错误:', error);
  process.exit(1);
});
