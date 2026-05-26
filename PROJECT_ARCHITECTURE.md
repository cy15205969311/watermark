# 项目架构文档

## 项目概述

这是一个基于 Vue 3 + Node.js + MySQL + Puppeteer 的图片解析与本地去水印项目。

当前代码主线分为两部分：

- 在线链接解析：针对 818ps / 图怪兽、创客贴、稿定设计、花瓣、Canva 等平台提取主图或多页套图。
- 本地图片去水印：上传本地图片后，通过后端算法处理并保存记录。

## 技术栈

- 前端：Vue 3、Vuex 4、Element Plus、Vite、Axios
- 后端：Node.js、Express、MySQL 8、Puppeteer、puppeteer-extra、Sharp、Cheerio、Multer
- 浏览器能力：支持通过 `PUPPETEER_EXECUTABLE_PATH` 指定本机 Chrome / Chromium

## 当前目录结构

```text
.
├─ client/
│  ├─ src/
│  │  ├─ components/
│  │  │  ├─ DownloadDialog.vue
│  │  │  ├─ HistoryItem.vue
│  │  │  └─ PlatformIcons.vue
│  │  ├─ services/
│  │  │  └─ parseService.js
│  │  ├─ store/
│  │  │  └─ index.js
│  │  ├─ utils/
│  │  │  ├─ api.js
│  │  │  └─ imageProxy.js
│  │  ├─ App.vue
│  │  └─ main.js
│  ├─ index.html
│  ├─ package.json
│  └─ vite.config.js
├─ server/
│  ├─ controllers/
│  │  └─ imageController.js
│  ├─ extractors/
│  │  ├─ 818ps.js
│  │  ├─ canva.js
│  │  ├─ gaoding.js
│  │  └─ huaban.js
│  ├─ routes/
│  │  └─ imageRoutes.js
│  ├─ services/
│  │  ├─ browser-pool.js
│  │  ├─ browser.js
│  │  └─ imageExtractor.js
│  ├─ uploads/
│  ├─ utils/
│  │  ├─ autoScroll.js
│  │  ├─ browserPool.js
│  │  └─ puppeteer-launch.js
│  ├─ imageExtractor.js
│  ├─ index.js
│  ├─ test-818ps-optimized.js
│  ├─ test-extractors.js
│  ├─ test-gaoding.js
│  ├─ thirdPartyApiGateway.js
│  ├─ watermark-config.js
│  └─ watermarkRemoval.js
├─ database/
│  ├─ schema.sql
│  ├─ update-status-field.sql
│  └─ update-thumbnail-field.sql
├─ 818PS_EXTRACTION_LOGIC.md
├─ DOCS_INDEX.md
├─ PLATFORM_EXTRACTION_LOGIC_FOR_PYTHON.md
├─ README.md
└─ PROJECT_ARCHITECTURE.md
```

## 后端分层

### 1. API 入口

- `server/index.js`
  - 服务启动与环境变量加载
  - `/api/extract-image`、`/api/parse`、`/api/history` 等接口
  - 图片代理 `/api/proxy-image`
  - 数据库连接与历史记录持久化

### 2. 提取总入口

- `server/imageExtractor.js`
  - 平台识别与统一分发
  - 第三方网关与本地 extractor 的调用编排
  - 结果归一化为统一结构：`imageUrl`、`thumbnailUrl`、`imageUrls`、`pages`、`pageCount`、`isMultiPage`

### 3. 平台提取器

- `server/extractors/818ps.js`
  - 图怪兽 / 818ps 的分享页、静态页、动态分页提取
- `server/extractors/gaoding.js`
  - 稿定分享页 HTML、设计稿 JSON、动态网络与可见 DOM 多层提取
- `server/extractors/huaban.js`
  - 花瓣公开 API 提取与 `preview_image` / `preview_only` 状态处理
- `server/extractors/canva.js`
  - Canva 设计图提取

### 4. 浏览器服务

- `server/services/browser.js`
  - 浏览器级抓取逻辑
- `server/services/browser-pool.js`
  - 浏览器实例池与复用
- `server/utils/puppeteer-launch.js`
  - 统一处理 Puppeteer 启动参数和浏览器路径

### 5. 通用提取服务

- `server/services/imageExtractor.js`
  - 偏通用网页图片提取
  - 作为平台提取失败时的补充能力

### 6. 去水印能力

- `server/watermarkRemoval.js`
  - 本地图片去水印核心逻辑
- `server/watermark-config.js`
  - 去水印参数配置

## 前端分层

### 1. 页面与交互

- `client/src/App.vue`
  - URL 提交
  - 提取结果展示
  - 本地上传去水印
  - 历史记录联动

### 2. 状态管理

- `client/src/store/index.js`
  - 历史记录
  - API base URL
  - 结果状态与加载态管理

### 3. 通用工具

- `client/src/utils/api.js`
  - `VITE_API_BASE_URL` 规范化
  - 统一构建前后端 API 地址
- `client/src/utils/imageProxy.js`
  - 将需要代理的图片地址转换为 `/api/proxy-image`

### 4. 展示组件

- `client/src/components/DownloadDialog.vue`
- `client/src/components/HistoryItem.vue`
- `client/src/components/PlatformIcons.vue`

## 关键数据流

### 链接解析

```text
前端提交 URL
  -> POST /api/extract-image
  -> server/index.js
  -> server/imageExtractor.js
  -> 平台 extractor / 第三方网关 / 浏览器补充抓取
  -> normalizeExtractPayload
  -> 返回统一结果给前端
  -> 前端展示并可写入历史记录
```

### 本地去水印

```text
前端上传图片
  -> POST /api/upload-image
  -> server/index.js
  -> watermarkRemoval.js
  -> 输出处理图与元信息
  -> 前端展示处理结果
```

## 当前文档入口建议

- 项目总览与环境配置：`README.md`
- 架构与目录说明：`PROJECT_ARCHITECTURE.md`
- 平台提取链路总览：`PLATFORM_EXTRACTION_LOGIC_FOR_PYTHON.md`
- 818ps 细节说明：`818PS_EXTRACTION_LOGIC.md`

## 文档维护原则

- 当目录结构、接口入口或平台能力变化时，优先同步更新 `README.md` 与 `PROJECT_ARCHITECTURE.md`
- 当某个平台的提取策略发生明显变化时，再更新对应专项文档
- 不再保留已被后续实现文档完全覆盖的早期说明文件
