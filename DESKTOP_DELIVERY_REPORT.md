# Windows 桌面个人版交付记录

最新候选包菜单、图标与散列见 [DESKTOP_MENU_REPORT.md](DESKTOP_MENU_REPORT.md)，安装器阶段见 [DESKTOP_1.1.1_REPORT.md](DESKTOP_1.1.1_REPORT.md)；1.1.1 尚未执行真实安装验收。

此文件保留 1.0.0 桌面工程基线。1.1.0 安装体验升级及当前验收状态见 [DESKTOP_1.1.0_REPORT.md](DESKTOP_1.1.0_REPORT.md)，请勿将旧版验收结论套用到新版安装向导或全用户安装。

验证日期：2026-10-14。实际开发机：Windows 11（10.0.26200）。版本 1.0.0。桌面工程及安装包已完成开发机验收，干净 Windows 10/11 发布验收尚未完成。

## 产物

`release/DesignExtractor-Personal-1.0.0-x64-Setup.exe`

- 大小：229,513,946 bytes，约 218.88 MiB。
- SHA-256：`06ccd0c4abb734703a84d202e69911ecff8060219be4b1615d8b09989680bed3`。
- Electron 44.7.2；内置 Node 24.21.0 / SQLite 3.53.4。
- Puppeteer 21.11.0；随包 Chrome 121.0.6167.85。
- 用户级 NSIS；程序名称/图标/版本资源已写入；签名状态 NotSigned。
- 解包目录：`release/win-unpacked/`。

## 分阶段实施与验证

| 阶段 | 修改与原因 | 实际检查/结果 |
| --- | --- | --- |
| 1 结构分析 | DESKTOP_IMPLEMENTATION_PLAN.md：确认所有 SQL 在 index.js，识别导入副作用、浏览器入口、前端 API 和资源路径 | 实际源码与文档检查完成；修改前 Git 工作区干净 |
| 2 MySQL 基线 | 保留旧入口和数据库；根测试脚本固定 server 工作目录，防止现有夹具相对路径失败 | 原稿定 37/37、图怪兽 28/28，合计 65 项；真实只读连接/14 字段检查通过 |
| 3 双数据库 | server/runtime.js、database/mysql.js、database/sqlite.js、index.js：显式选择、保留 SQL 返回形状和独立 SQLite 事务迁移 | SQLite 创建/重开/完整性/索引/高版本拒绝/损坏错误通过；不会导入 mysql2 或服务器 env |
| 4 Electron | desktop/main.cjs、preload.cjs、backend.cjs：启动、健康检查、单实例、窗口和有界退出 | 实际主进程和重启冒烟通过，关闭窗口退出；前端没有 Node/凭证能力 |
| 5 数据与安全 | desktop/config.cjs、security.cjs、logging.cjs；uploads 重定位；稳定 clientId | 动态端口、错误 Host/Origin/凭证拒绝、日志脱敏轮转、配置持久化通过 |
| 6 浏览器 | utils/puppeteer-launch.js 统一追踪所有启动；services/browser-pool.js 保留 min=1/max=3；其他启动点仅增加追踪调用 | 随包 Chrome 实际运行；三实例上限/等待者取消/进程关闭/独立临时 profile 通过 |
| 7 前端 | utils/api.js、clientId.js、imageProxy.js、App.vue、store/index.js、vite.config.js：动态连接、旧上传 URL 恢复、受控保存、具体错误和独立构建 | 原界面保留；稿定前端未知/3页/5页与下载顺序通过，解析加载 17 场景通过 |
| 8 双模式测试 | desktop/tests 与 scripts：SQLite API、真实窗口、MySQL 回归、实际主进程、包内容/运行测试 | 桌面 11/11 集成检查；MySQL 模式 65/65 回归；npm start 真实 MySQL 启动、浏览器预热和历史只读请求 200 |
| 9 Windows 包 | 根 package/lock、builder.cjs、prepare.cjs、icon.svg/ico、gitignore：独立暂存、显式生产依赖、Chromium extraResources、Sharp N-API 解包 | NSIS 构建成功；ASAR 3887 项检查，无 env、测试产物、uploads、SQLite 数据库；Sharp 和提取器均在包内 |
| 10 安装环境 | NSIS 与打包程序实际测试 | 本开发机安装、中文/空格路径运行、重启、单实例、同版本覆盖安装、卸载和数据保留通过；干净 VM、不同版本升级未执行 |

以上阶段没有改写稿定/图怪兽资源选择逻辑、清空数据库或运行 MySQL 数据导入。服务器的 env、schema.sql、已有数据和依赖配置未被覆盖。原服务器 npm start 默认 MySQL；桌面不读取这些 env，SQLite 初始化失败不切换 MySQL。

源码中原有默认第三方 token 已移除，需显式配置 TSGPT_TOKEN。此项是唯一需要服务器部署人员关注的凭证配置变化；凭证不应随桌面包发布。

## 实际命令与结果

| 命令（项目根目录，除特别注明） | 预期 | 实际 |
| --- | --- | --- |
| `npm run test:mysql` | 原提取/历史回归通过 | 65/65，稿定 37、图怪兽 28，包含多页/GIF/创客贴本地回归 |
| `npm run test:mysql:live` | 只读连接成功，历史字段保留 | connected=true、columnCount=14、missingColumns=[]；无写入 |
| `cd server; npm start`（测试 HOST=127.0.0.1, PORT=39039） | 原入口仍启动 MySQL/浏览器 | MySQL 就绪、浏览器 1 实例；隔离 clientId 的 GET /api/history 返回 200/success/0 条；未写历史 |
| `npm run test:desktop` | SQLite、安全、真实浏览器/窗口/退出 | 11/11；包括不加载 MySQL/env、三实例并发上限、等待者退出、临时 profile 位于用户数据目录 |
| `npm run test:desktop:main` | 真实主进程与持久化 | 数据及 HTTP 保存、真实双帧 GIF 字节保存、取消、file URL 拒绝、重启多页/GIF 通过 |
| `npm run desktop:prepare` | 独立桌面暂存 | 输出 .desktop-build/client-dist；匹配 Chrome 完整复制/复用；不覆盖 client/dist/env |
| `npm --prefix client run build` | 服务器前端构建 | 成功，保留原有大 chunk 提示 |
| `npm run desktop:dist` | x64 安装包 | 成功，产物见上 |
| `npm run test:desktop:package` | 真正的打包程序使用自己的 SQLite/浏览器 | 中文/空格路径、PATH 无 Node/Chrome、MySQL 驱动未加载、非法 API 401、单实例、重启多页/GIF 通过 |
| `npm run test:desktop:nsis -- -LiveGaoding` | 安装后启动、真实提取、覆盖安装、卸载保留数据 | 全部通过；只创建/删除测试自己的 SQLite 记录 |
| Python with_server.py + server/test-gaoding-ui.py | 原稿定界面回归 | 未知完整性、3/5 页保存和下载、不成功结果与无运行时错误通过 |
| Python with_server.py + server/test-parse-loading-ui.py | 不破坏加载/重复提交 | 17 场景、0 失败 |
| Python with_server.py + server/test-818ps-ui.py（独立 5189 前端/5180 媒体夹具） | GIF 真实播放与下载、原字段和历史兼容 | 11 场景通过，包括浏览器不同帧、下载原字节及双帧再验证 |
| `node --check` index.js/imageExtractor.js/extractors/gaoding.js/utils/puppeteer-launch.js | 语法兼容 | 通过 |

Python UI 测试使用 `C:/Users/阿达/.codex/skills/webapp-testing/scripts/with_server.py` 管理本地 Vite（127.0.0.1:5179）。可复现业务测试和构建命令均已加入实际 package.json；详见 DESKTOP_GUIDE.md。

## 安装后真实平台证据

在 NSIS 安装后的 exe 中，后端实际请求 `https://www.gaoding.com/dam/share/bbgdyxG0Jdm8ir5koNVTv`：

```yaml
HTTP: 200
source: share-api-preview
pageCount: 3
expectedPageCount: 3
completenessStatus: complete
pageNumbers: [1, 2, 3]
pageIds: [null, null, null]
```

页码来自现有提取器的结构化结果；没有捏造 pageId，也没有强制改变 source。现有 dynamic-visible 兜底保持原逻辑。本次线上结果与三页完整集合一致，不能推广为所有公开分享链接都永远可用。完整脱敏记录见 `server/test-artifacts/desktop-packaged-results.json`；未把有效签名 URL 放进报告或安装包。

## 失败与修复记录

| 曾遇到的问题 | 原因与处理 |
| --- | --- |
| Node 18 并行测试出现反序列化异常 | 测试运行器/大量 Chromium 输出组合；分文件及 test-concurrency=1 后 65/65 通过 |
| 从根目录运行旧测试找不到 test-artifacts | 旧脚本使用相对 server 路径；新增 wrapper 固定 cwd 并创建诊断目录 |
| Node 18 无法加载 Electron 安装器 ESM 依赖 | 桌面构建明确要求 Node 22.13+，使用 Node24；服务器仍单独运行 |
| GitHub Electron 下载连接重置 | 使用镜像获取同版本归档，并以 SHASUMS256 校验后解包；未关闭 TLS |
| Windows 重复复制正在运行的 Chrome 失败 | 构建现在检查匹配的随包文件并复用，测试/构建按资源依赖顺序执行 |
| 默认 stealth 临时 profile 落在系统临时目录 | 为每个桌面启动显式建立独立 userData/temp profile，并追踪关闭/清理；真实启动参数断言通过 |
| 图怪兽 UI 测试首次代理夹具未加载 | 固定测试端口环境下预览等待超时；脚本新增 TEST_UI_BASE_URL，隔离到 5189/5180 后全部 11 场景通过，未修改产品预览逻辑 |
| 测试夹具的重复 URL 未携带 designId | 修正夹具为真实页面身份结构，原提取器去重规则保持不变 |

## 还未完成的发布验收

1. 没有可用的干净 Windows 10/11 VM，本次未验证“机器完全没有安装 Node/MySQL/Chrome”的实际 OS 镜像。移除 PATH 的开发机测试不能代替它。
2. 只验证同版本覆盖安装；两个真实不同版本的升级路径尚未执行。
3. 未配置代码签名，未测试商店分发，不宣称 NSIS 满足商店要求。
4. 图怪兽真实在线 GIF 和其他平台真实分享链接未在安装环境重新联网验收；本地 GIF/多页夹具和原平台回归通过。稿定上述真实三页链接已安装后联网验证。
5. Windows 关机、强制终止后的恢复和所有磁盘/权限故障未逐一实机注入；自动测试覆盖损坏数据库及错误映射、正常退出、端口冲突和进程清理。
6. Chrome121 / Puppeteer21 为保持原提取器兼容沿用的旧组合，需要另立受控升级任务并跑真实平台回归；本次没有全局忽略证书错误。
7. Vite 保留原有 >500 kB chunk 提示；未重写界面或做无关构建拆分。

备份恢复、用户目录与故障提示见 [使用指南](DESKTOP_GUIDE.md)。当前适合作为个人版候选安装包，完成上述干净环境和签名验收后再决定正式发布。
