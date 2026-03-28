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
│  │  ├─ store/               Vuex 状态管理
│  │  └─ App.vue              主页面
│  └─ vite.config.js          前端开发代理配置
├─ server/                    后端项目
│  ├─ extractors/             平台提取器
│  ├─ services/               浏览器与提取相关服务
│  ├─ uploads/                本地上传与处理后的图片
│  ├─ imageExtractor.js       链接提取总入口
│  ├─ index.js                Express 服务入口
│  └─ watermarkRemoval.js     本地去水印逻辑
├─ database/
│  └─ schema.sql              初始数据库结构
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
```

### 代码入口

- 前端主界面：`client/src/App.vue`
- 前端状态管理：`client/src/store/index.js`
- 后端 API：`server/index.js`
- 链接提取总入口：`server/imageExtractor.js`
- 浏览器抓取：`server/services/browser.js`
- 本地去水印：`server/watermarkRemoval.js`

## 常见问题

### 1. 启动后提示 MySQL 连接失败

请检查：

- MySQL 服务是否已启动
- `server/.env` 中的数据库账号密码是否正确
- 数据库 `watermark_remover` 是否已创建

### 2. 前端打不开图片或列表出现空白缩略图

优先检查：

- 后端是否已成功返回真实 `imageUrls/pages`
- 历史记录中是否残留旧数据
- 目标链接是否已经失效或需要登录

说明：

- 当前版本已经对创客贴的统计图、UI 图、无效缩略图做了过滤。

### 3. Puppeteer 启动失败

可以尝试：

- 安装本机 Chrome / Chromium
- 设置 `PUPPETEER_EXECUTABLE_PATH`
- 检查系统是否缺少浏览器依赖

### 4. 本地上传处理后仍然效果不好

建议：

- 优先用 `auto`
- 如果图片结构简单，可试 `advanced`
- 如果更在意速度，可试 `fast`
- 复杂海报类图片一般优先 `hybrid` 或 `auto`

## 注意事项

- 并非所有平台都能保证 100% 获取无水印原图，部分场景只能返回截图或预览图。
- 第三方平台的页面结构经常变化，某些链接可能需要后续适配。
- 本项目会保存解析记录到数据库，也会把本地上传图片保存到 `server/uploads/`。

## License

MIT
