# 1.1.1 候选版：中文菜单与图标交付

日期：2026-10-14。本轮合入尚未正式发布的 1.1.1 候选版，不提升版本号。Windows x64 安装包已重新构建，仍为未签名候选包，安装、升级、卸载及干净环境验收未完成。用户已选择先交付候选包。

## 实现与范围

原生“编辑 / 查看”仅配置 Electron role，缺少显式中文 label，因此使用默认英文。原程序没有 context-menu 处理器。构建脚本还会从旧 SVG 生成 ICO，导致只更换图标文件不能保证发布包使用它。

现在原生菜单为“应用 / 编辑 / 查看 / 帮助”，各项显式中文 label，编辑与缩放继续使用标准 Electron role。撤销/重做/剪切/复制/粘贴/全选对应 Ctrl+Z/Y/X/C/V/A；刷新 Ctrl+R，默认缩放 Ctrl+0，放大 Ctrl++，缩小 Ctrl+-。退出调用 app.quit，沿用有界后端、浏览器池、数据库关闭流程。

上下文菜单由主进程注册一次，使用真实 Chromium editFlags 决定启用状态；输入框提供中文编辑项，非编辑区选中文本只提供复制，图片/空白区不虚构业务操作。帮助菜单复用 Vue 已有教程、日志目录和真实版本/SQLite/MIT 说明，不增加更新服务或设置中心。

Vue 仅新增忙碌状态、教程事件和 beforeunload 桥接。提取与保存、上传、批量删除、图片下载计入忙碌状态，主进程同时追踪排队资源保存及 Chromium 下载。菜单刷新和其他触发 beforeunload 的刷新先弹出中文确认，默认取消；主动继续会丢失当前界面状态，不保证取消后台任务。正常 app.quit 时不重复要求刷新确认。preload 只新增布尔状态和限定教程订阅，不暴露任意 IPC、文件系统或进程能力。

服务器、MySQL/SQLite 适配器、数据目录、稳定 appId、平台提取器及 GIF 下载字节处理均未修改。服务器仍以 `cd server && npm start` 运行，默认 MySQL；桌面仍显式 SQLite。Puppeteer 21.11.0 / Chrome 121.0.6167.85 不变。

## 修改文件

| 文件 | 原因 |
| --- | --- |
| desktop/menus.cjs（新增） | 中文原生菜单、条件右键菜单、刷新确认及真实帮助回调 |
| desktop/main.cjs | 接入菜单与可信 busy IPC；追踪资源下载；窗口引用新 ICO |
| desktop/preload.cjs | 限定忙碌状态/教程事件接口及可取消订阅 |
| client/src/App.vue | 汇报真实任务状态、复用教程、保护刷新；下载逻辑外层计数，不更改格式与资源选择 |
| desktop/builder.cjs | Windows 应用、安装器、卸载器统一引用用户提供的 ICO |
| desktop/scripts/prepare.cjs | 暂存菜单模块和原始多尺寸 ICO，停止从旧 SVG 生成图标 |
| desktop/tests/menu-policy.cjs（新增） | label/role/accelerator、编辑状态、确认取消/继续、退出及回调测试 |
| desktop/tests/menu-runtime.cjs（新增） | 实际打包 Electron role、文本编辑快捷键、缩放、教程、忙碌刷新及闲时刷新 |
| desktop/tests/packaged.cjs | 接入菜单运行回归、有限隔离 UI 会话与本地延迟夹具 |
| desktop/tests/package-inspect.cjs | ASAR 图标一致性与实际 Windows EXE/安装包 ICO 资源比对 |
| package.json | 新增 test:desktop:menus，版本与依赖不变，锁文件无需变更 |
| DESKTOP_GUIDE.md / DESKTOP_1.1.1_REPORT.md / DESKTOP_DELIVERY_REPORT.md / DOCS_INDEX.md / 本报告 | 使用说明、最新散列、实际证据及未验收项 |

原图标 `desktop/assets/DesignExtractor-Personal-icon.ico` 原样复用，源文件不被构建覆盖。旧 icon.ico/icon.svg 保留为未使用的历史资源。

## 实际测试

以下命令均在包含 client/server 的项目根目录执行。修改前四项基线均通过，日志 `server/test-artifacts/menu-baseline-{mysql,desktop,main,package}.log`；修改后结果如下。

| 命令 | 实际结果 | 证据 |
| --- | --- | --- |
| npm run test:mysql | 65/65；MySQL mock 与图怪兽 GIF/多页、稿定单页/动态分页/partial/unknown/历史、创客贴本地夹具 | menu-final-mysql.log |
| npm run test:desktop | 11/11；真实 Electron SQLite、迁移、历史、认证、浏览器池及关闭 | menu-final-sqlite.log |
| npm run test:desktop:main | 通过；真实 main/preload、GIF 原字节保存/取消、历史重启及资源关闭，隔离 profile | menu-final-main.log |
| npm run test:desktop:menus | 2/2；中文定义、快捷键、上下文状态、刷新/退出策略 | Node 测试输出 |
| npm run test:desktop:installer | 7/7；现有安装器策略回归，非实际安装 | Node 测试输出 |
| npm run desktop:dist | 成功；前端输出 .desktop-build/client-dist，不覆盖服务器构建 | menu-111-build-final.log |
| npm run test:desktop:package | 通过；最终包菜单 role 和编辑快捷键、缩放回调、教程、解析期间刷新取消、直接 reload 取消、空闲 reload；Chromium、认证、单实例、重启后多页/GIF 历史 | menu-final-package.log / desktop-packaged-results.json |
| node --check desktop/main.cjs / desktop/preload.cjs / desktop/menus.cjs | 通过 | 实际命令输出 |
| 包内容与图标 | 3888 项；无 env、SQLite、uploads、测试文件；应用 EXE 与安装包各匹配全部 7 个 ICO 图像资源 | desktop-package-inspection.json |

日志及 JSON 位于 `server/test-artifacts/`。MySQL 本轮回归使用隔离 mock，不等价于新执行的真实 MySQL 数据库联调；未运行生产迁移。平台使用本地夹具，本轮未联网验收真实图怪兽/稿定/创客贴链接。

包测试和 UI 观察在 `.desktop-build/安装 中文 Path ...` 的程序副本运行。仅测试副本增加 bootstrap 隔离 appData、关闭该副本 ASAR 完整性校验；发布 EXE/ASAR 未插桩。没有在日常账户执行安装、卸载、旧版覆盖或写入日常历史。最终原始发布包安装后的实际行为仍需专用环境验证。

测试修正记录：Windows ASAR 提取路径需使用 path.join；Electron 44 剪贴板采用异步 ClipboardItem API，编辑测试会保存并恢复格式且不记录内容；Playwright 自动处理 beforeunload 与 Electron 原生确认冲突，已由测试监听器让 Electron 负责确认。CDP 键盘事件不能代替 Windows 原生菜单加速键，移除该路径的缩放断言，改用真实 Windows 输入验收。

## 实际界面与操作

使用 Computer Use 在隔离的打包程序副本中观察，非 Vue 网页菜单模拟。截图原文件保存在 [menus-111](server/test-artifacts/menus-111)。

| 项目 | 实际结果 | 截图/范围 |
| --- | --- | --- |
| 修改前菜单 | 实际复现 Undo/Redo/Cut/Copy/Paste/Select All、Reload/Actual Size/Zoom In/Zoom Out | before-edit-1.jpg / before-view-1.jpg |
| 修改后应用/编辑/查看/帮助 | 四个原生菜单均实际打开，文字中文，快捷键显示正常 | after-app-1.jpg / after-edit-1.jpg / after-view-1.jpg / after-help-1.jpg |
| 输入框右键 | 文字中文；未选中时剪切/复制禁用；选中后启用；点击“全选”确实选中内容 | after-context-1.jpg / after-context-selected-1.jpg |
| 使用教程 | 帮助入口打开已有真实教程并关闭 | after-tutorial-0.jpg |
| 日志目录 | 实际打开 Explorer，指向隔离 profile 下 DesignExtractorPersonal/personal/logs | after-open-logs-1.jpg |
| Ctrl+R 活动任务保护 | 本地延迟响应使界面进入真实 loading；Ctrl+R 弹中文确认，点击取消后输入和解析状态保留，未访问平台 | after-busy-refresh-1.jpg / after-refresh-cancelled-0.jpg |
| Ctrl++ | 真实 Windows Ctrl+Shift+= 输入放大界面；非 CDP 推断 | after-zoom-key-0.jpg |
| 新图标 | 实际窗口左上角为新蓝色图标，应用/安装包 PE 资源另经二进制比对 | after-window-0.jpg / after-busy-refresh-0.jpg |

修改前后编辑菜单对照：

![修改前英文编辑菜单](server/test-artifacts/menus-111/before-edit-1.jpg)

![修改后中文编辑菜单](server/test-artifacts/menus-111/after-edit-1.jpg)

任务刷新确认：

![中文刷新确认](server/test-artifacts/menus-111/after-busy-refresh-1.jpg)

用户按物理 Esc 停止了 Computer Use，随后停止所有界面操作。真实 Ctrl+-/Ctrl+0、个人数据 Explorer 入口、关于原生对话框、退出菜单逐项点击未完成；对应 role/回调、版本信息及资源清理已通过自动化，不标记为人工通过。实际下载过程中的刷新确认、历史搜索输入框右键及不同只读控件尚待人工覆盖，通用状态策略已测试。UI 会话有 15 分钟上限并使用现有关闭流程。

## 图标与发布产物

图标源 SHA-256：`ae2238038602ca8982223e7315391583aeaee891a3a1ddf77f73a6b9ec6e2b64`。ICO 包含 16/24/32/48/64/128/256 尺寸，暂存包中的图标与源文件逐字节一致；应用和安装包各 7 个 RT_ICON 数据均与源 ICO 图像匹配。开始菜单/桌面快捷方式引用应用 EXE，卸载器配置引用同一 ICO，但本轮没有安装后的视觉证据，不能称已验收。

- 安装包：[DesignExtractor-Personal-1.1.1-x64-Setup.exe](release/DesignExtractor-Personal-1.1.1-x64-Setup.exe)
- 大小：230,623,880 bytes（219.94 MiB）。
- SHA-256：`010c3814c54ed6f86cdbded05ab392d8d52fd500337ba4dbc0e5ed17929017b7`。
- 校验文件：[安装包 SHA-256](release/DesignExtractor-Personal-1.1.1-x64-Setup.exe.sha256)。
- 版本：1.1.1；Authenticode：NotSigned。旧安装器阶段散列不再代表当前候选文件。

## 未完成与风险

- 原始安装包的安装向导、当前/所有用户落盘、UAC、多账户隔离、1.0.0 升级、卸载保留数据：未执行，延续 [安装器报告](DESKTOP_1.1.1_REPORT.md) 的缺口。
- 已安装快捷方式及卸载器图标、Windows 图标缓存：未实测。
- 干净 Windows 10/11、签名、SmartScreen：未验收；不能将移除 PATH 的开发机测试当作干净环境。
- 真实平台实时提取和下载：未联网验收；本地提取夹具、GIF 原字节保存、多页/完整性历史回归通过。
- 上述人工菜单剩余项目在用户停止界面控制后保留待验收。本轮不宣称全套发布验收完成。
