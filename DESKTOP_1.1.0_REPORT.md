# DesignExtractor Personal 1.1.0 安装升级报告

验证日期：2026-10-14。开发机 Windows 11 10.0.26200，测试进程为非提升权限。当前状态：安装器代码及当前用户安装回归完成，**尚未满足完整发布验收标准**。新版向导的实际页面、全用户安装、真实多账户隔离及干净 Windows 10/11 测试尚未完成。

## 实际检查与最小方案

检查了根 package/锁文件、desktop/builder.cjs、prepare/main/config、数据路径、NSIS 安装与卸载测试，以及实际 electron-builder 26.15.3 / NSIS 3.0.4.1 模板。保留 1.0.0 安装包用于跨版本升级。

通过 Windows Computer Use 实际打开 1.0.0 EXE：首屏为范围选择，全用户选项禁用并显示英文管理员提示；下一页确实出现目录编辑框及浏览按钮。因此旧版目录页存在，问题并非配置完全无效，而是欢迎、协议、快捷方式页缺失、提权未开启，目录还会被默认模板追加应用子目录。

1.1.0 使用固定版本模板的定制向导，复用原解包、升级和注册逻辑。自定义脚本路径不会触发 electron-builder 的双阶段卸载生成，因此改为显式 WriteUninstaller，并包含原生卸载页面；没有以空卸载文件绕过构建。所有新增生成文件位于 .desktop-build/nsis，不修改 node_modules。

## 修改文件

| 文件 | 目的 |
| --- | --- |
| package.json、package-lock.json | 根桌面版本 1.1.0，增加 test:desktop:installer；服务端/前端独立版本及依赖不变 |
| desktop/builder.cjs | 中文产品名、辅助安装、当前用户默认、允许提权、中文协议、许可资源；对 Windows 刚复制 EXE 的短暂锁定进行有界等待 |
| desktop/installer/installer.nsi、wizard.nsh | 欢迎→协议→范围→目录→快捷方式→进度→完成；原生卸载、冲突阻止、目录检查、数据保留 |
| desktop/installer/使用协议.txt、NOTICE.md、LICENSE | 安装说明与 MIT 分开；补全 README 既有 MIT 声明，保留上游许可并标明版权/法律审阅需求 |
| desktop/scripts/nsis-templates.cjs | 固定 26.15.3 模板校验及生成；显式原生卸载程序，不改变提取业务 |
| desktop/scripts/notices.cjs、prepare.cjs | 按实际依赖生成许可清单及文本；包含 Electron/Chromium 许可，仍使用隔离构建目录 |
| desktop/main.cjs | 仅将窗口与错误标题统一为“去水印下载助手”；应用 ID、userData、生命周期不变 |
| desktop/tests/packaged.cjs | 与新的产品 EXE 文件名一致 |
| desktop/tests/nsis.ps1、nsis-state.cjs | 真实跨版本、范围冲突、目录迁移、快捷方式、配置/历史/上传保留及卸载检查；只清理本测试夹具 |
| desktop/tests/installer-policy.cjs | 6 项安装策略、许可、页面声明顺序、数据保留和模板集成检查，明确不代替真实 UI |
| desktop/tests/wizard-session.cjs | 基于 Computer Use 观察的真实 UI 测试助手；保存树和截图、检查协议未勾选时禁止下一步，本轮未运行新版会话 |
| DESKTOP_GUIDE.md、DESKTOP_DELIVERY_REPORT.md、DOCS_INDEX.md、本报告 | 新版使用、测试和发布状态；保留旧版交付基线 |

原应用标识为 com.designextractor.personal；个人数据仍为每账户 %APPDATA%/DesignExtractorPersonal/personal。没有修改提取器、Vue 业务页面、数据库适配、服务器启动入口或 MySQL 配置。

## 安装与数据行为

当前用户默认目录为 %LOCALAPPDATA%/Programs/DesignExtractor Personal；全用户为系统解析的 Program Files/DesignExtractor Personal。已有安装默认沿用其登记目录；目录页支持浏览、手输和恢复默认。安装到指定中文/空格路径时不再自动追加子目录。专用空目录或已登记的本应用目录才可使用，拒绝根目录、相对/网络路径和所选目录联接；安装前检查写入权限及空间。

全用户选项在离开范围页时使用 NSIS UAC 提权，失败则显示中文提示并返回选择。当前用户安装无需提升权限。跨范围覆盖返回 1638 并提示先备份、保留数据卸载、再安装，不调用框架自动删除另一范围旧版的路径。

快捷方式默认开始菜单开启、桌面关闭。复选框选择在复制后应用，完成页启动前检查主 EXE 和随包 Chrome 是否存在。默认卸载保留整个个人数据目录；根据需求允许的安全替代方案，本版没有清空数据复选框，主动传入 --delete-app-data 也会被拒绝（87）。**未实现主动删除数据功能，不将其列为通过。**

MIT 使用权不因安装说明而改变；协议文件含开源许可证原文。README 原先声明 MIT，但未有独立 LICENSE；新增文本采用项目贡献者归属表述，尚需发行者审核实际版权归属。第三方清单来自实际后端依赖及前端构建依赖，不声称已经完成法律审计。

## 实际执行的命令与结果

在项目根目录执行，桌面构建 Node 24.19.0，Electron 44.7.2 内置 Node 24.21.0 / SQLite 3.53.4。Puppeteer 21.11.0 / Chrome 121.0.6167.85 未改变。

| 命令 / 场景 | 预期与实际结果 |
| --- | --- |
| npm run test:mysql | 65/65；图怪兽 GIF/多页、稿定分页/unknown/partial/API 历史及创客贴夹具通过。模拟数据库不修改生产历史 |
| npm run test:mysql:live | 真实只读连接成功，14 个历史字段无缺失；仅 SELECT/SHOW，无迁移/写入 |
| npm run test:desktop | 11 项通过：SQLite 创建/重开、数据结构、桌面不加载 MySQL/env、来源保护、浏览器池和有界退出 |
| npm run test:desktop:main | 真实主进程/preload、保存 GIF 原始字节、取消保存、重启恢复通过 |
| npm run test:desktop:installer | 6/6；配置与编译脚本策略通过，不等价于实际页面验收 |
| npm run test:desktop:package | 真实打包 EXE 在中文/空格路径运行、随包 Chrome、单实例、历史/GIF 重启恢复和认证隔离通过。缩减 PATH 仅为开发机冒烟，不替代干净环境 |
| npm run test:desktop:nsis -- -LiveGaoding | 最终 EXE 实际 /S 当前用户安装→1.0.0 升级→非专用目录/磁盘根目录拒绝→范围冲突拒绝→新中文/空格目录→同版本覆盖→卸载；数据身份、三页历史及上传标记保留，非专用目录原文件未变；开始菜单目标迁移及卸载删除，桌面默认不创建 |
| 安装后的稿定真实链接 bbgdyxG0Jdm8ir5koNVTv | HTTP 200，share-api-preview，3/3 complete，页序 1/2/3；pageId 未提供，未伪造 |
| npm run test:desktop:nsis -- -AllUsers | 尝试后因当前测试进程没有管理员权限被测试保护停止；未执行真实全用户安装，不绕过 UAC |
| npm run desktop:dist | 使用真实配置生成 Windows x64 NSIS；详见最终产物记录 |

构建曾遇到 Windows 刚复制 EXE 的 EBUSY，未关闭任何安全设置；增加有限等待并重建。自定义 NSIS 早期编译缺少卸载生成，已经修复且真实卸载通过。卸载程序默认临时复制会掩盖子进程退出码，测试用 _?= 明确等待实际卸载进程后验证 87 拒绝及 0 成功。

测试证据：server/test-artifacts/desktop-110-*.log、desktop-test-results.json、desktop-package-inspection.json、desktop-packaged-results.json、desktop-nsis-currentuser-results.json。报告中的通过仅针对执行过的场景。

## 未执行项目与发布阻塞

| 项目 | 状态与需要的验证 |
| --- | --- |
| 新版真实向导页面、中文按钮、协议未接受禁止继续 | 未执行完。旧版界面检查后 Computer Use 报告收到物理 Escape 中断，本轮已停止界面操作；需重新开始新版观察会话 |
| 新版浏览目录/取消浏览/恢复默认按钮 | 代码与声明检查完成；真实 UI 未完成。实际安装中文/空格路径和登记路径通过 /D 命令测试 |
| 全用户新装、覆盖、UAC 拒绝、权限不足提示 | 未执行；需管理员测试会话及标准用户拒绝权限场景 |
| 两个真实 Windows 账户 SQLite/uploads 隔离 | 未执行；稳定按账户 appData 路径保留，但不能据此声称多账户实测通过 |
| 桌面快捷方式主动勾选/取消、完成页启动 | 默认策略已实际验证；勾选交互及完成页启动待真实 UI 测试 |
| 取消升级、磁盘不足、只读、强制中断后旧版恢复 | 新增预检；未实际注入这些失败。沿用框架卸载旧版再复制流程，不承诺事务式升级回滚；保留 1.0.0 安装包和个人冷备份用于恢复 |
| 主动清空个人数据 | 有意不实现；采用需求允许的保留方案，删除参数拒绝实测通过 |
| 干净 Windows 10/11 | 未执行，开发机测试不能替代 |
| 实时图怪兽 GIF、创客贴下载 | 本轮没有提供可验证真实链接；夹具/主进程下载通过，仍需实时平台验收 |
| 签名与 SmartScreen | 未签名；没有代码签名证书、信誉或安全认证结论 |

发布前请在可恢复的测试虚拟机中分别验证两个安装范围，按 1.0.0→1.1.0、变更目录、拒绝 UAC、取消升级、失败恢复、不同账户数据及卸载的顺序记录结果。程序关闭后冷备份整个 personal 目录（含 config、SQLite、uploads 及存在的 WAL/SHM）。本版不自动迁移数据库，不自动删除用户备份，不访问服务器 MySQL。

## 最终产物

安装包：release/DesignExtractor-Personal-1.1.0-x64-Setup.exe。

- 大小：230089556 bytes。
- SHA-256：05c4ddef93b3480043ab36d21690a77681f43cea0e1d4c60c6f9ef966b709085。
- 版本：1.1.0，Windows x64；产品名：去水印下载助手；签名状态：NotSigned。
- 同目录 .sha256 文件用于复核。1.0.0 原安装包继续保留。
- 此产物为待完成界面/全用户/干净环境验收的候选包，不称为发布验收通过。
