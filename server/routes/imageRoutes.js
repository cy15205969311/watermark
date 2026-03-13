/**
 * 图片提取路由
 * 
 * @module imageRoutes
 */

const express = require('express');
const router = express.Router();
const { extractImageController, parseUrlController } = require('../controllers/imageController');

/**
 * POST /api/extract-image
 * 提取图片
 * 
 * Body:
 * {
 *   "url": "https://818ps.com/..."
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "platform": "818ps",
 *   "images": ["url1", "url2", "url3"],
 *   "metadata": {...},
 *   "duration": 5.23
 * }
 */
router.post('/extract-image', extractImageController);

/**
 * POST /api/parse
 * 解析 URL（兼容旧接口）
 * 
 * Body:
 * {
 *   "url": "https://818ps.com/..."
 * }
 */
router.post('/parse', parseUrlController);

module.exports = router;
