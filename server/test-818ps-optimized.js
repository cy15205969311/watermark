/**
 * 测试 818ps 优化版提取器
 * 
 * 测试点：
 * 1. 全量提取（不只是主图）
 * 2. CSS background-image 提取
 * 3. 正则清洗（移除后缀）
 * 4. 去重
 * 5. 反爬避让（User-Agent 随机化）
 */

const { extract818ps } = require('./extractors/818ps');
const { redact } = require('./extractors/818ps-pages');
const { closeDefaultPool } = require('./services/browser-pool');

// 测试 URL（请替换为实际的 818ps 页面 URL）
const TEST_URL = process.argv[2] || 'https://818ps.com/tpl/xxxxx';

/**
 * 运行测试
 */
async function runTest() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  818ps 优化版提取器测试                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');

  const startTime = Date.now();

  try {
    const result = await extract818ps(TEST_URL, {
      headless: true,
      timeout: 20000
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  测试结果                                                      ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('  状态:', result.success ? '✅ 成功' : '❌ 失败');
    console.log('  平台:', result.platform);
    console.log('  耗时:', duration, '秒');
    console.log('');

    if (result.success && result.images.length > 0) {
      console.log('  📊 统计信息:');
      console.log('    - 检测到图片:', result.metadata.results);
      console.log('    - 清洗后图片:', result.collectedPageCount);
      console.log('    - 去重后图片:', result.pageCount);
      console.log('    - 最终返回:', result.images.length);
      console.log('');

      console.log('  📷 提取到的图片:');
      result.images.forEach((img, index) => {
        console.log(`    ${index + 1}. ${redact(img)}`);
      });
      console.log('');

      // 验证结果
      console.log('  ✅ 验证:');
      console.log(`    ${result.images.length >= 1 ? '✅' : '❌'} 至少返回 1 张图片`);
      console.log(`    ${result.images.every(url => url.includes('tuguaishou.com')) ? '✅' : '❌'} 所有图片来自 tuguaishou.com`);
      console.log(`    ${result.images.every(url => !url.includes('base64')) ? '✅' : '❌'} 没有 base64 图片`);
      console.log(`    ${result.images.every(url => !url.includes('placeholder')) ? '✅' : '❌'} 没有 placeholder 图片`);
      console.log('    保留已验证的 CDN 处理后缀与授权参数');
      console.log('');

      // 检查是否有重复
      const uniqueCheck = new Set(result.images);
      console.log(`    ${uniqueCheck.size === result.images.length ? '✅' : '❌'} 没有重复图片`);
      console.log('');

    } else {
      console.log('  ❌ 提取失败:', result.message || result.error);
      console.log('');
    }

    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  测试完成                                                      ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    console.log("完整性 / 动画:", result.completenessStatus, result.expectedPageCount, result.missingPages, result.animationStatus, result.frameCount, result.durationMs, result.resourceRole);
    console.log("原始资源 / 下载 / 水印:", result.originalResourceStatus, result.downloadStatus, result.hasVisibleWatermark, result.selectionReason);
    await closeDefaultPool();
    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('');
    console.error('╔════════════════════════════════════════════════════════════════╗');
    console.error('║  测试失败                                                      ║');
    console.error('╚════════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('  ❌ 错误:', error.message);
    console.error('');
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  console.log('');
  console.log('使用方法:');
  console.log('  node test-818ps-optimized.js <URL>');
  console.log('');
  console.log('示例:');
  console.log('  node test-818ps-optimized.js https://818ps.com/tpl/xxxxx');
  console.log('');

  runTest().catch(error => {
    console.error('❌ 测试运行失败:', error);
    process.exit(1);
  });
}

module.exports = { runTest };
