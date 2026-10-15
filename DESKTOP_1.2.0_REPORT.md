# DesignExtractor Personal 1.2.0 候选验收报告

本报告保留较早轮次记录。当前存储策略、最新候选包及本轮结果以 [存储与反馈报告](DESKTOP_1.2.0_STORAGE_REPORT.md) 为准；旧 AppData 默认路径与下载回退策略已被替代。

后续下载目录优化已单独构建，当前候选、SHA-256 和新增验收限制见 [下载目录调整报告](DESKTOP_1.2.0_DOWNLOADS_REPORT.md)。本报告下面保留原轮次记录，当前产物以 `release/latest-candidate.json` 为准。

日期：2026-10-15。交付状态为 **unsigned_candidate**，Authenticode **NotSigned**，正式签名未启用，不自动上传或发布。代码构建、自动化测试、真实安装验收分别记录。

用户确认当前没有可恢复 Windows 虚拟机或专用测试账户，授权交付候选并标记安装验收未完成。本轮未在日常工作账户安装、覆盖或卸载程序。

## 实现与文件

| 文件 | 修改目的 |
| --- | --- |
| `package.json`、`package-lock.json` | 产品工具链版本 1.2.0，增加数据及设置专项脚本，依赖版本不变 |
| `desktop/builder.cjs` | 保留中文 NSIS 与固定应用 ID，关闭签名调用，移除 afterSign 与凭据强依赖 |
| `desktop/scripts/dist.cjs`、`build-worker.cjs` | 单遍原生卸载器编译、独立候选目录、真实构建日志、失败记录、版本/散列元数据，不发布 |
| `desktop/scripts/unsigned.cjs`、`verify-unsigned.ps1`、`verify-signatures.cjs` | 独立 Authenticode 检查，真实 NotSigned 状态，随包 Chromium/第三方 DLL/许可文件逐字节散列保留 |
| `desktop/installer/installer.nsi`、`wizard.nsh`、`desktop/scripts/nsis-templates.cjs` | 移除上一轮签名专用双遍逻辑，恢复已存在的单遍 WriteUninstaller；原路径、范围冲突及保留个人数据策略不变 |
| `desktop/signing/` | 移除未使用的证书导入、自定义 signer、签名 hook、双遍适配器、RFC3161 严格发布逻辑；不再保留付费签名配置入口 |
| `desktop/config.cjs` | 稳定身份保持原样，原子保存下载目录并验证配置 |
| `desktop/main.cjs`、`preload.cjs`、`menus.cjs`、`settings.cjs` | 窄范围受信任 IPC、真实设置、文件夹选择、原生恢复确认、诊断预览、中文菜单入口、活动数据操作的关闭与刷新保护 |
| `desktop/personal-data.cjs` | 一致数据库快照、上传文件与配置备份、校验、隔离恢复、回滚备份与中断日志恢复 |
| `desktop/diagnostics.cjs` | 白名单本地诊断导出；错误仅保留类别和函数名，不导出消息中的私人内容；跨启动保存浏览器失败原因的中文分类与时间 |
| `desktop/backend.cjs`、`security.cjs` | 暂停新本地请求并拒绝忙时数据管理，实际数据库/浏览器状态、提取结果计数与请求耗时，旧端口上传 URL 在返回时重定位 |
| `server/database/sqlite.js`、`server/index.js` | SQLite 专属快照、关闭/重开及状态接口；服务器 MySQL 默认路径不变 |
| `client/src/components/DesktopSettings.vue`、`client/src/App.vue` | 桌面独有设置对话框，沿用 Element Plus；下载、备份恢复、诊断与错误反馈均可操作 |
| `desktop/scripts/prepare.cjs` | 暂存新增桌面模块，不复制服务器 env、个人数据库或上传文件 |
| `desktop/tests/personal-data.cjs`、`settings-bootstrap.cjs`、`settings-runtime.cjs`、`desktop/scripts/settings-smoke.cjs` | 真实 SQLite 及隔离 Electron/Vue 设置专项 |
| `desktop/tests/signing-native.cjs`、`unsigned-policy.cjs` | 以未签名构建策略和实际 Authenticode/篡改拒绝替换已删除产品签名功能的测试 |
| `desktop/tests/menu-runtime.cjs`、`package-inspect.cjs`、`packaged.cjs`、`run.cjs`、`nsis.ps1`、`desktop/scripts/package-smoke.cjs` | 当前版本菜单验证、设置包内运行、维护状态拒绝写入/恢复连接、安装器保护和候选路径适配 |
| `.ui-craft/brief.md`、`DESKTOP_GUIDE.md`、本报告、备份专项报告、`DOCS_INDEX.md` | 界面约束、实际操作和真实验收边界 |
| `.gitignore` | 忽略个人 .dexp-backup 目录，防止在仓库目录中备份时意外提交私人数据 |

已有工作区中的报告删除状态和其他未提交修改没有擅自还原。未修改平台提取器算法、服务器环境配置、MySQL 连接参数、生产数据，也未升级 Electron、Puppeteer 或 Chromium。

## 构建链

`npm run desktop:dist` → 独立版本/时间目录 → `prepare.cjs`（Vue 桌面产物、后端与随包浏览器）→ 第三方文件基线散列 → electron-builder 正常自定义 NSIS 单遍编译 → `WriteUninstaller` 安装时生成卸载器 → 实际 Authenticode/文件版本/资源散列检查 → EXE、SHA-256、release-metadata.json、verification-report.json、vendor-integrity.json、build.log。

不存在 signer、证书导入或云签名调用。`desktop:dist:release` 在构建前明确失败，提示正式签名未启用。原历史安装包和失败候选目录保留，latest-candidate 仅在成功后更新。单遍脚本实际编译成功；卸载器只有真正安装时才生成，因此其实际运行、图标和登记删除仍未验收，不从编译结果推断通过。

## 实际命令与记录

全部在项目根目录执行。详细输出在 `server/test-artifacts/120-*.log`，构建日志另随候选交付。

| 命令 | 本轮实际结果 |
| --- | --- |
| `npm run test:mysql` | 修改前后均 65/65 通过，含图怪兽、稿定、创客贴、多页、GIF 与历史 HTTP 夹具 |
| `npm run test:mysql:live` | 修改前后均失败：ER_ACCESS_DENIED_ERROR；仅只读连接检查，没有修改凭据、运行迁移或写库 |
| `npm run desktop:prepare` | 成功；初次基线缺少 .desktop-build，准备资源后补跑 |
| `npm run test:desktop` | 准备资源后 11/11，最终修改后 12/12；真实 Electron SQLite/Sharp、HTTP 安全、维护暂停写入、随包 Chromium、历史恢复 |
| `npm run test:desktop:main` | 准备资源后及修改后通过，真实 main/preload、隔离身份、重启持久化、GIF 原始下载 |
| `npm run test:desktop:installer` | 7/7 通过，中文页面、范围、冲突、原生卸载器规则与许可 |
| `npm run test:desktop:installer:native` | 52 项生产路径/范围函数断言通过，不安装、不提权、不写应用登记 |
| `npm run test:desktop:menus` | 2/2 通过，中文角色、快捷键、禁用状态与刷新保护 |
| `npm run test:desktop:data` | 14/14 通过，见备份专项报告（含复制失败清理和跨启动安全浏览器失败分类） |
| `npm run test:desktop:settings` | 5 项真实 Electron/Vue 流程通过；原生选择框与确认响应仅在测试进程注入 |
| `npm run test:desktop:signing` | 3/3 通过：禁用凭据、正式签名入口明确失败、真实 DLL 验签/代码段篡改拒绝与 NotSigned 识别 |
| `npm run desktop:audit:signing` | 只读扫描完成，无值打印；发现已跟踪 .env.docker 两个疑似凭据字段，见风险说明 |
| `npm run desktop:dist` | 成功；实际单遍 NSIS 编译、28 个 PE 检查、第三方文件散列不变 |
| `npm run test:desktop:package` | 成功；最终候选隔离副本实际 Chromium、中文菜单、设置、备份恢复、诊断、单实例与历史重启通过 |
| `npm run test:desktop:package -- --live-gaoding` | 在最终交付候选再次实际联网成功；用户提供分享链接返回 3/3 页、complete，证据为 120-final-live-gaoding-results.json / 120-final-live-gaoding.log |

初次基线包测试找不到旧版独立候选，已记录失败，不把历史报告当作本次成功。第一次新构建编译成功，但 PowerShell Security 模块受继承的 PSModulePath 影响而验签失败；修复为 OS 自带 Windows PowerShell 模块后独立验证通过。原生签名夹具先错误选用了未签名 DLL，并发现追加尾部数据可能被 Windows 判为 NotSigned；修正夹具为真实签名 DLL 的 PE 代码段篡改，不能靠单个签名状态代替文件散列检查。

## 明确未验收

| 项目 | 状态及原因 |
| --- | --- |
| 当前用户真实安装与非管理员权限 | 未执行，无专用环境 |
| 全用户安装、Program Files、UAC 同意/拒绝 | 未执行，无专用环境 |
| 实际向导页面、目录浏览与取消、快捷方式创建和卸载 | 未执行；52 项原生函数检查不代替 UI/安装验收 |
| 1.0.0 / 1.1.0 / 1.1.1 到 1.2.0 升级、移动目录、取消升级 | 未执行真实安装；旧配置/SQLite 兼容及恢复在隔离目录验证 |
| 第二 Windows 账户个人数据库/上传隔离 | 未执行；独立目录测试不代替账户 ACL 验收 |
| 真卸载与卸载后重装保留历史 | 未执行；脚本保持默认保留、拒绝 delete-app-data |
| 干净 Windows 10/11、无 Node/MySQL/Chrome | 未执行；开发机裁剪 PATH 不等同干净系统 |
| 真实公开平台提取与下载 | 稿定给定链接实际提取 3/3 complete；图怪兽 GIF 和创客贴只有夹具/原字节保存回归，本轮无有效实链接，未验收实际联网提取与下载 |
| 付费签名、发布者身份、SmartScreen 信誉 | 本阶段不启用，不承诺无警告 |

## 限制与风险

- MySQL 实库权限拒绝仍是服务器真实连接验收阻塞，未变更原有 MySQL 代码与配置。
- `.env.docker` 已跟踪文件中有疑似非空 DB_PASSWORD、DB_ROOT_PASSWORD。未显示值，也未删除文件。维护者应本地检查 Git 历史，若为真实凭据需在相应系统轮换；忽略文件规则无法清除历史暴露。
- 备份文件夹不加密，包含私人图片、历史链接与身份配置；不要上传到公开位置。远程签名资源仍可能自然过期，恢复不恢复平台访问权限。
- 目前备份复制和校验由主进程顺序执行，较大上传目录可能暂时阻塞主进程；没有执行中强制取消按钮，仅选择/确认阶段支持取消。强杀或断电由恢复日志与回滚备份尽力恢复，不能承诺硬件故障或磁盘损坏下无损。
- 自动回滚备份不自动删除。暂存目录清理失败会保留文件供排查，不触碰整个个人目录。手动清理须退出应用并确认不涉及正在进行的恢复。
- 本地请求意外断开时可能仍在后台写入；数据管理保守地保持“忙”直到请求完成或应用重启，避免在不确定状态下备份上传文件。
- 诊断仅记录本次运行、近期 20 次提取耗时与结果、20 次数据管理操作和 10 次操作错误类别/函数名；不输出原始日志或平台凭据。分阶段提取性能分析及跨启动统计尚未加入。
- 若应用启动时数据库已损坏导致无法打开主窗口，仍需退出后的冷备份/手工恢复流程；设置中心不能在启动失败前显示。

## 最终候选记录

候选目录：`release/candidates/1.2.0/2026-10-15T03-54-08-140Z-a33834/`

- 文件：`DesignExtractor-Personal-1.2.0-x64-Setup.exe`
- 大小：230631132 字节（约 219.95 MiB）。
- SHA-256：`01f8e6c70cdb8500095447df20a3ba4b3b2f99358048ed8706efeab8a2b0eda3`
- 状态：unsigned_candidate / NotSigned；正式签名关闭，publisher/timestamp 为 null；未发布。
- 独立验证 28 个 PE：24 个 NotSigned，4 个第三方 DLL Valid。随包 Chrome 和 Electron 第三方文件散列与构建前输入一致，没有重签或修改签名。
- 主程序与安装器各 7 个 ICO 资源与源图标字节匹配。原生卸载器与安装后快捷方式仍待真实安装验收。
- 包内 11 个主要桌面/后端运行模块与工作区源码逐字节比对一致。
- 包内 Vue/SQLite/Chromium、中文编辑/缩放/教程菜单、忙时刷新取消、真实设置保存目录、原字节 GIF、备份恢复及诊断、单实例、重启后三页/GIF 历史通过；结果 `120-package-final-results.json`、日志 `120-delivery-package.log`。
- 打包测试只在任务专属副本加入隔离 appData 启动器并关闭该副本的 ASAR 头校验；原候选 EXE/ASAR 未改动。原生文件选择/确认与 Explorer 回调在测试进程注入响应，不能据此宣称人工向导或 Windows 安装验收成功。
- 实际界面截图：`server/test-artifacts/120-settings-runtime.png`、`120-backup-runtime.png`、`120-diagnostics-runtime.png`。截图来源与测试局限见专项报告。
- 最终交付文件再次联网检查：HTTP 200，3/3 页，complete，share-api-preview，页码 1/2/3。未从该结果推断其他分享链接、平台或安装环境全部通过。
