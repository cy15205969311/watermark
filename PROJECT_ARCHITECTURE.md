# 项目架构文档

## 项目概述

这是一个基于 Node.js 的图片解析与去水印系统，支持从多个设计平台（818ps/图怪兽、花瓣、Canva 等）提取无水印原图，并提供高级水印去除功能。

## 技术栈

- **后端框架**: Express.js
- **数据库**: MySQL
- **浏览器自动化**: Puppeteer
- **图像处理**: Sharp, Canvas, OpenCV
- **前端**: Vue.js 3 + Vite
- **部署**: Railway, Vercel

---

## 项目结构

```
project-root/
├── client/                    # 前端项目
│   ├── src/
│   │   ├── components/       # Vue 组件
│   │   ├── services/         # API 服务
│   │   ├── store/            # 状态管理
│   │   ├── App.vue           # 根组件
│   │   └── main.js           # 入口文件
│   ├── public/               # 静态资源
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── server/                    # 后端项目
│   ├── controllers/          # 控制器层
│   ├── routes/               # 路由层
│   ├── services/             # 服务层
│   ├── extractors/           # 平台提取器
│   ├── utils/                # 工具函数
│   ├── uploads/              # 上传文件目录
│   ├── chrome/               # Puppeteer Chrome
│   ├── index.js              # 服务器入口
│   └── package.json
│
├── database/                  # 数据库脚本
│   ├── schema.sql            # 数据库结构
│   └── update-*.sql          # 更新脚本
│
└── docs/                      # 文档目录
    ├── README.md
    ├── 818PS_USAGE_GUIDE.md
    ├── EXTRACTOR_README.md
    └── ...
```

---

## 核心模块详解

### 1. 后端服务器 (server/)

#### 1.1 入口文件
- **`index.js`**: Express 服务器主入口
  - 配置中间件（CORS、body-parser、multer）
  - 注册路由
  - 启动服务器
  - 端口：3000

#### 1.2 控制器层 (controllers/)
- **`imageController.js`**: 图片提取控制器
  - `extractImageController()`: 统一图片提取入口
  - `parseUrlController()`: 兼容旧接口
  - `detectPlatform()`: 自动检测平台类型

#### 1.3 路由层 (routes/)
- **`imageRoutes.js`**: 图片相关路由
  - `POST /api/extract-image`: 提取图片
  - `POST /api/parse`: 解析 URL（兼容）
  - `GET /api/history`: 获取历史记录

#### 1.4 服务层 (services/)

**核心服务：**

- **`imageExtractor.js`**: 通用图片提取服务
  - `extractImages()`: 通用提取函数
  - `extractAllImageUrls()`: 提取所有图片 URL
  - `filterImageUrls()`: 过滤无效图片
  - `deduplicateUrls()`: 去重处理
  - 支持：img 标签、CSS background-image、懒加载

- **`browser.js`**: 浏览器管理服务
  - 启动和管理 Puppeteer 浏览器实例
  - 配置浏览器参数

- **`browser-pool.js`**: 浏览器池服务
  - 浏览器实例复用
  - 连接池管理（min: 1, max: 3）
  - 性能优化

- **`diagonal-watermark-remover-v2.js`**: 7 阶段水印去除
  - 阶段 1: 全局角度检测
  - 阶段 2: 图像旋转归一化
  - 阶段 3: FFT 频域分析
  - 阶段 4: 纹理衰减
  - 阶段 5: 边缘保持平滑
  - 阶段 6: AI 纹理修复
  - 阶段 7: 逆旋转

---

#### 1.5 平台提取器 (extractors/)

**支持的平台：**

- **`818ps.js`**: 818ps/图怪兽提取器
  - 提取 img 标签（src, data-src, data-original）
  - 提取 CSS background-image（关键！第 4 张图）
  - 自动滚动触发懒加载
  - 过滤规则：只保留 `img.tuguaishou.com`
  - 返回所有图片（不只是主图）

- **`huaban.js`**: 花瓣网提取器
  - 提取花瓣网设计图
  - 域名：`hbimg.huabanimg.com`

- **`canva.js`**: Canva 提取器
  - 提取 Canva 设计图
  - 域名：`cdn.canva.com`

**提取器通用流程：**
```
1. 启动浏览器
2. 访问页面（networkidle2）
3. 自动滚动触发懒加载
4. 等待 1500ms
5. 提取所有图片（img + CSS bg-image）
6. 过滤无效图片
7. 去重
8. 返回结果
```

#### 1.6 工具函数 (utils/)

- **`autoScroll.js`**: 自动滚动工具
  - `autoScroll()`: 标准滚动
  - `quickScroll()`: 快速滚动
  - `smartScroll()`: 智能滚动（根据页面高度）
  - `scrollToElement()`: 滚动到指定元素

- **`browserPool.js`**: 浏览器池工具
  - 浏览器实例管理
  - 连接池配置

---

### 2. 前端应用 (client/)

#### 2.1 组件 (src/components/)

- **`DownloadDialog.vue`**: 下载对话框
  - 显示提取的图片
  - 提供下载功能
  - 平台图标显示

- **`HistoryItem.vue`**: 历史记录项
  - 显示单条历史记录
  - 缩略图预览
  - 重新下载功能

- **`PlatformIcons.vue`**: 平台图标组件
  - 显示不同平台的图标
  - 支持：818ps、花瓣、Canva

#### 2.2 服务 (src/services/)

- **`parseService.js`**: API 调用服务
  - `parseUrl()`: 调用后端解析接口
  - `getHistory()`: 获取历史记录
  - Axios 封装

#### 2.3 状态管理 (src/store/)

- **`index.js`**: Vuex/Pinia 状态管理
  - 全局状态
  - 历史记录管理
  - 用户设置

#### 2.4 主应用

- **`App.vue`**: 根组件
  - URL 输入框
  - 解析按钮
  - 结果展示
  - 历史记录

- **`main.js`**: 应用入口
  - Vue 实例初始化
  - 插件注册
  - 全局配置

---

### 3. 数据库 (database/)

#### 3.1 数据表结构

**`schema.sql`**: 主数据库结构

```sql
-- 历史记录表
CREATE TABLE history (
  id INT PRIMARY KEY AUTO_INCREMENT,
  url VARCHAR(500) NOT NULL,
  platform VARCHAR(50),
  image_url TEXT,
  thumbnail_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户表（如果需要）
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(100),
  email VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 3.2 更新脚本

- **`update-thumbnail-field.sql`**: 添加缩略图字段
  ```sql
  ALTER TABLE history ADD COLUMN thumbnail_url TEXT;
  ```

---

## API 接口文档

### 1. 提取图片

**接口**: `POST /api/extract-image`

**请求体**:
```json
{
  "url": "https://818ps.com/tpl/xxxxx"
}
```

**响应**:
```json
{
  "success": true,
  "platform": "818ps",
  "images": [
    "https://img.tuguaishou.com/xxx1.jpg",
    "https://img.tuguaishou.com/xxx2.jpg",
    "https://img.tuguaishou.com/xxx3.jpg",
    "https://img.tuguaishou.com/xxx4.jpg"
  ],
  "duration": 3.45
}
```

### 2. 解析 URL（兼容旧接口）

**接口**: `POST /api/parse`

**请求体**:
```json
{
  "url": "https://818ps.com/tpl/xxxxx"
}
```

**响应**: 同上

### 3. 获取历史记录

**接口**: `GET /api/history`

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "url": "https://818ps.com/tpl/xxxxx",
      "platform": "818ps",
      "image_url": "https://img.tuguaishou.com/xxx.jpg",
      "thumbnail_url": "https://...",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

## 核心功能流程

### 1. 图片提取流程

```
用户输入 URL
    ↓
前端发送请求 → POST /api/extract-image
    ↓
imageController.extractImageController()
    ↓
detectPlatform() 检测平台
    ↓
根据平台选择提取器：
    - 818ps → extract818ps()
    - 花瓣 → extractHuaban()
    - Canva → extractCanva()
    - 其他 → extractImages()
    ↓
提取器执行：
    1. 启动 Puppeteer 浏览器
    2. 访问页面（networkidle2）
    3. 自动滚动触发懒加载
    4. 提取所有图片（img + CSS bg-image）
    5. 过滤无效图片
    6. 去重
    ↓
返回结果 → 前端展示
```

### 2. 818ps 提取流程（详细）

```
extract818ps(url)
    ↓
1. 启动浏览器
   - Puppeteer.launch()
   - 设置 User-Agent
   - 设置视口 1920x1080
    ↓
2. 访问页面
   - page.goto(url, {waitUntil: 'networkidle2'})
    ↓
3. 自动滚动
   - autoScroll(page)
   - 触发懒加载图片
    ↓
4. 等待加载
   - setTimeout(1500ms)
    ↓
5. 提取图片
   - extractAllImages(page)
     ├─ 提取 <img> 标签
     │  ├─ img.src
     │  ├─ img.dataset.src
     │  └─ img.dataset.original
     └─ 提取 CSS background-image ⭐
        └─ window.getComputedStyle(el).backgroundImage
    ↓
6. 过滤图片
   - filterValidImages(urls)
     ├─ 排除 base64
     ├─ 排除 data URI
     ├─ 排除 SVG
     ├─ 排除 placeholder
     └─ 只保留 img.tuguaishou.com
    ↓
7. 去重
   - deduplicateUrls(urls)
   - 使用 origin + pathname 作为唯一标识
    ↓
8. 返回结果
   - {success: true, platform: "818ps", images: [...]}
```

---

### 3. 水印去除流程（7 阶段）

```
输入：带水印图片
    ↓
阶段 1: 全局角度检测
    - 检测水印的对角线角度
    - 使用边缘检测和线密度分析
    ↓
阶段 2: 图像旋转归一化
    - 旋转图像使水印水平对齐
    ↓
阶段 3: FFT 频域分析
    - 执行快速傅里叶变换
    - 识别周期性水印频率峰值
    - 构建软衰减掩码
    ↓
阶段 4: 纹理衰减
    - 抑制水印频率分量
    - 保留背景结构频率
    ↓
阶段 5: 边缘保持平滑
    - 应用引导滤波
    - 减少低对比度水印残留
    - 不模糊边缘或细节
    ↓
阶段 6: AI 纹理修复
    - 使用纹理感知修复模型（U-Net）
    - 重建剩余伪影
    - 不改变亮度或对比度
    ↓
阶段 7: 逆旋转
    - 旋转图像回原始方向
    ↓
输出：无水印图片
```

---

## 关键技术点

### 1. CSS background-image 提取 ⭐

**问题**: 818ps 页面的第 4 张图片通常不是 `<img>` 标签，而是 CSS `background-image`

**解决方案**:
```javascript
document.querySelectorAll('*').forEach(el => {
  const bg = window.getComputedStyle(el).backgroundImage;
  if (bg && bg !== 'none' && bg.includes('tuguaishou.com')) {
    const match = bg.match(/url\(['"]?([^'"]+)['"]?\)/);
    if (match && match[1]) {
      urls.add(match[1]);
    }
  }
});
```

### 2. 懒加载图片处理

**问题**: 图片使用懒加载，初始不可见

**解决方案**:
1. 自动滚动页面触发懒加载
2. 提取多个属性：`src`, `data-src`, `data-original`
3. 等待 1500ms 确保加载完成

### 3. 浏览器池优化

**问题**: 每次请求都启动新浏览器，性能差

**解决方案**:
- 使用浏览器池复用实例
- 配置：min: 1, max: 3
- 减少启动时间

### 4. 图片过滤策略

**过滤规则**:
- ❌ base64 编码
- ❌ data URI
- ❌ SVG 图片
- ❌ placeholder 占位图
- ✅ 只保留 CDN 图片（img.tuguaishou.com）

---

## 配置文件

### 1. 后端配置

**`server/package.json`**:
```json
{
  "name": "image-extractor-server",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "express": "^4.18.0",
    "puppeteer": "^21.0.0",
    "axios": "^1.6.0",
    "mysql2": "^3.6.0",
    "sharp": "^0.32.0",
    "canvas": "^2.11.0",
    "multer": "^1.4.5",
    "cors": "^2.8.5"
  }
}
```

**环境变量** (`.env`):
```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=password
DB_NAME=image_extractor
NODE_ENV=production
```

### 2. 前端配置

**`client/package.json`**:
```json
{
  "name": "image-extractor-client",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "vue": "^3.3.0",
    "axios": "^1.6.0",
    "vuex": "^4.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^4.5.0",
    "vite": "^5.0.0"
  }
}
```

**`client/vite.config.js`**:
```javascript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
```

### 3. 部署配置

**`railway.json`** (Railway 部署):
```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "cd server && npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**`client/vercel.json`** (Vercel 部署):
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

---

## 部署架构

### 1. 开发环境

```
本地开发
├── 前端: http://localhost:5173 (Vite Dev Server)
├── 后端: http://localhost:3000 (Express Server)
└── 数据库: MySQL (localhost:3306)
```

### 2. 生产环境

```
生产部署
├── 前端: Vercel
│   ├── 域名: https://your-app.vercel.app
│   ├── 自动部署（Git Push）
│   └── CDN 加速
│
├── 后端: Railway
│   ├── 域名: https://your-api.railway.app
│   ├── 自动部署（Git Push）
│   └── 环境变量配置
│
└── 数据库: Railway MySQL
    ├── 内网连接
    └── 自动备份
```

### 3. 部署流程

```
开发 → Git Push → 自动部署
    ↓
GitHub Repository
    ↓
    ├─→ Vercel (前端)
    │   ├─ 构建: npm run build
    │   └─ 部署: 静态文件
    │
    └─→ Railway (后端)
        ├─ 构建: npm install
        ├─ 启动: npm start
        └─ 环境变量注入
```

---

## 性能优化

### 1. 浏览器池优化
- 复用浏览器实例
- 减少启动时间（从 3-5s 降至 0.5s）
- 连接池管理

### 2. 图片提取优化
- 并发提取多个图片
- 智能滚动策略（根据页面高度）
- 超时保护（15s）

### 3. 缓存策略
- 历史记录缓存
- 图片 URL 缓存
- 浏览器实例缓存

### 4. 错误处理
- 超时重试机制
- 降级策略（通用提取器）
- 详细错误日志

---

## 测试

### 1. 测试脚本

**818ps 提取测试**:
```bash
node server/test-818ps-simple.js
node server/test-818ps-all-images.js
```

**通用提取器测试**:
```bash
node server/test-extractors.js
```

**水印去除测试**:
```bash
node server/test-watermark-removal.js
```

### 2. 测试用例

**提取器测试**:
- ✅ 提取所有图片（不只是主图）
- ✅ CSS background-image 提取
- ✅ 懒加载图片提取
- ✅ 过滤无效图片
- ✅ 去重处理

**水印去除测试**:
- ✅ 对角线水印去除
- ✅ 周期性纹理去除
- ✅ 边缘保持
- ✅ 无亮度变化

---

## 常见问题

### 1. 只返回 1 张图片？

**原因**: 代码中存在"主图逻辑"

**解决**: 已修复，现在返回所有图片

### 2. 第 4 张图片提取不到？

**原因**: 第 4 张图通常是 CSS `background-image`

**解决**: 已添加 CSS background-image 提取

### 3. 懒加载图片提取不到？

**原因**: 页面未滚动，懒加载未触发

**解决**: 添加自动滚动功能

### 4. Puppeteer 启动慢？

**原因**: 每次都启动新浏览器

**解决**: 使用浏览器池复用实例

### 5. 图片包含 base64？

**原因**: 未过滤无效图片

**解决**: 添加过滤规则

---

## 文档索引

### 核心文档
- **`README.md`**: 项目总览
- **`PROJECT_ARCHITECTURE.md`**: 项目架构（本文档）
- **`EXTRACTOR_README.md`**: 提取器使用指南
- **`818PS_USAGE_GUIDE.md`**: 818ps 使用指南
- **`INTEGRATION_GUIDE.md`**: 集成指南

### 功能文档
- **`7STAGE_PIPELINE_GUIDE.md`**: 7 阶段水印去除指南
- **`PIPELINE_COMPARISON.md`**: 管道对比
- **`7STAGE_QUICK_REFERENCE.md`**: 快速参考
- **`INDEX_7STAGE.md`**: 7 阶段索引

### 修复文档
- **`818PS_ALL_IMAGES_FIX.md`**: 818ps 全图提取修复
- **`VERIFICATION_CHECKLIST.md`**: 验证清单

---

## 开发指南

### 1. 本地开发

**启动后端**:
```bash
cd server
npm install
npm start
```

**启动前端**:
```bash
cd client
npm install
npm run dev
```

**启动数据库**:
```bash
mysql -u root -p < database/schema.sql
```

### 2. 添加新平台提取器

**步骤**:
1. 在 `server/extractors/` 创建新文件（如 `newplatform.js`）
2. 实现提取函数：
   ```javascript
   async function extractNewPlatform(url, options) {
     // 1. 启动浏览器
     // 2. 访问页面
     // 3. 提取图片
     // 4. 过滤和去重
     // 5. 返回结果
   }
   ```
3. 在 `imageController.js` 中注册平台
4. 添加测试脚本

### 3. 代码规范

**命名规范**:
- 文件名: kebab-case（`image-extractor.js`）
- 函数名: camelCase（`extractImages()`）
- 类名: PascalCase（`ImageExtractor`）
- 常量: UPPER_SNAKE_CASE（`MAX_RETRIES`）

**注释规范**:
```javascript
/**
 * 函数描述
 * 
 * @param {string} url - 参数描述
 * @returns {Promise<Object>} 返回值描述
 */
async function extractImages(url) {
  // 实现
}
```

---

## 技术债务与改进计划

### 当前技术债务
1. ❌ 缺少单元测试覆盖
2. ❌ 错误处理不够完善
3. ❌ 日志系统需要优化
4. ❌ 缺少 API 文档（Swagger）
5. ❌ 前端状态管理需要重构

### 改进计划

**短期（1-2 周）**:
- [ ] 添加单元测试（Jest）
- [ ] 完善错误处理
- [ ] 添加 Winston 日志系统
- [ ] 优化前端性能

**中期（1-2 月）**:
- [ ] 添加 Swagger API 文档
- [ ] 实现 Redis 缓存
- [ ] 添加用户认证系统
- [ ] 支持更多平台

**长期（3-6 月）**:
- [ ] 微服务架构重构
- [ ] 添加 AI 图片识别
- [ ] 实现分布式部署
- [ ] 添加监控和告警

---

## 贡献指南

### 1. 提交代码

**流程**:
```bash
# 1. Fork 项目
# 2. 创建分支
git checkout -b feature/new-feature

# 3. 提交代码
git add .
git commit -m "feat: 添加新功能"

# 4. 推送分支
git push origin feature/new-feature

# 5. 创建 Pull Request
```

**Commit 规范**:
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具

### 2. 报告问题

**Issue 模板**:
```markdown
## 问题描述
简要描述问题

## 复现步骤
1. 步骤 1
2. 步骤 2
3. 步骤 3

## 期望行为
描述期望的行为

## 实际行为
描述实际的行为

## 环境信息
- OS: Windows/Mac/Linux
- Node.js: v18.0.0
- Browser: Chrome 120
```

---

## 安全性

### 1. 输入验证
- URL 格式验证
- 文件类型验证
- 文件大小限制

### 2. 防护措施
- CORS 配置
- Rate Limiting（速率限制）
- SQL 注入防护（参数化查询）
- XSS 防护

### 3. 敏感信息
- 环境变量存储
- 数据库密码加密
- API Key 保护

---

## 监控与日志

### 1. 日志级别
- `ERROR`: 错误日志
- `WARN`: 警告日志
- `INFO`: 信息日志
- `DEBUG`: 调试日志

### 2. 日志内容
```javascript
console.log('🚀 开始提取图片:', url);
console.log('  📊 检测到图片数量:', count);
console.log('  ✅ 提取成功');
console.error('  ❌ 提取失败:', error);
```

### 3. 性能监控
- 请求响应时间
- 浏览器启动时间
- 图片提取时间
- 内存使用情况

---

## 许可证

MIT License

---

## 联系方式

- **项目地址**: https://github.com/your-repo
- **问题反馈**: https://github.com/your-repo/issues
- **文档**: https://your-docs.com

---

## 更新日志

### v1.2.0 (2024-01-15)
- ✅ 修复 818ps 只返回 1 张图片的问题
- ✅ 添加 CSS background-image 提取
- ✅ 优化懒加载图片提取
- ✅ 完善项目架构文档

### v1.1.0 (2024-01-10)
- ✅ 添加 7 阶段水印去除功能
- ✅ 实现浏览器池优化
- ✅ 添加自动滚动功能

### v1.0.0 (2024-01-01)
- ✅ 初始版本发布
- ✅ 支持 818ps、花瓣、Canva
- ✅ 基础图片提取功能

---

**文档版本**: v1.2.0  
**最后更新**: 2024-01-15  
**维护者**: 开发团队
