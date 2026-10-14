# Windows 桌面个人版

项目同时保留两种运行方式：服务器版使用 Vue + Express + MySQL；个人版使用 Electron + 同一套 Vue/Express/提取器 + SQLite。服务器不需要安装 Electron，桌面程序不需要用户安装 Node.js、MySQL 或 Chrome。

## 普通用户

运行 `release/DesignExtractor-Personal-1.0.0-x64-Setup.exe`。安装器为 Windows x64 NSIS，默认按用户安装，允许选择目录，创建开始菜单和桌面快捷方式。关闭窗口即退出应用，不隐藏到托盘。首次启动会初始化数据库并预热随包浏览器，后端健康检查成功后才显示操作界面。

本次产物尚未代码签名；开发机已验证安装、使用、同版本覆盖安装和卸载，干净 Windows 10/11 与不同版本升级验收仍待执行。详见 [交付报告](DESKTOP_DELIVERY_REPORT.md)。

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
npm run desktop:dev
```

`desktop:dev` 使用构建后的现有 Vue 界面和真实桌面启动链，不依赖固定 Vite/后端端口。开发时修改源码后重新启动。打包与打包测试：

```powershell
npm run desktop:dir
npm run desktop:dist
npm run test:desktop:package
npm run test:desktop:nsis -- -LiveGaoding
```

最后一条会实际按用户安装到 `.desktop-build/NSIS 中文 安装 ...`，运行安装后的程序，测试同版本覆盖安装、卸载和用户数据保留。测试仅创建并清理自己的 SQLite 夹具记录，不访问 MySQL；联网稿定测试依赖分享链接仍公开可访问。不要在正在进行提取任务时运行安装/卸载测试。

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
