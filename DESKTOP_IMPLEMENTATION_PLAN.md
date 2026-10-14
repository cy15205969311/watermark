# Windows 桌面版实施计划

## 已检查的实际结构

`client/src/App.vue`、Vuex 和 `utils/api.js` 是现有前端；`server/index.js` 是 npm start 的实际 Express 入口；`server/imageExtractor.js` 和 `extractors/` 是提取链；数据库 SQL 集中在 index.js；`services/browser-pool.js` 是主浏览器池，`utils/browserPool.js` 是另一个兼容池；所有启动点均经过 `utils/puppeteer-launch.js`。没有现成 Electron 工程。

MySQL 调用：连接池、SHOW/ALTER 多页列检查、历史 SELECT/INSERT/DELETE/search。schema.sql 含示例 INSERT，本任务不执行。当前启动默认读取 server 环境文件，导入入口就创建连接池、迁移及浏览器预热。uploads 使用 __dirname；Vite 构建使用 cwd 加载环境；生产提取代码没有依赖 cwd 的资源路径。前端 store 使用 Axios，App 使用 fetch，图片代理使用 img URL。下载使用浏览器链接，已有 GIF、多页和完整性透传。Sharp 是现有 N-API 原生依赖。

## 最小变更与实施顺序

1. 保存现有 Git 基线，复跑稿定和图怪兽回归（隔离 MySQL mock，不写生产数据）。
2. 新增 server/runtime.js 和 database/{mysql,sqlite}.js：默认 MySQL，桌面入口显式配置 SQLite；SQLite 独立 user_version 迁移、WAL、事务、索引。index.js 仅替换池创建及启动副作用，保持 SQL 和返回字段。
3. 新增 desktop 主进程、preload、backend 生命周期、安全中间件、配置和轮转日志；loopback 自动端口、随机凭证、健康检查、单实例和有限关闭。关闭窗口正常退出，不隐藏托盘。
4. 新增根 package.json、electron-builder NSIS 配置、受控打包暂存脚本：仅复制运行代码/生产依赖/构建前端；不含 env、测试、用户数据；随包复制 Puppeteer 实际匹配的完整 Chrome 目录。SQLite 使用 Electron 内置模块，无新增 SQLite ABI 依赖；Sharp 保留 N-API 二进制并解包。
5. 修改前端 API 和 clientId 辅助模块及桌面 Vite 构建模式，保留界面、提取器和下载交互。主进程处理保存对话框及外部分享链接。
6. 新增双模式、SQLite 持久化/迁移、访问控制、生命周期、打包运行测试；原提取器回归和前端构建。
7. 构建并检查 x64 NSIS 和 unpacked，验证中文/空格路径、随包浏览器、启动/退出/历史及图片/GIF。记录实际产物大小和版本。
8. 编写运行、日志、备份恢复和人工验收说明。干净 Windows 10/11 VM 未具备时明确列为未验收，不宣称发布完成。

## 数据与配置隔离

服务器 npm start 默认 MySQL，保留驱动/环境配置/迁移，不自动切换数据库。桌面不读取 server env，不导入 MySQL 驱动，不调用原 MySQL 迁移。SQLite、uploads、日志、临时目录在稳定 userData 下；不导入旧 MySQL 数据、不清空历史。构建不修改旧 env。升级及卸载默认保留 userData。

## 已识别的风险

Electron 版本须实测其 Node 内置 SQLite；现有 Puppeteer 21.11.0 对应 Chrome 121.0.6167.85，浏览器老旧，随包版本不得与 Puppeteer 脱离升级。旧第三方网关存在源码默认 token，安装包不能携带此凭据。SQLite 的真实 API 测试必须使用 Node 22.13+ 或 Electron 内置 Node，服务器 Node18 不要求 node:sqlite。开发机测试不能代替没有 Node/MySQL/Chrome 的干净机器验收。NSIS 下载、签名和安装权限仍需实际验证。
