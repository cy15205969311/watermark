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
} = require("./watermarkRemoval");

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

    // 生成处理后文件名（添加 -processed 后缀）
    const ext = path.extname(req.file.filename);
    const basename = path.basename(req.file.filename, ext);
    const processedFilename = `${basename}-processed${ext}`;
    const processedPath = path.join(uploadsDir, processedFilename);

    console.log(`[${requestId}] 🎨 开始水印去除处理...`);

    // 选择处理策略（可通过 query 参数切换：?method=fast|advanced）
    const method = req.query.method || "default";
    let result;

    try {
      switch (method) {
        case "fast":
          result = await removeWatermarkFast(uploadedFile, processedPath);
          break;
        case "advanced":
          result = await removeWatermarkAdvanced(uploadedFile, processedPath);
          break;
        default:
          result = await removeWatermark(uploadedFile, processedPath);
      }

      console.log(`[${requestId}] ✅ 水印去除完成，方法: ${result.method}`);

      // 返回处理后的图片 URL
      const processedUrl = `${req.protocol}://${req.get(
        "host"
      )}/uploads/${processedFilename}`;
      const originalUrl = `${req.protocol}://${req.get("host")}/uploads/${
        req.file.filename
      }`;

      res.json({
        success: true,
        imageUrl: processedUrl,
        originalUrl: originalUrl,
        method: result.method,
        message: "水印去除成功",
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
        method: "original",
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
  const { url, platform, thumbnailUrl, status = "success" } = req.body;

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
    let finalThumbnailUrl = thumbnailUrl;

    // 如果是 818ps 链接，尝试提取图片ID
    if (url.includes("818ps.com")) {
      const urlObj = new URL(url);
      const picId = urlObj.searchParams.get("picId");
      if (picId) {
        // 构建真实的图片URL（这里需要根据实际的818ps API调整）
        finalThumbnailUrl = `https://818ps.com/images/${picId}.jpg`;
      }
    }

    const [result] = await pool.query(
      "INSERT INTO parse_records (original_url, platform, thumbnail_url, status) VALUES (?, ?, ?, ?)",
      [url, platform || "Unknown", finalThumbnailUrl, status]
    );

    res.json({
      success: true,
      data: {
        id: result.insertId,
        originalUrl: url,
        platform,
        thumbnailUrl: finalThumbnailUrl,
        status,
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

  if (!platform || typeof platform !== "string") {
    console.error(`[${requestId}] ❌ 缺少或无效的 platform 参数`);
    return res.status(400).json({
      success: false,
      message: "缺少必要参数: platform（必须是字符串）",
      requestId,
    });
  }

  console.log(`[${requestId}] 参数验证通过，平台: ${platform}`);

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
    const result = await extractImage(url, platform);

    console.log(
      `[${requestId}] ✅ 图片提取成功，来源: ${result.source || "unknown"}`
    );

    // 确保向客户端返回统一结构，并包含 textLayers（如果存在）
    const payload = {
      success: true,
      imageUrl: result.imageUrl || null,
      platform: result.platform || null,
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
