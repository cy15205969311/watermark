# Windows 桌面个人版

项目同时保留两种运行方式：服务器版使用 Vue + Express + MySQL；个人版使用 Electron + 同一套 Vue/Express/提取器 + SQLite。服务器不需要安装 Electron，桌面程序不需要用户安装 Node.js、MySQL 或 Chrome。

## 普通用户

运行候选包 `release/DesignExtractor-Personal-1.1.1-x64-Setup.exe`。产品显示名称为“去水印下载助手”。安装器配置为简体中文向导：欢迎、接受安装使用说明、安装范围、安装目录、快捷方式、安装进度、完成。默认仅为当前用户安装，开始菜单快捷方式默认开启，桌面快捷方式可选；完成页可选择立即启动。新版向导实际页面尚待人工验收，不能将配置检查当作界面验收通过。关闭窗口即退出应用，不隐藏到托盘。首次启动会初始化数据库并预热随包浏览器，后端健康检查成功后才显示操作界面。

1.1.1 未签名，按用户选择先交付候选包，本轮不执行真实安装、升级、卸载。目录规范化与范围冲突已通过编译后的原生 NSIS 测试；真实向导截图、UAC、两种范围安装、多账户隔离及干净 Windows 10/11 均未验收。详见 [1.1.1 候选包报告](DESKTOP_1.1.1_REPORT.md)。1.1.0 的开发机安装记录仅作为旧版基线，不代替新版验收。

当前用户默认目录为 `%LOCALAPPDATA%/Programs/DesignExtractor Personal`；所有用户默认目录为 `%ProgramFiles%/DesignExtractor Personal`，必要时由 Windows 请求管理员权限。升级默认沿用同范围已登记目录。切换范围时默认目录同步，自定义目录保留并重新校验。目录页显示最终目录预览：输入 `E:\` 会补全为 `E:\DesignExtractor Personal`；输入 `D:\Applications\` 表示父目录并追加产品文件夹；手输完整自定义目录（不以反斜杠结尾）保持原意。浏览选择磁盘或上级目录时自动追加产品文件夹，已选择产品目录则不重复追加（大小写不敏感）；取消浏览保留输入。“恢复默认目录”使用当前范围。安装目录必须是专用空目录或本应用原安装目录，不支持磁盘根目录作为最终位置、相对路径、网络路径及不存在的盘符。

已有安装请选择相同范围升级。跨范围覆盖会提示并停止，不会静默卸载旧版；如需转换范围，请先冷备份个人数据，再卸载原程序并重新安装。所有用户安装只共享程序文件，每个账户仍使用自己的 `%APPDATA%/DesignExtractorPersonal/personal` 数据。

卸载只删除程序及所属范围的快捷方式，保留个人数据。本版采用安全保留方案，不提供自动删除个人数据的复选框，也拒绝 `--delete-app-data` 参数。安装使用说明与 MIT、第三方开源许可分开；许可清单位于安装目录 `resources/licenses`，发布前需审阅版权归属及说明文本。

## 桌面菜单与图标

当前 1.1.1 候选包合入菜单体验修复，版本号未变。顶部为“应用 / 编辑 / 查看 / 帮助”：应用可打开日志文件夹、个人数据文件夹或退出；编辑保留 Ctrl+Z/Y/X/C/V/A；查看提供刷新、恢复默认缩放、放大、缩小；帮助复用现有使用教程，并提供日志和真实版本信息。

输入框右键使用中文编辑操作，按 Chromium 的编辑状态启用；已选普通文本只提供复制，图片和空白区域不添加未实现的命令。解析、上传、批量删除或下载期间刷新会先提示，默认取消刷新。若主动选择“仍然刷新”，当前界面尚未保存的状态可能丢失，后台任务不保证随刷新取消。F5 等刷新路径也受 beforeunload 保护；退出菜单沿用正常资源清理。

窗口、应用 EXE、安装器和卸载器配置统一引用 `desktop/assets/DesignExtractor-Personal-icon.ico`。构建不再从旧 SVG 重生成图标。EXE/安装包的 7 个 ICO 图像资源已做二进制比对；已安装快捷方式与卸载器的视觉效果仍需专用环境验收。菜单实际截图、测试结果与新散列见 [菜单与图标报告](DESKTOP_MENU_REPORT.md)。本轮未增加设置中心或更新服务。

## 服务器版保持原启动方式

```powershell
cd server
npm ci
npm start
```

继续读取原 `server/.env.production`、`.env` 等配置，默认 MySQL、默认端口 3000，保留 HOST/PORT 配置和端口递增行为。前端仍可 `cd client; npm run dev` 或 `npm run build` 后按原部署方法运行。MySQL 连接失败不会切换 SQLite。原 MySQL 表、驱动、环境文件和已有数据均保留。

第三方 TSGPT 网关必须显式配置 `TSGPT_TOKEN`；旧源码内置的默认凭证已移除。未配置时跳过该第三方网关，现有本地平台提取器继续工作。配置文件在模块加载后读取的 token 也能生效。

## 开发与构建

桌面构建机器需要 Windows x64、Node.js 22.13+（推荐 24）和 npm。以下命令在包含 client/server 的项目根目录执行；最终用户无此要求。

```powershell
npm ci
npm --prefix server ci
npm --prefix client ci
npm run desktop:prepare
npm run test:mysql
npm run test:mysql:live
npm run test:desktop
npm run test:desktop:main
npm run test:desktop:menus
npm run desktop:dev
```

`desktop:dev` 使用构建后的现有 Vue 界面和真实桌面启动链，不依赖固定 Vite/后端端口。开发时修改源码后重新启动。打包与打包测试：

```powershell
npm run desktop:dir
npm run desktop:dist
npm run test:desktop:package
npm run test:desktop:installer
npm run test:desktop:installer:native
# 仅在可恢复虚拟机或专用测试账户，以下会真实安装/升级/卸载：
npm run test:desktop:nsis -- -DisposableEnvironment -LiveGaoding
# 在专用管理员测试终端及无旧安装的测试账户中：
npm run test:desktop:nsis -- -DisposableEnvironment -AllUsers
```

`test:desktop:installer:native` 编译生产使用的相同 NSIS 路径/范围函数，只写隔离报告，不安装、不提权、不写登记。`test:desktop:package` 仅在构建目录副本加入测试启动器并关闭该副本的 ASAR 完整性校验，以隔离 appData；发布包保持原样，该冒烟不代替原包安装验收。

`test:desktop:nsis` 会实际安装到 `.desktop-build/NSIS 旧版/新版 中文 Path ...`，运行安装后的程序，测试 1.0.0 到当前版本、目录变更、范围冲突、同版本覆盖、快捷方式、卸载及用户数据保留。必须显式指定 `-DisposableEnvironment`，否则启动前停止；不要在日常账户运行。全用户模式测试新装与覆盖，不声称旧版支持全用户安装。测试遇到已有登记的安装会停止；只创建并清理自己的 SQLite 夹具和上传标记，不访问 MySQL。保留的 1.0.0 EXE 是跨版本测试必需文件。联网稿定测试依赖分享链接仍公开可访问。不要在提取任务运行时测试安装/卸载。自动化使用 `/S`，另需验证真实向导界面及 UAC 同意/拒绝。

`test:mysql` 使用现有回归脚本及隔离数据库 mock；`test:mysql:live` 读取服务器配置，只执行 SELECT/SHOW，不运行迁移或修改历史。真实服务器 `npm start` 仍会按旧逻辑检查所需列。

构建产物位于 `release/`；暂存依赖、浏览器和前端位于 `.desktop-build/`。桌面前端构建输出到 `.desktop-build/client-dist`，不覆盖服务器的 `client/dist`，不修改任何 env 或数据库文件。

Electron 44 在首次使用时下载二进制，Puppeteer 下载或复用其版本匹配的构建缓存。网络无法访问 GitHub 时，可在开发终端显式设置镜像后重试（不关闭 TLS）：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
node node_modules/electron/install.js
npm run desktop:dist
```

安装包包含完整 Chrome 目录，运行时不依赖开发机缓存。当前保留 Puppeteer 21.11.0 / Chrome 121.0.6167.85 的匹配组合，升级浏览器需同时验证提取器，不能仅替换 chrome.exe。

## 数据目录、备份与恢复

默认数据目录：`%APPDATA%/DesignExtractorPersonal/`，稳定应用标识为 `com.designextractor.personal`。其中：

```text
personal/
  config.json       桌面配置版本、稳定历史记录身份
  history.sqlite    SQLite 历史数据库
  uploads/          本地上传及处理后的图片
  logs/desktop.log  脱敏日志，2 MiB 轮转，保留 3 份旧日志
  temp/             Chromium 独立临时配置目录
```

正常退出会完成有限的任务等待、关闭浏览器、清理临时配置目录、关闭 HTTP 服务和 SQLite，并执行 WAL checkpoint。SQLite 使用 WAL、外键、5 秒 busy timeout、独立 `user_version` 迁移和历史索引；每条写入由 SQLite 原子事务提交，迁移使用显式事务。

冷备份步骤：退出应用并确认其进程已结束，复制整个 `personal` 目录到备份位置。必须同时保留 `config.json` 和 `uploads`；仅恢复数据库而丢失历史身份配置会导致列表看不到原记录。异常退出后若存在 `history.sqlite-wal`/`-shm`，也要一起备份，优先先重新启动并正常退出再备份。

恢复步骤：退出应用，先另存当前 `personal` 目录，再将选定备份恢复到相同位置后启动。恢复会替换当前本地历史，应由用户明确选择备份执行。应用没有自动清空、导入 MySQL 或删除用户数据的功能。普通升级和卸载默认保留用户数据；卸载不等于清除历史。

## 生命周期与安全

主进程显式配置 SQLite，完全跳过服务器 env 加载和 MySQL 初始化。SQLite 失败直接报告错误，不回退其他数据库。Express 绑定 `127.0.0.1` 的自动端口，窗口通过 preload 获取实际 API 地址和稳定 clientId。会话凭证只由主进程注入匹配本地来源的 API/上传请求，渲染进程不能读取该凭证；Host、Origin 和凭证均受校验。

窗口启用 sandbox/contextIsolation/webSecurity，禁用 Node 集成。preload 只提供连接信息、日志目录和经过校验的资源保存操作，不暴露任意文件系统或进程执行。外部官方分享链接使用系统浏览器打开，主窗口不能导航到远程页面或上传文档。保存图片/GIF 按原始字节写入用户选择的位置，不做格式转换；多页逐页保存，用户取消即停止后续保存。

退出先拒绝新 API 任务，最多等待 8 秒处理请求，再关闭所有追踪到的 Puppeteer 浏览器及连接池、HTTP 和数据库。浏览器启动有 10 秒上限，关闭有进程树清理兜底；应用整体有 30 秒退出上限。Windows 强制结束进程不能保证运行清理回调，SQLite WAL 用于保护已经提交的事务。未加入自动更新器，升级通过新安装包执行。

## 排查

应用菜单可打开日志及数据目录。启动前失败时也可直接到上述目录查找日志。

| 提示/现象 | 处理 |
| --- | --- |
| 随包 Chromium/前端资源缺失 | 从完整安装包重新安装，不要只复制 exe |
| 浏览器无可用实例 | 检查日志中的版本、路径、启动参数和失败原因，以及安全软件是否隔离浏览器文件 |
| 数据库损坏 | 先备份当前 personal，退出后从备份恢复；不要删除数据库尝试“修复” |
| 空间不足/只读/权限错误 | 清理空间、检查用户数据目录权限后重试，界面保留具体错误 |
| 本地服务拒绝访问 | 只通过桌面窗口使用；外部浏览器直接访问 API 会被拒绝 |
| 提取失败、签名过期或需要登录 | 查阅脱敏平台日志并检查公开分享权限；不会自动标记成完整结果 |
| 只有一页且完整性 unknown | 保留现有提取器的未知状态，不能据此推断设计稿总共只有一页 |

## 发布前人工验收

- 在未安装 Node.js/MySQL/Chrome 的干净 Windows 10、Windows 11 x64 各执行安装、启动、真实平台提取、GIF 下载、多页顺序、历史恢复、退出。
- 在中文/空格路径安装，验证开始菜单、桌面快捷方式、非管理员用户和磁盘/权限错误提示。
- 以两个实际不同版本验证升级、历史保留和卸载；测试操作系统关机和强制终止后的恢复。
- 用仍可访问的图怪兽 GIF、稿定单页/多页、创客贴链接重复联网验收；夹具成功不能代替平台实时访问成功。
- 配置代码签名后验证签名及安装体验。普通 NSIS 不代表满足应用商店要求。

测试产物和截图保存在 `server/test-artifacts/`，已从 Git 与安装包排除。

图怪兽网页回归使用独立媒体夹具，可在 PowerShell 中执行：

```powershell
$env:VITE_API_TARGET = 'http://127.0.0.1:5180'
$env:TEST_UI_BASE_URL = 'http://127.0.0.1:5189'
python C:/Users/阿达/.codex/skills/webapp-testing/scripts/with_server.py --server "npm --prefix client run dev -- --host 127.0.0.1 --port 5189 --strictPort" --port 5189 -- python server/test-818ps-ui.py
```
