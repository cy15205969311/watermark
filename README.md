# 去水印下载助手

一个基于 Vue 3 + Node.js + MySQL + Puppeteer 的图片/设计稿提取与本地去水印项目。

项目当前分成两条主线能力：

- 在线链接解析：从设计平台或内容平台链接中提取真实图片地址，支持单图和多页套图。
- 本地图片去水印：上传本地图片后，按自动或指定算法进行处理，并保存处理记录。

## 功能概览

### 1. 在线链接解析

重点优化的平台：

- 创客贴 `chuangkit.com`
- 818ps / 图怪兽相关链接
- 稿定设计 `gaoding.com` / `gaoding.cn`
- Canva
- 抖音
- 小红书

解析结果统一返回：

- `imageUrl`：主图地址
- `thumbnailUrl`：缩略图/首图地址
- `imageUrls`：全部图片地址
- `pages`：分页信息
- `pageCount`：总页数
- `isMultiPage`：是否为多页

### 2. 本地图片去水印

支持格式：

- PNG
- JPG / JPEG
- WebP

最大上传体积：

- 10 MB

可用算法：

- `auto`：智能自动模式，按检测结果自动选择最佳方案
- `hybrid`：综合处理方案
- `advanced`：高级模式
- `fast`：快速模式

### 3. 历史记录管理

- 保存解析记录到 MySQL
- 支持查看最近 50 条记录
- 支持按链接/平台搜索
- 支持删除记录
- 支持多页结果展示与下载

## 技术栈

### 前端

- Vue 3
- Vuex 4
- Element Plus
- Vite
- Axios

### 后端

- Node.js
- Express
- MySQL 8
- Puppeteer / puppeteer-extra / stealth plugin
- Sharp
- Cheerio
- Multer

## 项目结构

```text
.
├─ client/                    前端项目
│  ├─ src/
│  │  ├─ components/          页面组件
│  │  ├─ services/            前端接口调用
│  │  ├─ store/               Vuex 状态管理
│  │  ├─ utils/               API 与图片代理工具
│  │  └─ App.vue              主页面
│  ├─ package.json
│  └─ vite.config.js          前端开发代理配置
├─ server/                    后端项目
│  ├─ controllers/            控制器
│  ├─ extractors/             平台提取器
│  ├─ routes/                 路由
│  ├─ services/               浏览器与提取相关服务
│  ├─ uploads/                本地上传与处理后的图片
│  ├─ utils/                  浏览器与滚动工具
│  ├─ imageExtractor.js       平台提取总入口
│  ├─ index.js                Express 服务入口
│  └─ watermarkRemoval.js     本地去水印逻辑
├─ database/
│  └─ schema.sql              初始数据库结构
├─ DOCS_INDEX.md              文档索引
├─ PROJECT_ARCHITECTURE.md    架构文档
└─ README.md
```

## 运行环境

- Node.js 18 及以上
- MySQL 8 及以上
- 能正常启动 Puppeteer 的 Chrome / Chromium 环境

如果 Puppeteer 无法自动找到浏览器，可以通过环境变量指定：

- `PUPPETEER_EXECUTABLE_PATH`

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/cy15205969311/watermark.git
cd watermark
```

### 2. 初始化数据库

```bash
mysql -u root -p < database/schema.sql
```

默认数据库名：

- `watermark_remover`

说明：

- 项目启动时会自动检查并补齐 `parse_records` 表中的多页字段：
  - `image_urls_json`
  - `pages_json`
  - `page_count`
  - `is_multi_page`

### 3. 配置后端环境变量

在 `server/` 目录下创建 `.env`：

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=watermark_remover
PORT=3000

# 可选
PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

补充说明：

- `server/.env` 已被 `.gitignore` 忽略，迁移到新目录或新机器后需要手动复制/重新创建。
- 服务启动时会按顺序尝试加载：`.env.production`、`.env`、`.env.local`、`.env.<NODE_ENV>`、`.env.<NODE_ENV>.local`。
- 已经存在的系统环境变量不会被覆盖；本地开发建议至少保留一个可用的 `server/.env`。

### 4. 安装依赖

后端：

```bash
cd server
npm install
```

前端：

```bash
cd ../client
npm install
```

### 5. 启动项目

启动后端：

```bash
cd server
npm start
```

开发模式：

```bash
cd server
npm run dev
```

启动前端：

```bash
cd client
npm run dev
```

默认访问地址：

- 前端：http://localhost:5173
- 后端：http://localhost:3000

前端开发环境已通过 `client/vite.config.js` 代理 `/api` 到 `http://localhost:3000`。

## 主要接口

### 1. 提取在线图片

`POST /api/extract-image`

请求体：

```json
{
  "url": "https://www.chuangkit.com/sharedesign?d=xxx",
  "platform": "Unknown"
}
```

成功响应示例：

```json
{
  "success": true,
  "platform": "Chuangkit",
  "source": "puppeteer-url",
  "imageUrl": "https://example.com/1.png",
  "thumbnailUrl": "https://example.com/1.png",
  "imageUrls": [
    "https://example.com/1.png",
    "https://example.com/2.png"
  ],
  "pages": [
    { "page": 1, "imageUrl": "https://example.com/1.png" },
    { "page": 2, "imageUrl": "https://example.com/2.png" }
  ],
  "pageCount": 2,
  "isMultiPage": true,
  "images": [
    "https://example.com/1.png",
    "https://example.com/2.png"
  ]
}
```

说明：

- 某些平台在兜底模式下可能返回 `data:image/...` 的截图结果。
- 后端会尽量过滤统计图、跟踪图、无效缩略图等脏资源。

### 2. 保存解析记录

`POST /api/parse`

请求体示例：

```json
{
  "url": "https://www.chuangkit.com/sharedesign?d=xxx",
  "platform": "Chuangkit",
  "thumbnailUrl": "https://example.com/1.png",
  "imageUrl": "https://example.com/1.png",
  "imageUrls": [
    "https://example.com/1.png",
    "https://example.com/2.png"
  ],
  "pages": [
    { "page": 1, "imageUrl": "https://example.com/1.png" },
    { "page": 2, "imageUrl": "https://example.com/2.png" }
  ],
  "pageCount": 2,
  "isMultiPage": true,
  "status": "success"
}
```

### 3. 获取历史记录

`GET /api/history`

### 4. 搜索历史记录

`GET /api/history/search?query=关键词`

### 5. 删除历史记录

`DELETE /api/history/:id`

### 6. 本地图片去水印

`POST /api/upload-image?method=auto`

表单字段：

- `image`：上传文件

`method` 可选值：

- `auto`
- `hybrid`
- `advanced`
- `fast`

成功响应示例：

```json
{
  "success": true,
  "imageUrl": "http://localhost:3000/uploads/xxx-processed.jpg",
  "originalUrl": "http://localhost:3000/uploads/xxx.jpg",
  "requestedMethod": "auto",
  "requestedMethodLabel": "智能自动",
  "method": "advanced",
  "methodLabel": "高级模式",
  "fallbackUsed": false,
  "attemptedMethods": [],
  "detection": {},
  "qualityScore": 87,
  "selectionReason": "通过质量检查，亮度和细节保持稳定",
  "outputFormat": "jpeg",
  "message": "已使用高级模式完成去水印"
}
```

## 当前实现特点

### 创客贴

- 支持分享链接抓取
- 支持多页结果返回
- 增强了网络响应抓取、DOM 候选收集、缩略图遍历和脏资源过滤
- 会过滤统计图、UI 图标、无效 SVG 等资源

### 818ps / 图怪兽

- 支持多页设计稿提取
- 返回稳定的 `imageUrls/pages/pageCount`
- 优先走更完整的分享页和套图提取逻辑

### 稿定设计

- 支持 `gaoding.com` / `gaoding.cn` 分享链接识别
- 自动清理分享文案 fragment，例如 `#我分享了...`
- 优先从分享页 HTML 中提取 `source_preview_info`、`preview_info` 和 `extends_previews`
- 当分享页 HTML 只有单张封面图时，会继续尝试动态页面与网络响应分析，避免多页套图被误判为单图
- 当分享页存在 `design_info.url` 时，会继续拉取设计稿 JSON，并兼容 `pages[]` / `layouts[]` 两类结构，挑选整页预览图作为兜底结果
- 支持多页套图返回，统一输出 `imageUrls/pages/pageCount`
- 对稿定 / `dancf.com` 图片链接自动移除 `x-oss-process`，避免 OSS 处理参数导致资源失效
- 会过滤尺寸明显异常的局部元素小图，避免“提取成功但主图黑屏/细条图”的误判

### 本地去水印

- 增加了自动模式质量评估
- 会根据检测结果在多种方案中选择更稳的输出
- 指定模式失败时，可自动回退到智能模式

## 开发说明

### 常用命令

前端：

```bash
cd client
npm run dev
npm run build
npm run preview
```

后端：

```bash
cd server
npm start
npm run dev
node test-gaoding.js
```

### 代码入口

- 前端主界面：`client/src/App.vue`
- 前端状态管理：`client/src/store/index.js`
- 前端 API 地址工具：`client/src/utils/api.js`
- 前端图片代理工具：`client/src/utils/imageProxy.js`
- 后端 API：`server/index.js`
- 链接提取总入口：`server/imageExtractor.js`
- 稿定提取器：`server/extractors/gaoding.js`
- 稿定本地验证：`server/test-gaoding.js`
- 浏览器抓取：`server/services/browser.js`
- 浏览器池：`server/services/browser-pool.js`
- Puppeteer 启动参数工具：`server/utils/puppeteer-launch.js`
- 本地去水印：`server/watermarkRemoval.js`

### 文档入口

- 文档索引：`DOCS_INDEX.md`
- 架构文档：`PROJECT_ARCHITECTURE.md`
- 平台提取总览：`PLATFORM_EXTRACTION_LOGIC_FOR_PYTHON.md`
- 818ps 专项说明：`818PS_EXTRACTION_LOGIC.md`

## 常见问题

### 1. 启动后提示 MySQL 连接失败

请检查：

- MySQL 服务是否已启动
- `server/.env` 中的数据库账号密码是否正确
- 数据库 `watermark_remover` 是否已创建
- 如果项目刚移动过目录，确认新的 `server/` 目录下仍然存在 `.env`；缺失时会导致数据库用户名/密码为空

### 2. 前端打不开图片或列表出现空白缩略图

优先检查：

- 后端是否已成功返回真实 `imageUrls/pages`
- 历史记录中是否残留旧数据
- 目标链接是否已经失效或需要登录

说明：

- 当前版本已经对创客贴的统计图、UI 图、无效缩略图做了过滤。

### 3. 稿定分享链接只返回单图或取不到整套图

优先检查：

- 输入链接是否为公开分享链接，而不是需要登录的编辑页
- 链接中的 `#我分享了...` 之类 fragment 是否已被清理
- 分享页 HTML 中是否仍存在 `source_preview_info`、`preview_info`、`extends_previews`
- 分享页是否提供了 `design_info.url`，以及对应设计稿 JSON 是否仍可访问
- 图片直链中的 `auth_key` 是否已经过期

说明：

- 当前版本会依次尝试：分享页 HTML 多图信息 -> 设计稿 JSON 多页兜底 -> 动态页面与网络响应分析
- 如果静态页只拿到 1 张候选图，提取器不会立刻结束，而是继续尝试动态抓取以恢复套图结果
- 如果日志里显示成功但页面预览是黑块、细长条或极小 PNG，优先排查是否命中了局部元素图；当前版本已经对这类非整页资源做了额外过滤
- 如果分享页结构、设计稿 JSON 和动态请求都发生变化，最终才会回退到单图候选

### 4. Puppeteer 启动失败

可以尝试：

- 安装本机 Chrome / Chromium
- 设置 `PUPPETEER_EXECUTABLE_PATH`
- 检查系统是否缺少浏览器依赖

### 5. 本地上传处理后仍然效果不好

建议：

- 优先用 `auto`
- 如果图片结构简单，可试 `advanced`
- 如果更在意速度，可试 `fast`
- 复杂海报类图片一般优先 `hybrid` 或 `auto`

## 注意事项

- 并非所有平台都能保证 100% 获取无水印原图，部分场景只能返回截图或预览图。
- 第三方平台的页面结构经常变化，某些链接可能需要后续适配。
- 本项目会保存解析记录到数据库，也会把本地上传图片保存到 `server/uploads/`。

## 2026-04 开发补充

### 花瓣（Huaban）链路说明

- 已支持识别 `huaban.com`、`api.huaban.com`、`huabanimg.com` 相关链接。
- 花瓣提取器优先走公开 API，不再依赖第三方网关。
- 对于单个 `pin` 链接，若公开接口只能返回带水印预览图，也会按可展示结果返回，不再强制判定为失败。
- 返回状态新增：
  - `success`：拿到可直接使用的图片地址
  - `preview_image`：拿到可展示/可下载的公开预览图，可能带平台水印
  - `preview_only`：仅确认目标存在公开预览说明，但没有拿到可直接展示的图片地址
  - `processing` / `expired`：保留原有状态语义

### 花瓣图片代理

- 新增接口：`GET /api/proxy-image?url=<image-url>`
- 目前该接口用于代理 `*.huabanimg.com` 图片请求，服务端会自动补齐花瓣所需的 `Referer` / `Origin`，解决前端直接预览时被防盗链拦截的问题。
- 前端历史记录、查看结果弹窗、缩略图和下载入口，在命中花瓣图片时会自动切换到该代理地址。
- 如果后续要扩展到其他有防盗链的平台，可在 `server/index.js` 中继续扩展 `IMAGE_PROXY_ALLOWED_HOSTS`。

### 数据库兼容说明

- `parse_records.status` 现在建议使用 `VARCHAR(32)`，以支持 `preview_image` 和 `preview_only`。
- 服务启动时会自动检查并补齐以下字段或兼容调整：
  - `image_urls_json`
  - `pages_json`
  - `page_count`
  - `is_multi_page`
  - `status` 列类型从旧 `ENUM` 自动调整为 `VARCHAR(32)`
- 如果需要手动迁移，可执行：

```bash
mysql -u root -p < database/update-status-field.sql
```

### 本次开发涉及的核心文件

- 前端入口：`client/src/App.vue`
- 前端状态归一化：`client/src/store/index.js`
- 前端花瓣图片代理转换：`client/src/utils/imageProxy.js`
- 花瓣提取器：`server/extractors/huaban.js`
- 提取总入口：`server/imageExtractor.js`
- API 与图片代理：`server/index.js`
- 平台识别补充：`server/controllers/imageController.js`

### 联调与验证

建议在提交前至少执行：

```bash
cd server
node --check index.js
node --check imageExtractor.js
node --check extractors/huaban.js

cd ../client
npm run build
```

### 调试建议

- 如果日志里已经看到 `Huaban extractor hit` 且状态是 `preview_image`，但浏览器仍显示“图片加载失败”，优先检查是否已经重启后端，使 `/api/proxy-image` 生效。
- 如果历史记录里仍是旧的直链缩略图，刷新前端页面后会按最新逻辑重新走代理地址显示。
- 对于花瓣素材，当前目标是“能展示/能下载公开预览图即可”；如果平台只公开带水印预览图，这是预期行为，不再视为异常。

## License

MIT
