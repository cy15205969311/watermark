# 1.2.0 下载默认目录调整

本报告保留较早轮次记录。当前存储策略、最新候选包及本轮结果以 [存储与反馈报告](DESKTOP_1.2.0_STORAGE_REPORT.md) 为准；旧 AppData 默认路径与下载回退策略已被替代。

日期：2026-10-15。候选状态：`unsigned_candidate` / Authenticode `NotSigned`。本轮保持版本 1.2.0、应用 ID、Electron/Puppeteer/Chromium 版本和数据库架构不变；未改动任何平台提取器、服务器环境文件或生产数据。

## 行为与配置

- 打包版：`path.join(path.dirname(process.execPath), 'Downloads')`。中文、空格及其他盘符跟随主程序位置；不以安装器所在目录、cwd 或 ASAR 计算。
- 开发版：继续使用 Electron 的 Windows 下载目录，测试启动器将其隔离到测试目录。
- `config.json.downloadDirectory` 的现有非空值视为用户选择，继续优先使用。未配置/null 表示动态默认，不向配置写死某次安装位置。“恢复默认”原子保存 null，再按当前安装环境解析。
- 只在首次保存、打开下载文件夹或主动恢复默认时创建目录。状态查询不会创建 Downloads。真实写入探针以独占临时文件检查权限，检查至少 32 MiB 可用空间，结束后移除探针。
- 优先目录不可写时，回退到 `app.getPath('userData')/Downloads`（正常为 `%APPDATA%/DesignExtractorPersonal/Downloads`），再尝试 Windows 下载目录。无 UAC 提权、无 ACL 修改；失效的自定义配置不被静默改写。
- 设置展示实际可用目录和回退原因；首次使用回退的保存对话框前给出中文说明。所有默认位置都失败时仍打开保存对话框，允许手选其他位置。
- 单次手选位置不改变配置；取消不生成输出文件。保存前检查选定父目录及写权限；已存在文件明确确认替换。原有 data URL 写入及 Chromium 下载链路保持，GIF 不转码，多页逐页队列不变。
- 下载目录不参与备份内容扩展，不移动 SQLite、uploads 或历史身份。备份仍是原有 config/SQLite/uploads 集合。

## 安装目录下保存文件的保护

发现上游 NSIS 原流程在升级时把安装树暂存到临时目录，卸载时递归清理安装树，会误处理新增的用户 Downloads。现对固定版本 26.15.3 的生成模板做两处受校验替换：升级暂存跳过根级 Downloads，清理程序文件时保留它。原有登记、范围、UAC、回滚流程保持。

更换安装路径时不自动搬运旧 Downloads；卸载后下载文件留在原安装位置。重新安装仍保留专用空目录规则，若旧位置只剩下载文件，需先另存这些文件或改选空目录。旧版卸载器没有新增保护，卸载旧版本前应先备份安装目录内的下载文件。

## 本轮实际文件

| 文件 | 用途 |
| --- | --- |
| `desktop/download-directory.cjs` | 统一目录解析、真实写探针、安全回退、保存对话框与替换确认 |
| `desktop/main.cjs` | IPC 保存和原生 will-download 使用同一解析函数，中文保存错误 |
| `desktop/settings.cjs`、`preload.cjs` | 状态、选择、恢复默认和受限打开下载目录 IPC |
| `client/src/components/DesktopSettings.vue` | 实际目录、回退提示、打开下载文件夹按钮；沿用现有组件样式 |
| `desktop/scripts/prepare.cjs` | 确保新模块进入实际 ASAR |
| `desktop/scripts/nsis-templates.cjs`、`desktop/installer/installer.nsi`、`keep-downloads.nsh` | 升级和卸载保留 Downloads，不更改个人数据库 |
| `desktop/tests/download-directory.cjs`、`download-native.cjs`、`download-retention-native.cjs` | 目录/权限/持久化、真实原生保存对话框、原生 NSIS 文件保留夹具 |
| `desktop/tests/settings-bootstrap.cjs`、`settings-runtime.cjs`、`packaged.cjs`、`package-inspect.cjs` | 隔离开发目录、实际字节/多页/取消/重启、ASAR 模块一致性 |
| `desktop/tests/installer-policy.cjs`、`nsis.ps1` | 新模板契约及供专用环境执行的下载文件保留验收断言 |
| `package.json` | 新增下载专项命令，不改依赖/锁文件 |
| `DESKTOP_GUIDE.md`、`DOCS_INDEX.md`、本报告 | 使用和验收记录 |

## 已执行测试

| 命令 | 真实结果 |
| --- | --- |
| `npm run test:mysql`（修改前后） | 各 65/65；隔离数据库适配夹具，涵盖三平台、多页、GIF、API/历史归一化；未连接生产 MySQL |
| `npm run test:desktop`（修改前后） | 各 12/12；SQLite、浏览器池、生命周期、端口/IPC隔离、GIF/多页元数据 |
| `npm run test:desktop:main` | 修改前检查及修改后均通过；真实主进程/preload，HTTP 与 data 资源字节保存、取消、历史重启 |
| `npm run test:desktop:data` | 14/14；一致备份、恢复/失败回滚、配置身份、备份不含程序文件、脱敏诊断 |
| `npm run test:desktop:downloads` | 13/13；新默认目录、延迟创建、中文空格路径、E 盘路径计算、模拟拒写/空间不足、自定义重载、恢复默认、取消、替换确认、受控打开文件夹 |
| `npm run test:desktop:settings` | 7 组通过；真实 Vue/Electron，三页队列落盘、GIF 原字节、取消、配置、备份恢复和诊断；原生选择器响应注入 |
| `npm run test:desktop:downloads:native` | 通过；执行相同生产 NSIS 函数，验证升级暂存/回滚/卸载保留嵌套下载文件与父目录哨兵；无真实应用安装/登记 |
| `npm run test:desktop:installer` | 7/7 |
| `npm run test:desktop:installer:native` | 52 条断言通过；无真实安装 |
| `npm run test:desktop:menus` | 2/2 |
| `npm run test:desktop:signing` | 3/3；真实 NotSigned 与第三方签名完整性检查 |
| `npm run desktop:dist` | x64 NSIS 构建成功，生成 SHA-256、版本元数据、未签名状态及日志 |
| `npm run test:desktop:package` | 通过；新模块源文件与 ASAR 一致，EXE/安装器 7 组图标资源匹配，随包 Chrome 成功启动；中文/空格 E 盘副本默认目录实际落盘，三页顺序与 GIF 字节一致，自定义目录重启保留，SQLite 不在程序目录且未加载 MySQL |
| `node desktop/tests/packaged.cjs --download-ui` | 未完成：已启动隔离 EXE 并触发第一份原生保存请求，但 Windows UI 工具激活窗口报 `GetCursorPos failed: 拒绝访问 (0x80070005)`，重新选择窗口重试仍失败；未点击保存，已停止该测试及测试进程。原生窗口默认路径、手动另存和原生取消尚未验收 |

打包运行证据：`server/test-artifacts/desktop-packaged-results.json`、`desktop-package-inspection.json`、`120-download-default-runtime.png`。前两类为真实程序运行/文件结果；保存选择器响应注入，不能替代下列原生窗口验收。

原生 UI 阻塞记录：`server/test-artifacts/download-native-blocked.json`。不把无有效窗口内容的捕获当作验收截图。后续在可用交互桌面运行 `node desktop/tests/packaged.cjs --download-ui`，依次在真实对话框保存默认 GIF、按控制台给出的隔离路径另存、取消第三份下载；脚本逐次验证 GIF 字节和动画帧，并生成 `download-native-results.json`。不对日常安装执行该测试。

## 本次交付候选

- 目录：`release/candidates/1.2.0/2026-10-15T04-38-40-495Z-4a5c03/`
- 安装程序：`DesignExtractor-Personal-1.2.0-x64-Setup.exe`
- 大小：230,632,757 字节（约 220 MiB）。
- SHA-256：`d2702e40a2e05572d3ab5bbb1e206feb283f21a8f1ad4464faabfa260f385dfd`
- 状态：`unsigned_candidate` / `NotSigned`；正式签名未启用，未上传发布。
- 实际构建入口：`npm run desktop:dist`。`release/latest-candidate.json` 已指向以上目录。
- `04-35-07-214Z-7dc818` 是本轮中间构建，未包含随后增加的 Downloads 卸载保护，不作为交付候选。

## 验收边界

权限拒绝、目录创建失败和空间不足通过注入文件系统错误验证，不能声称已经在 Program Files 的普通用户账户实测。当前仍没有可恢复 Windows 虚拟机或专用测试账户，真实用户级/全用户安装、UAC、多账户隔离、跨版升级/卸载和干净 Windows 10/11 均未验收。本轮不运行真实安装脚本，不覆盖日常应用。

真实外部平台分享链接本轮未重新联网验收；平台提取器代码未更改，本地回归通过不等于所有在线链接可用。Vite 原有 CJS/大包警告及平台夹具的 MaxListeners 警告仍存在，测试未隐藏这些输出。
