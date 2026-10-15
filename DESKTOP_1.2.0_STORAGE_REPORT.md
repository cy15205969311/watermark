# DesignExtractor Personal 1.2.0：personal 存储与 Bug 反馈候选报告

日期：2026-10-15。交付为未签名候选，版本保持 1.2.0，应用 ID 为 `com.designextractor.personal`。代码构建、自动化与打包运行已经执行；真实安装、UAC、多账户与干净 Windows 验收尚未完成。没有对日常已安装程序执行安装、覆盖或卸载，也没有迁移当前真实个人数据。

## 生效路径

打包模式按 `path.dirname(process.execPath)` 计算安装目录，与 cwd、安装包下载位置、resources/app.asar 无关。安装器写入 UTF-16 的 `storage-layout.ini` 登记安装范围和上一安装位置。

| 类型 | 当前用户安装 | 所有用户安装 |
| --- | --- | --- |
| 数据根目录 | `<EXE目录>/personal` | `<EXE目录>/personal/users/<Windows SID>` |
| 数据库与配置 | 根目录的 `history.sqlite`、`config.json` | 相同相对路径，各 SID 独立 |
| 下载 | `Downloads` | `Downloads` |
| 日志 | `logs` | `logs` |
| Puppeteer 用户配置 | `browser-profiles/chromium-profile-*` | 同上 |
| Electron 会话与缓存 | `cache/session`、`cache/http` | 同上 |
| 临时文件、网页触发附件 | `temp`、`temp/browser-downloads` | 同上 |
| 备份与恢复回滚 | `backups`、`backups/rollback` | 同上 |

保留原数据库、配置文件名及结构版本 1，未照搬建议树创建第二份数据库。随包 Chrome 仍在 `resources/chromium/chrome-win64`，版本 121.0.6167.85，Puppeteer 21.11.0，Electron 44.7.2，均未升级。

开发模式使用 `.desktop-build/development/personal`；仅开发模式接受 `DESIGN_EXTRACTOR_DEV_DATA_DIR`，生产忽略此变量。启动在 ready、单实例锁、Session、SQLite、日志及浏览器初始化之前设定 userData/sessionData/temp/logs/crashDumps 与缓存开关，并同步 TEMP/TMP。

不可写时明确报错并退出，不回退 AppData、不提权运行整个应用。下载自定义目录失效时保留设置并显示原因，用户仍可主动在保存对话框选择可写位置。恢复默认重新采用当前个人目录 Downloads。Windows 和系统组件仍可能写 C 盘；本改造不承诺整个系统零写入 C 盘。

## 权限、升级和卸载

所有用户安装仅给 personal 容器设置 Users 读取/执行，users 容器再加“创建子目录”且不继承到他人 SID 子目录；SYSTEM/Administrators 完全控制。通过安装器内嵌固定 PowerShell 脚本重设容器 DACL，不开放整个安装目录、EXE 或 resources 的写权限，不递归修改已有 SID 子目录。遇到联接、未隔离共享数据库或权限设置失败时阻止安装。

运行时核验当前 SID 子目录所有者及已有权限，拒绝其他账户预建/可读的可疑目录，再设置当前 SID Modify、SYSTEM/Admin Full。当前账户真实 ACL 设置、重复启动和错误 SID 拒绝测试通过；第二账户、标准用户在 Program Files 下运行仍未验收。管理员始终具备系统管理权限，SID 隔离不声称防御本机管理员。

升级原生文件暂存/回滚和卸载均跳过 `personal`、旧 `Downloads` 与 `storage-layout.ini`。卸载不清理个人数据。仅有这些保留项且登记应用 ID、范围、personal-v1 均匹配时允许同范围重装，其他非空目录仍拒绝。旧卸载器未登记 personal-v1 且旧安装下已有 personal 时，阻止升级并提示先在安装目录外完整备份，避免旧卸载器误删数据。跨安装范围继续阻止自动覆盖。

## 安全迁移

1. 新数据目录先通过真实写入探测和空间检查；启动读取旧 AppData 只用于发现和确认，不作为运行回退。
2. 来源为当前账户旧 `%APPDATA%/DesignExtractorPersonal/personal`，或安装器 previousInstall 对应的同范围目录。多份来源须选择一份，不自动合并。目标已有配置或数据库时不覆盖，必须明确选择使用现有目标或退出。
3. 提示关闭旧版本；使用 Node SQLite backup API 从只读连接生成含 WAL 已提交事务的一致快照。上传文件、配置、日志、受管理的 Downloads/backups/旧 rollback-backups 先复制到本次 temp 暂存目录并校验 SHA-256。
4. SQLite integrity_check、结构版本、必要列、历史数量和 uploads 引用均验证；源文件清单/散列在复制前后比较，变化则拒绝。空 WAL 不包含事务，读取已关闭 WAL 数据库产生的空 WAL/SHM 不视为数据变更。
5. 只迁移明确属于应用的下载目录，用户自定义外部路径保持原意，不扫描整个 Windows Downloads。旧受管理下载路径随迁移恢复新默认。遇到同名不同内容、缺失引用、非法配置、联接或未知文件/未完成恢复日志则停止。
6. 提交前持久化迁移日志，逐项同卷 rename，验证后写完成标记。故障将本次已提交项撤回隔离暂存目录，下次启动也会处理未完成日志。旧目录不删除，失败暂存保留供排查，已有新数据不被合并覆盖。
7. `.storage-layout.json` 使后续启动不重复迁移。原数据库结构/历史身份保留。缓存与临时浏览器配置重新初始化，避免搬入失效锁文件。

手工移动安装位置但丢失 previousInstall 登记时，无法自动寻找任意旧磁盘：先正常退出，完整冷备份个人目录，再恢复到新位置。迁移后勿继续运行旧版修改旧数据；两份数据不会自动同步。大目录散列、复制及校验可能阻塞主进程，迁移界面属于启动前原生对话框；原生交互仍待实测。

## Bug 反馈

帮助菜单新增“问题反馈 / 报告 Bug”。邮箱 `ad4928115@gmail.com`，主题 `[DesignExtractor Personal] Bug 反馈`。预览模板包含真实版本、运行模式、系统版本架构、时间和允许列表中的错误类别；操作步骤/预期实际结果/请求 ID 留给用户填写。不拼入原始异常消息、路径、URL、日志、Token、Cookie、数据库或图片。

用户可取消、打开默认邮件客户端草稿或复制邮箱及模板。mailto 打开失败时再次提供复制操作；某些客户端“打开成功但无窗口”的情况可重新进入菜单复制。不会自动发送、自动附加文件或上传日志。打包程序真实菜单回调已测试，邮件传输、剪贴板和原生对话框采用注入，避免发送邮件或改变日常剪贴板；真实默认邮件客户端体验未验收。

## 本轮文件清单

- 新增 `desktop/paths.cjs`、`storage-migration.cjs`、`feedback.cjs`：统一路径、迁移事务/冲突处理、受控反馈。
- 修改 `desktop/main.cjs`、`config.cjs`、`download-directory.cjs`、`personal-data.cjs`、`settings.cjs`、`menus.cjs`：提前初始化、持久配置、无回退默认下载、受管理回滚备份、真实状态和菜单入口。
- 修改 `server/utils/puppeteer-launch.js`：仅桌面分支指定用户配置及附件目录；保留浏览器控制会话，避免 Chrome detach 后重置下载目录。服务器分支保持原行为。
- 修改 `client/src/components/DesktopSettings.vue`：现有样式中增加安装/数据库/配置/缓存/备份真实路径。
- 修改 `desktop/installer/installer.nsi`、`wizard.nsh`、`keep-downloads.nsh`、`使用协议.txt`、`desktop/scripts/nsis-templates.cjs`；新增 `desktop/installer/storage-permissions.ps1`：权限预检/设置、范围登记、数据保留及说明。
- 修改 `desktop/scripts/prepare.cjs`：将三个新运行模块收入构建；`package.json` 增加真实 `test:desktop:storage` 脚本。
- 新增 `desktop/tests/storage.cjs`；修改下载、main-smoke、settings-bootstrap/settings-runtime、packaged、package-inspect、run、installer-policy、download-retention-native、nsis-state/nsis.ps1 及 `desktop/scripts/main-smoke.cjs`：隔离路径和新行为验证。
- 更新 `DESKTOP_GUIDE.md`、`DOCS_INDEX.md` 和三个旧报告的替代说明；新增本报告。现有大量未提交改动属于此前轮次，未将其全部归为本轮工作。

未修改服务器数据库结构、MySQL 配置/凭据/生产数据、提取算法、稳定应用 ID 或依赖版本。仍使用 `cd server` 后 `npm start`，默认 MySQL，桌面显式 SQLite。

## 测试记录

在项目根目录执行，数据与输出均为独立测试目录或只读检查：

| 实际命令 | 预期与实际结果 |
| --- | --- |
| `npm run test:mysql` | 65/65 通过，包含各平台夹具、历史/API/多页/GIF 兼容 |
| `npm run test:mysql:live` | 只读 SELECT/SHOW 成功，14 列，必需列无缺失；未初始化或迁移生产表 |
| `npm run test:desktop` | 13 组通过，真实 SQLite/浏览器/API/关闭重开，新增网页附件实际落盘与字节检查 |
| `npm run test:desktop:main` | 真实 main/preload，旧目录迁移（确认响应注入）、历史/GIF/多页/取消/重启通过 |
| `npm run test:desktop:data` | 14 组通过，一致性备份、损坏拒绝、恢复失败回滚与诊断脱敏 |
| `npm run test:desktop:settings` | 7 组通过，真实 Vue 设置/保存/备份/恢复/诊断；原生对话框注入 |
| `npm run test:desktop:storage` | 11/11 通过，路径/Windows ACL、WAL/关闭库迁移、回滚、冲突、空间、来源变化、取消与反馈 |
| `npm run test:desktop:downloads` | 13/13 通过，无静默回退、自定义目录、重算默认、取消/覆盖确认 |
| `npm run test:desktop:menus` | 2/2 通过，中文编辑/刷新/快捷键/上下文定义与回调 |
| `npm run test:desktop:installer` | 8/8 通过，安装器范围/顺序/数据保护/权限脚本集成 |
| `npm run test:desktop:installer:native` | 52 条生产 NSIS 路径/范围函数断言通过；不是实际安装 |
| `npm run test:desktop:downloads:native` | 原生 NSIS 文件操作夹具通过，升级暂存/回滚/卸载保留 Downloads、personal/SID 历史字节和父目录哨兵 |
| `npm run test:desktop:signing` | 3/3 通过，实际 NotSigned 与第三方完整性策略 |
| `npm run desktop:dist` | 成功，独立候选目录、真实签名状态/第三方散列/元数据/日志 |
| `npm run test:desktop:package -- --production-copy` | 最终包结果见下方；启动未修改 EXE/ASAR 副本，检查真实路径、浏览器、GIF/多页、设置、备份恢复、反馈、双实例与重启 |

日志见 `.desktop-build/storage-*.log`，专项数据见 `server/test-artifacts/desktop-test-results.json`、`120-personal-data.json`、`120-settings-runtime.json`、`desktop-packaged-results.json`、`installer-native-results.json`、`download-retention-native-results.json`。构建目录另含 build.log、verification-report.json、vendor-integrity.json。设置截图 `120-settings-runtime.png`、`120-download-default-runtime.png` 来自打包运行；不是原生安装向导截图。

发现与修复：Windows PowerShell 继承的模块路径导致 Get-Acl 无法加载，改用固定 .NET ACL API；非管理员尝试重设 owner 失败，改为核验 owner 并只设 DACL；已关闭 WAL 数据库读取产生空文件导致误报，已修复并加测试；Chrome 下载控制会话 detach 会重置目录，真实附件测试发现后保留该会话至浏览器关闭。首次并行主进程截图遇到 UnknownVizError，单独重跑通过。测试夹具文件句柄/HTTP keepalive 清理及菜单点击异步等待已修复，未删除失败用例或绕过完整性验证。

## 未完成的验收与限制

- 按用户确认，没有可恢复 VM/专用账户，不运行真实安装/升级/卸载。Program Files 普通用户、全用户 UAC 同意/拒绝、第二账户数据隔离、快捷方式与卸载器视觉、1.0/1.1 各版本升级、取消/失败回滚及干净 Windows 10/11 均未验收。
- 实际 EXE/随包 Chromium 启动及文件落盘已经验证，但不等同安装程序验收。打包副本仅预置独立初始化标记防止接触日常旧数据；邮件/保存等原生对话框注入，不能据此宣称原生界面验收通过。
- 本轮未提供新真实平台链接执行在线提取回归。图怪兽、稿定、创客贴测试为仓库夹具/契约与元数据兼容，真实网站随时可能变化。
- 未迁移用户日常 AppData；首次运行新版由用户确认迁移。遇到未知数据、两份库冲突、缺失文件或权限不支持会明确拒绝，不自动猜测、覆盖或降级。
- 候选未签名、未发布，SmartScreen 可能提示。安装器权限策略需在受支持 NTFS 安装环境及多账户完成验收后再发布。

## 最终候选产物

- 文件：`release\candidates\1.2.0\2026-10-15T05-24-49-853Z-63f0b3\DesignExtractor-Personal-1.2.0-x64-Setup.exe`
- 大小：230640302 字节（约 219.96 MiB）。
- SHA-256：`e4a0311c5c36b03a9dd366f2e3f02fe42fa27969243210b3f948ed1753f27873`。
- 状态：`unsigned_candidate` / Authenticode `NotSigned`，正式签名未启用，未上传。
- 同目录 `.sha256`、`release-metadata.json`、`verification-report.json`、`vendor-integrity.json` 与 `build.log` 均已生成。最新指针为 `release/latest-candidate.json`。
- 最终包自动化：`npm run test:desktop:package -- --production-copy` 已通过 14 组记录，EXE/ASAR 未修改且运行前后哈希一致。真实安装/UAC/第二账户/原生邮件与保存对话框仍未验收。

最终运行证据来自隔离副本 `E:\watermark\watermark\.desktop-build\安装 中文 Path ZmdJHi`，所有运行目录断言位于其 personal 内；其中浏览器程序仍来自 resources。
