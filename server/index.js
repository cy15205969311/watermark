// 兼容性补丁：在较老的 Node 版本（如 Node 18）中，第三方库（如 undici）
// 可能会假设全局存在 Web API 的 `File`/`Blob` 构造函数，
// 导致 `ReferenceError: File is not defined`。在应用启动时提前提供
// 一个最小占位实现可以避免模块加载时抛错（不改变真实运行时行为）。
if (typeof global.File === "undefined") {
  global.File = class File extends Buffer {};
}
if (typeof global.Blob === "undefined") {
  // Blob 用作占位，不实现完整功能，仅防止模块加载错误
  global.Blob = class Blob {
    constructor(parts = []) {
      this.parts = parts;
    }
  };
}

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
require("dotenv").config();
const { extractImage } = require("./imageExtractor");
const {
  initDefaultPool,
  closeDefaultPool,
} = require("./services/browser-pool");

const app = express();
let PORT = parseInt(process.env.PORT || 3000);

// 中间件 - 增强 CORS 配置
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// 静态托管 uploads 目录（上传的图片将保存在这里）
const path = require("path");
const fs = require("fs");
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

// 简单文件上传：使用 multer 保存文件到 uploads
const multer = require("multer");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const name =
      Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// 引入水印去除模块
const {
  removeWatermark,
  removeWatermarkAdvanced,
  removeWatermarkFast,
  removeWatermarkAuto,
} = require("./watermarkRemoval");

const LOCAL_UPLOAD_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function normalizeLocalWatermarkMethod(method) {
  const normalized = String(method || "auto").toLowerCase();

  if (normalized === "default") {
    return "hybrid";
  }

  if (["auto", "hybrid", "advanced", "fast"].includes(normalized)) {
    return normalized;
  }

  return "auto";
}

function getLocalWatermarkMethodLabel(method) {
  switch (normalizeLocalWatermarkMethod(method)) {
    case "hybrid":
      return "Hybrid方案";
    case "advanced":
      return "高级模式";
    case "fast":
      return "快速模式";
    case "auto":
      return "智能自动";
    default:
      return "原图";
  }
}

async function safeDeleteUploadedFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore cleanup failures.
  }
}

async function runLocalWatermarkRemoval(method, inputPath, outputPath) {
  switch (normalizeLocalWatermarkMethod(method)) {
    case "fast":
      return removeWatermarkFast(inputPath, outputPath);
    case "advanced":
      return removeWatermarkAdvanced(inputPath, outputPath);
    case "hybrid":
      return removeWatermark(inputPath, outputPath);
    case "auto":
    default:
      return removeWatermarkAuto(inputPath, outputPath);
  }
}

// 上传并智能去水印
app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`\n[${requestId}] 📤 收到图片上传请求`);

  try {
    if (!req.file) {
      console.error(`[${requestId}] ❌ 没有上传文件`);
      return res.status(400).json({ success: false, message: "没有上传文件" });
    }

    const uploadedFile = req.file.path;
    console.log(`[${requestId}] 📁 原始文件: ${req.file.filename}`);

    if (!LOCAL_UPLOAD_IMAGE_MIME_TYPES.has(String(req.file.mimetype || "").toLowerCase())) {
      console.error(`[${requestId}] ❌ 不支持的图片格式: ${req.file.mimetype}`);
      await safeDeleteUploadedFile(uploadedFile);
      return res.status(400).json({
        success: false,
        message: "仅支持 PNG/JPG/WebP 图片",
      });
    }

    // 生成处理后文件名（添加 -processed 后缀）
    const ext = path.extname(req.file.filename);
    const basename = path.basename(req.file.filename, ext);
    const processedFilename = `${basename}-processed${ext}`;
    const processedPath = path.join(uploadsDir, processedFilename);

    console.log(`[${requestId}] 🎨 开始水印去除处理...`);

    // 选择处理策略（可通过 query 参数切换：?method=auto|hybrid|advanced|fast）
    const requestedMethod = normalizeLocalWatermarkMethod(req.query.method);
    let result;

    try {
      result = await runLocalWatermarkRemoval(
        requestedMethod,
        uploadedFile,
        processedPath
      );

      if (
        requestedMethod !== "auto" &&
        (!result || result.success === false || result.method === "original")
      ) {
        console.warn(
          `[${requestId}] ⚠️ 指定模式 ${requestedMethod} 处理效果不可用，自动回退到智能模式`
        );
        result = await removeWatermarkAuto(uploadedFile, processedPath);
        result = {
          ...result,
          fallbackUsed: true,
          requestedMethod,
        };
      }

      console.log(
        `[${requestId}] ✅ 水印去除完成，请求模式: ${requestedMethod}，实际方法: ${result.method}`
      );

      // 返回处理后的图片 URL
      const processedUrl = `${req.protocol}://${req.get(
        "host"
      )}/uploads/${processedFilename}`;
      const originalUrl = `${req.protocol}://${req.get("host")}/uploads/${
        req.file.filename
      }`;

      const actualMethod = result && result.method ? result.method : "original";
      const requestedLabel = getLocalWatermarkMethodLabel(requestedMethod);
      const actualLabel =
        result && result.label
          ? result.label
          : actualMethod === "original"
            ? "原图"
            : getLocalWatermarkMethodLabel(actualMethod);
      const responseMessage =
        actualMethod === "original"
          ? result && result.message
            ? result.message
            : "去水印失败，已返回原图"
          : result && result.fallbackUsed
            ? `已从 ${requestedLabel} 自动回退到 ${actualLabel}`
            : `已使用 ${actualLabel} 完成去水印`;

      res.json({
        success: true,
        imageUrl: actualMethod === "original" ? originalUrl : processedUrl,
        originalUrl: originalUrl,
        requestedMethod,
        requestedMethodLabel: requestedLabel,
        method: actualMethod,
        methodLabel: actualLabel,
        fallbackUsed: Boolean(result && result.fallbackUsed),
        attemptedMethods:
          result && Array.isArray(result.attemptedMethods)
            ? result.attemptedMethods
            : [],
        detection: result && result.detection ? result.detection : null,
        qualityScore:
          result && Number.isFinite(result.qualityScore)
            ? result.qualityScore
            : null,
        selectionReason:
          result && result.selectionReason ? result.selectionReason : null,
        outputFormat: result && result.outputFormat ? result.outputFormat : null,
        message: responseMessage,
      });
    } catch (processError) {
      console.error(
        `[${requestId}] ⚠️ 水印去除失败，返回原图:`,
        processError.message
      );

      // 失败时返回原图
      const originalUrl = `${req.protocol}://${req.get("host")}/uploads/${
        req.file.filename
      }`;
      res.json({
        success: true,
        imageUrl: originalUrl,
        originalUrl,
        requestedMethod,
        method: "original",
        methodLabel: "原图",
        message: "水印去除失败，返回原图",
      });
    }
  } catch (err) {
    console.error(`[${requestId}] ❌ 上传失败:`, err);
    res
      .status(500)
      .json({ success: false, message: "上传失败: " + err.message });
  }
});

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (Object.keys(req.body).length > 0) {
    console.log("  请求体:", JSON.stringify(req.body).substring(0, 200));
  }
  next();
});

// 数据库连接池配置
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// 测试数据库连接
pool
  .getConnection()
  .then((conn) => {
    console.log("✅ 成功连接到 MySQL 数据库");
    conn.release();
  })
  .catch((err) => {
    console.error("❌ 数据库连接失败:", err.message);
  });

// 【新增】初始化浏览器池（支持 Puppeteer 隐身抓取）
ensureParseRecordColumns().catch((err) => {
  console.warn("⚠️ parse_records 多页字段检查失败:", err.message);
});

initDefaultPool()
  .then(() => {
    console.log("✅ 浏览器池初始化成功，已预热 Puppeteer 实例");
  })
  .catch((err) => {
    console.warn(
      "⚠️ 浏览器池初始化失败（非致命错误），将在需要时启动:",
      err.message
    );
  });

// API 路由

// 1. 获取历史记录
function resolvePlatform(url, platform) {
  const normalizedPlatform =
    typeof platform === "string" ? platform.trim() : "";

  if (normalizedPlatform && normalizedPlatform !== "Unknown") {
    return normalizedPlatform;
  }

  const lowerUrl = String(url || "").toLowerCase();

  if (lowerUrl.includes("douyin")) return "抖音";
  if (lowerUrl.includes("kuaishou")) return "快手";
  if (lowerUrl.includes("xiaohongshu") || lowerUrl.includes("xhs")) {
    return "小红书";
  }
  if (lowerUrl.includes("bilibili")) return "Bilibili";
  if (lowerUrl.includes("youtube")) return "YouTube";
  if (lowerUrl.includes("818ps") || lowerUrl.includes("tuguaishou")) {
    return "818ps";
  }
  if (lowerUrl.includes("canva")) return "Canva";

  return normalizedPlatform || "Unknown";
}

function normalizeExtractPayload(result = {}) {
  const urls = [];
  const pages = [];
  const seen = new Set();

  const isBlockedPreviewAssetUrl = (value) => {
    if (typeof value !== "string") {
      return true;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    if (/^data:image\//.test(normalized) || /^blob:/.test(normalized)) {
      return false;
    }

    if (/^https?:\/\/hm\.baidu\.com\/hm\.gif/.test(normalized)) return true;
    if (/googletagmanager|google-analytics|doubleclick|umeng|clarity/.test(normalized)) {
      return true;
    }
    if (/\/distheadless\/img\//.test(normalized)) return true;
    if (/full-screen|fullscreen|favicon|tracker|tracking|pixel/.test(normalized)) {
      return true;
    }

    return false;
  };

  const addUrl = (value) => {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    if (!normalized || isBlockedPreviewAssetUrl(normalized) || seen.has(normalized)) {
      return null;
    }

    seen.add(normalized);
    urls.push(normalized);
    return normalized;
  };

  const addPage = (page, fallbackPageNumber) => {
    const imageUrl = addUrl(page && page.imageUrl);
    if (!imageUrl) {
      return;
    }

    pages.push({
      page: Number(page && page.page) || fallbackPageNumber || pages.length + 1,
      imageUrl,
    });
  };

  (result.pages || []).forEach((page, index) => addPage(page, index + 1));
  (result.imageUrls || []).forEach(addUrl);
  (result.images || []).forEach(addUrl);
  addUrl(result.imageUrl);
  addUrl(result.thumbnailUrl);

  if (!pages.length) {
    urls.forEach((imageUrl, index) => {
      pages.push({
        page: index + 1,
        imageUrl,
      });
    });
  }

  return {
    ...result,
    imageUrl: urls[0] || null,
    thumbnailUrl: result.thumbnailUrl || result.imageUrl || urls[0] || null,
    imageUrls: urls,
    images: urls,
    pages,
    pageCount: Number(result.pageCount) || pages.length || urls.length,
    isMultiPage:
      typeof result.isMultiPage === "boolean"
        ? result.isMultiPage
        : urls.length > 1,
  };
}

async function ensureParseRecordColumns() {
  const requiredColumns = {
    image_urls_json: "LONGTEXT NULL",
    pages_json: "LONGTEXT NULL",
    page_count: "INT NULL DEFAULT 1",
    is_multi_page: "TINYINT(1) NOT NULL DEFAULT 0",
  };

  for (const [columnName, definition] of Object.entries(requiredColumns)) {
    const [rows] = await pool.query(
      "SHOW COLUMNS FROM parse_records LIKE ?",
      [columnName]
    );

    if (!rows.length) {
      await pool.query(
        `ALTER TABLE parse_records ADD COLUMN ${columnName} ${definition}`
      );
    }
  }
}

app.get("/api/history", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM parse_records ORDER BY created_at DESC LIMIT 50"
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "数据库错误" });
  }
});

// 2. 创建新的解析任务
app.post("/api/parse", async (req, res) => {
  const {
    url,
    platform,
    thumbnailUrl,
    imageUrl,
    imageUrls,
    pages,
    pageCount,
    isMultiPage,
    status = "success",
  } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, message: "URL 不能为空" });
  }

  // 验证 URL 格式，避免无效 URL 导致下游抛错或数据库插入失败
  try {
    // 若传入的是非完整 URL（如缺少协议）会抛错，前端应当先行规范化
    new URL(url);
  } catch (err) {
    return res.status(400).json({ success: false, message: "Invalid URL" });
  }

  try {
    // 尝试从URL中提取真实的图片链接
    const resolvedPlatform = resolvePlatform(url, platform);
    const normalizedPayload = normalizeExtractPayload({
      thumbnailUrl,
      imageUrl,
      imageUrls,
      pages,
      pageCount,
      isMultiPage,
    });
    const finalThumbnailUrl = normalizedPayload.thumbnailUrl;
    const finalImageUrls = normalizedPayload.imageUrls || [];
    const finalPages = normalizedPayload.pages || [];
    const finalPageCount = normalizedPayload.pageCount || finalImageUrls.length || 0;
    const finalIsMultiPage =
      typeof normalizedPayload.isMultiPage === "boolean"
        ? normalizedPayload.isMultiPage
        : finalImageUrls.length > 1;

    const [result] = await pool.query(
      "INSERT INTO parse_records (original_url, platform, thumbnail_url, status, image_urls_json, pages_json, page_count, is_multi_page) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        url,
        resolvedPlatform,
        finalThumbnailUrl,
        status,
        JSON.stringify(finalImageUrls),
        JSON.stringify(finalPages),
        finalPageCount,
        finalIsMultiPage ? 1 : 0,
      ]
    );

    res.json({
      success: true,
      data: {
        id: result.insertId,
        originalUrl: url,
        original_url: url,
        platform: resolvedPlatform,
        thumbnailUrl: finalThumbnailUrl,
        thumbnail_url: finalThumbnailUrl,
        imageUrl: normalizedPayload.imageUrl || finalThumbnailUrl || null,
        imageUrls: finalImageUrls,
        image_urls_json: JSON.stringify(finalImageUrls),
        pages: finalPages,
        pages_json: JSON.stringify(finalPages),
        pageCount: finalPageCount,
        page_count: finalPageCount,
        isMultiPage: finalIsMultiPage,
        is_multi_page: finalIsMultiPage ? 1 : 0,
        status,
        created_at: new Date().toISOString(),
        timestamp: new Date().toLocaleString("zh-CN", { hour12: false }),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "保存记录失败" });
  }
});

// 3. 删除记录
app.delete("/api/history/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM parse_records WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "记录已删除" });
  } catch (error) {
    res.status(500).json({ success: false, message: "数据库错误" });
  }
});

// 4. 搜索记录
app.get("/api/history/search", async (req, res) => {
  const { query } = req.query;
  try {
    const [rows] = await pool.query(
      "SELECT * FROM parse_records WHERE original_url LIKE ? OR platform LIKE ? ORDER BY created_at DESC",
      [`%${query}%`, `%${query}%`]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "搜索失败" });
  }
});

// 5. 解析真实图片URL（代理服务）- 架构级优化版本
// 优先使用第三方 API，本地提取作为补充
app.post("/api/extract-image", async (req, res) => {
  const { url, platform } = req.body;
  const requestId = Math.random().toString(36).substring(7);

  console.log(`\n[${requestId}] 📥 新请求: POST /api/extract-image`);

  // 详细的输入验证
  if (!url || typeof url !== "string") {
    console.error(`[${requestId}] ❌ 缺少或无效的 url 参数`);
    return res.status(400).json({
      success: false,
      message: "缺少必要参数: url（必须是字符串）",
      requestId,
    });
  }

  const resolvedPlatform = resolvePlatform(url, platform);
  console.log(`[${requestId}] 参数验证通过，平台: ${resolvedPlatform}`);

  try {
    // 验证 URL 格式
    try {
      new URL(url);
    } catch (err) {
      console.error(`[${requestId}] ❌ URL 格式无效`);
      return res.status(400).json({
        success: false,
        message: "URL 格式无效，请提供完整的 http:// 或 https:// URL",
        requestId,
      });
    }

    // 使用图片提取服务（架构级优化：优先第三方 API）
    console.log(`[${requestId}] 🔍 调用 extractImage 服务...`);
    console.log(`[${requestId}] 🔍 调用 extractImage 服务...`);
    const result = normalizeExtractPayload(
      await extractImage(url, resolvedPlatform)
    );

    console.log(
      `[${requestId}] ✅ 图片提取成功，来源: ${result.source || "unknown"}`
    );

    // 确保向客户端返回统一结构，并包含 textLayers（如果存在）
    const payload = {
      success: true,
      imageUrl: result.imageUrl || null,
      thumbnailUrl: result.thumbnailUrl || result.imageUrl || null,
      imageUrls: result.imageUrls || [],
      pages: result.pages || [],
      pageCount: result.pageCount || 0,
      isMultiPage: Boolean(result.isMultiPage),
      images: result.images || result.imageUrls || [],
      platform: result.platform || resolvedPlatform || null,
      source: result.source || null,
    };
    // 透传提醒标记（用于前端弹窗/Toast）
    if (result.noticeCode) payload.noticeCode = result.noticeCode;
    if (result.message) payload.message = result.message;
    if (result.quality) payload.quality = result.quality;
    if (result.textLayers) payload.textLayers = result.textLayers;
    res.json(payload);
  } catch (error) {
    console.error(`[${requestId}] ❌ 提取图片失败`);
    console.error(`[${requestId}] 错误: ${error.message}`);

    // 更友好的错误消息
    let userMessage = error.message;
    if (userMessage.includes("第三方 API")) {
      userMessage = "无法通过任何方式提取图片，请检查链接是否有效";
    }

    res.status(400).json({
      success: false,
      message: userMessage,
      error: error.message,
      requestId,
    });
  }
});

// 启动服务器，支持端口自动递增（解决 EADDRINUSE）
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n🚀 服务器运行在 http://localhost:${port}`);
    console.log(`📡 API 地址: http://localhost:${port}/api`);
    console.log(`\n✅ 服务已启动，等待请求...\n`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ 端口 ${port} 已被占用，尝试使用端口 ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error(`❌ 服务器错误:`, err);
      process.exit(1);
    }
  });

  // 【新增】优雅关闭：清理浏览器池资源
  process.on("SIGINT", async () => {
    console.log("\n🛑 收到 SIGINT 信号，正在优雅关闭...");
    await closeDefaultPool();
    console.log("✅ 浏览器池已关闭");
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n🛑 收到 SIGTERM 信号，正在优雅关闭...");
    await closeDefaultPool();
    console.log("✅ 浏览器池已关闭");
    process.exit(0);
  });
}

startServer(PORT);
