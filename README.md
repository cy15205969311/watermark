# 🎯 智能去水印助手

基于 Vue 3 + Node.js + MySQL + Element Plus 的全网图片/视频去水印下载工具

支持多平台智能识别，采用**8层精确抓取策略**，专门优化创客贴等设计平台的主图提取。

## ✨ 核心特性

- 🎨 **精确设计稿提取** - 专门优化创客贴、818ps等设计平台，获取纯净主图而非页面截图
- 🌐 **多平台支持** - 支持创客贴、818ps、Canva、抖音、小红书等主流平台
- 🧠 **智能识别系统** - 8层抓取策略 + 多维度评分算法
- 🚀 **高质量输出** - 优先获取原图URL，避免截图质量损失
- 📱 **响应式设计** - 完美适配桌面端和移动端
- 📊 **历史记录管理** - 智能搜索、一键删除、实时过滤

## 🛠️ 技术栈

### 前端技术
- **Vue 3** - 组合式API + 响应式系统
- **Vuex 4** - 状态管理
- **Element Plus** - UI组件库
- **Axios** - HTTP客户端
- **Vite** - 构建工具

### 后端技术
- **Node.js** - 服务器运行时
- **Express** - Web框架
- **MySQL** - 数据库
- **Puppeteer** - 浏览器自动化
- **Cheerio** - 服务端DOM解析

## 🚀 快速开始

### 环境要求
- Node.js >= 16.0.0
- MySQL >= 8.0
- Chrome/Chromium (Puppeteer自动下载)

### 1. 克隆项目
```bash
git clone <your-repo-url>
cd watermark-remover
```

### 2. 数据库配置

确保MySQL服务已启动，然后创建数据库：

```bash
# 方式1：直接导入
mysql -u root -p < database/schema.sql

# 方式2：手动执行
mysql -u root -p
source database/schema.sql
```

### 3. 后端配置

```bash
cd server
npm install
```

环境变量配置 (`.env` 已预配置)：
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=watermark_remover
PORT=3000
```

### 4. 前端配置

```bash
cd client
npm install
```

### 5. 启动项目

**后端服务**：
```bash
cd server
npm start
# 或开发模式: npm run dev
```

**前端服务**：
```bash
cd client
npm run dev
```

访问 http://localhost:5173 开始使用！

## 🎯 核心功能

### 🎨 精确设计稿提取
- **创客贴优化** - 8层抓取策略，获取纯净设计稿主图
- **智能识别** - 自动区分设计稿内容和页面UI
- **质量优先** - 原图URL > 精确截图 > DOM回退
- **内容清理** - 自动移除水印、导航栏、空白区域

### 🌐 多平台支持
- **设计平台** - 创客贴、818ps、Canva
- **社交媒体** - 抖音、小红书、快手
- **视频平台** - B站、YouTube等
- **智能识别** - 自动检测平台类型

### 📊 智能管理
- **历史记录** - 自动保存提取记录
- **实时搜索** - 关键词快速过滤
- **批量操作** - 一键删除、批量下载
- **状态追踪** - 成功/失败状态显示

### 🔧 技术特性
- **网络拦截** - 直接获取原始图片URL
- **元素定位** - 30+专门选择器精确定位
- **智能评分** - 多维度评分算法选择最佳内容
- **边界检测** - 自动裁剪空白区域
- **错误处理** - 详细错误信息和用户指导

## 📡 API 接口

### 核心接口

#### 提取图片/视频
```http
POST /api/extract-image
Content-Type: application/json

{
  "url": "https://www.chuangkit.com/sharedesign?d=xxx",
  "platform": "Chuangkit"
}
```

#### 解析链接
```http
POST /api/parse
Content-Type: application/json

{
  "url": "目标链接",
  "platform": "平台名称",
  "thumbnailUrl": "缩略图URL",
  "status": "success"
}
```

### 历史记录管理

#### 获取历史记录
```http
GET /api/history
```

#### 搜索记录
```http
GET /api/history/search?query=关键词
```

#### 删除记录
```http
DELETE /api/history/:id
```

### 响应格式

**成功响应**：
```json
{
  "success": true,
  "imageUrl": "提取到的图片URL",
  "platform": "平台名称",
  "source": "提取方式",
  "quality": "图片质量",
  "linkType": "链接类型"
}
```

**错误响应**：
```json
{
  "success": false,
  "error": "错误信息",
  "details": "详细错误描述"
}
```

## 📁 项目结构

```
watermark-remover/
├── 📁 client/                    # Vue 3 前端应用
│   ├── 📁 src/
│   │   ├── 📁 components/        # Vue组件
│   │   │   ├── DownloadDialog.vue    # 下载对话框
│   │   │   ├── HistoryItem.vue       # 历史记录项
│   │   │   └── PlatformIcons.vue     # 平台图标
│   │   ├── 📁 services/          # 服务层
│   │   │   └── parseService.js       # 解析服务
│   │   ├── 📁 store/             # Vuex状态管理
│   │   │   └── index.js              # 主store
│   │   ├── App.vue               # 主应用组件
│   │   └── main.js               # 应用入口
│   ├── 📁 public/                # 静态资源
│   │   └── 📁 tutorial/          # 教程图片
│   ├── index.html                # HTML模板
│   ├── vite.config.js            # Vite配置
│   └── package.json              # 前端依赖
├── 📁 server/                    # Node.js 后端服务
│   ├── 📁 services/              # 核心服务
│   │   └── browser.js            # 浏览器自动化服务
│   ├── 📁 uploads/               # 文件上传目录
│   ├── index.js                  # Express服务器
│   ├── imageExtractor.js         # 图片提取核心逻辑
│   ├── thirdPartyApiGateway.js   # 第三方API网关
│   ├── watermarkRemoval.js       # 去水印处理
│   ├── .env                      # 环境变量
│   └── package.json              # 后端依赖
├── 📁 database/                  # 数据库相关
│   └── schema.sql                # 数据库结构
├── 📄 deploy.sh                  # 自动部署脚本
├── 📄 nginx.conf                 # Nginx配置
├── 📄 railway.json               # Railway部署配置
└── 📄 README.md                  # 项目文档
```

## 🎨 8层精确抓取策略

### 创客贴专项优化

我们专门针对创客贴等设计平台开发了8层抓取策略，确保获取纯净的设计稿主图：

#### 1. 🌐 网络请求拦截
- 直接捕获设计稿图片URL
- 专门的评分系统 (文件大小 + 关键词匹配)
- 设计稿特征识别 (+800分)
- UI元素过滤 (-1000分)

#### 2. 🎯 精确元素定位
- 30+专门的设计稿容器选择器
- `.design-preview-main`, `.work-preview-main`
- `.template-preview-main`, `.main-design-container`
- 创客贴特有容器识别

#### 3. 🧹 高级内容清理
- CSS隐藏：导航栏、工具栏、侧边栏
- JavaScript清理：动态移除UI元素
- 水印移除：自动识别和隐藏水印层
- 背景透明化：突出设计稿内容

#### 4. 📊 智能容器评分
- **面积评分** - 基础分数计算
- **位置评分** - 居中元素优先
- **尺寸检查** - 合理尺寸验证
- **内容密度** - 图片/文本/Canvas内容加分

#### 5. 📐 智能边界检测
- 自动识别设计稿边界
- 精确截图设计稿区域
- 去除空白区域
- 保持内容完整性

#### 6. 🔄 URL回退策略
- 使用网络拦截的高质量图片
- 原图URL优先级最高
- 避免截图质量损失

#### 7. 🔍 DOM扫描回退
- 查找页面中所有设计稿图片
- 按面积排序选择最大图片
- 尺寸过滤 (>200x200)

#### 8. ❌ 错误处理
- 详细的错误诊断信息
- 用户友好的失败原因说明
- 操作建议和解决方案

### 效果对比

| 项目 | 优化前 | 优化后 |
|------|--------|--------|
| **抓取内容** | 整个页面截图 ❌ | 纯净设计稿主图 ✅ |
| **图片质量** | 包含UI和空白 ❌ | 高质量原图/精确截图 ✅ |
| **内容识别** | 简单选择器 ❌ | 8层策略智能识别 ✅ |
| **成功率** | 低成功率 ❌ | 多重保障高成功率 ✅ |

## 🚀 部署指南

### 自动化部署 (推荐)

使用提供的自动化部署脚本：

```bash
chmod +x deploy.sh
./deploy.sh
```

脚本将自动完成：
- 系统依赖安装 (Node.js, MySQL, Nginx)
- 项目配置和构建
- 服务启动和进程管理
- Nginx反向代理配置

### 手动部署

#### 1. 服务器环境
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm mysql-server nginx

# CentOS/RHEL
sudo yum install nodejs npm mysql-server nginx
```

#### 2. 数据库配置
```bash
sudo mysql_secure_installation
mysql -u root -p < database/schema.sql
```

#### 3. 应用部署
```bash
# 后端
cd server
npm install --production
npm install -g pm2
pm2 start ecosystem.config.js

# 前端构建
cd ../client
npm install
npm run build
```

#### 4. Nginx配置
```bash
sudo cp nginx.conf /etc/nginx/sites-available/watermark-remover
sudo ln -s /etc/nginx/sites-available/watermark-remover /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 免费部署选项

#### Railway (推荐)
1. 连接GitHub仓库
2. 使用提供的 `railway.json` 配置
3. 自动部署和域名分配

#### Vercel + PlanetScale
- 前端：Vercel自动部署
- 数据库：PlanetScale免费MySQL
- 后端：Railway或Render

## 🔧 开发指南

### 开发环境配置

#### 后端开发
```bash
cd server
npm run dev  # 使用nodemon自动重启
```

#### 前端开发
```bash
cd client
npm run dev  # Vite热更新
```

### 环境变量配置

创建 `server/.env` 文件：
```env
# 数据库配置
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=watermark_remover

# 服务配置
PORT=3000
NODE_ENV=development

# Puppeteer配置 (可选)
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

### 调试技巧

#### 1. 后端调试
```bash
# 启用详细日志
DEBUG=* npm run dev

# 查看数据库连接
mysql -u root -p -e "SHOW DATABASES;"
```

#### 2. 前端调试
- 使用Vue DevTools浏览器扩展
- 检查Network面板查看API请求
- Console查看Vuex状态变化

#### 3. 抓取调试
```bash
# 测试特定平台
node -e "
const { extractImage } = require('./server/imageExtractor');
extractImage('https://www.chuangkit.com/sharedesign?d=xxx', 'Chuangkit')
  .then(console.log)
  .catch(console.error);
"
```

### 代码规范

#### 前端规范
- 使用Vue 3 Composition API
- 组件命名采用PascalCase
- 使用TypeScript类型注解 (可选)

#### 后端规范
- 使用ES6+ 语法
- 异步操作使用async/await
- 错误处理使用try-catch

## 🐛 常见问题

### Q: 创客贴抓取失败？
**A**: 检查以下几点：
1. 链接是否为有效的分享链接
2. 设计稿是否为公开状态
3. 网络连接是否正常
4. Chrome/Chromium是否正确安装

### Q: 数据库连接失败？
**A**: 确认：
1. MySQL服务是否启动
2. 用户名密码是否正确 (默认root/root)
3. 数据库是否已创建
4. 防火墙是否阻止连接

### Q: 前端无法访问后端API？
**A**: 检查：
1. 后端服务是否在3000端口运行
2. CORS配置是否正确
3. 代理配置是否生效 (开发环境)

### Q: Puppeteer启动失败？
**A**: 解决方案：
1. 安装Chrome/Chromium浏览器
2. 设置PUPPETEER_EXECUTABLE_PATH环境变量
3. 检查系统依赖是否完整

## 🤝 贡献指南

### 提交代码
1. Fork项目到个人仓库
2. 创建功能分支: `git checkout -b feature/new-feature`
3. 提交更改: `git commit -m 'Add new feature'`
4. 推送分支: `git push origin feature/new-feature`
5. 创建Pull Request

### 报告问题
- 使用GitHub Issues报告bug
- 提供详细的错误信息和复现步骤
- 包含系统环境信息

### 功能建议
- 在Issues中提出新功能建议
- 描述使用场景和预期效果
- 讨论实现方案

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- Vue.js团队 - 优秀的前端框架
- Element Plus - 美观的UI组件库
- Puppeteer团队 - 强大的浏览器自动化工具
- 所有贡献者和用户的支持

---

**⭐ 如果这个项目对你有帮助，请给个Star支持一下！**
