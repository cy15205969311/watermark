# DesignExtractor Personal 1.1.1 候选包报告

日期：2026-10-14。开发机 Windows 11 10.0.26200；Node 24.19.0，Electron 44.7.2，electron-builder 26.15.3，NSIS 3.0.4.1。**候选包交付，真实安装验收未完成。** 用户明确选择“没有，先交付候选包并标记安装验收未完成”，本轮未安装、覆盖升级或卸载日常使用的程序。

## 根因与修复

1. 1.1.0 的专用目录校验直接拒绝盘符根目录，未区分浏览选择的父目录和手输的最终目录。现在生产向导共用 `path-state.nsh`：盘符根目录与明确的父目录追加产品文件夹，手输完整自定义目录保持原意，产品目录名大小写不敏感，取消浏览不改变原输入。目录页增加最终位置预览，离页校验后更新编辑框。
2. 旧流程复用 electron-builder 的范围初始化宏，宏会重新读登记及 `/D`，回退或切换范围时可能覆盖用户选择。现在明确维护 `installScope`、目录来源、目录所属范围、自定义路径；切换时同步 shell context 和默认目录，避免 all-user 上下文残留。恢复默认与同范围登记路径分别处理。
3. HKCU 与 HKLM 原登记分别读取、分别按范围选用。离开范围页先检查另一范围冲突，再请求 UAC。提升子进程使用 UAC 支持的全局变量传递宏继承实际范围和自定义意图；不能仅凭管理员身份选中 machine。拒绝 UAC 的分支保留范围页并提示，复制阶段再次检查范围一致性与目标目录。
4. 编译后的实际 NSIS 测试发现 `GetFullPathName` 对不存在的新目录可能失败；移除该磁盘解析步骤，保留已经通过本机盘符、绝对路径和各路径段验证的原目录。不存在盘符、UNC/网络盘、相对路径、设备名、点段与非法字符仍拒绝。

错误状态区分 `invalid_path`、`root_path_normalized`、`network_path_rejected`、`permission_denied`、`insufficient_disk_space`、`scope_mismatch`、`existing_install_conflict`、`uac_cancelled`、`destination_not_empty`，并保留中文说明。空间、权限与非空目录检查继续在复制前执行；磁盘不足、只读与真实 UAC 失败注入未验收。

## 本轮文件

| 文件 | 修改目的 |
| --- | --- |
| package.json / package-lock.json | 桌面版本 1.1.1，增加原生无安装测试命令；依赖版本未升级 |
| desktop/installer/path-state.nsh | 生产与原生测试共享的路径规范化、目录意图、范围选择和冲突分类 |
| desktop/installer/wizard.nsh | 范围同步、UAC 选择传递、最终目录预览、浏览/取消/恢复、中文冲突与错误分支 |
| desktop/installer/installer.nsi | 移除冲突的旧安装器初始化；复制前重新确认范围、提权、冲突、目录 |
| desktop/installer/使用协议.txt | 只更新版本号，保留 MIT 及第三方许可声明 |
| desktop/tests/installer-native.cjs | 编译并执行生产函数，52 项原生断言，不安装、不提权、不写登记 |
| desktop/tests/installer-policy.cjs | 7 项安装配置、页面声明、安全策略与调用顺序检查 |
| desktop/tests/nsis.ps1 | 实际安装测试增加专用环境显式开关，移除会安装到盘符根目录的新旧行为冲突用例，版本报告字段更新 |
| desktop/tests/wizard-session.cjs | Windows 路径匹配与 PNG/JPEG 证据保存支持 |
| desktop/tests/packaged.cjs | 在测试副本中隔离 appData；启动失败时有界退出，避免触碰日常历史 |
| DESKTOP_GUIDE.md / DOCS_INDEX.md / DESKTOP_DELIVERY_REPORT.md / 本报告 | 说明新路径语义、实际命令、候选状态与验收缺口 |

`desktop/builder.cjs` 沿用 1.1.0 已生效的 assisted/perMachine=false/allowElevation 配置，不添加重复配置。没有为本次需求修改 main、MySQL、SQLite、提取器、Vue 业务或 Puppeteer/Chromium 版本。工作区中先前已有的 1.1.0 改动和无关报告删除未回退。

## 实际执行

所有命令在包含 client/server 的项目根目录执行。

| 命令 / 步骤 | 实际结果与证据范围 |
| --- | --- |
| npm run test:desktop:installer:native | 52/52 原生断言通过。使用生产 NSIS include；不会创建目标安装目录或写注册表。结果 server/test-artifacts/installer-native-results.json |
| npm run test:desktop:installer | 7/7 通过；页面顺序是声明检查，不能视为实际 UI 通过 |
| npm run test:mysql | 65/65 通过；MySQL 适配 mock、图怪兽 GIF/多页、稿定动态分页/unknown/partial/历史、创客贴本地夹具；没有生产写入 |
| npm run test:mysql:live | 只读连接成功，14 列，无缺列；仅 SELECT/SHOW |
| npm run test:desktop | 11 项通过；SQLite、认证、浏览器池、前端恢复与关闭。日志 desktop-111-sqlite.log |
| npm run test:desktop:main | 通过；实际 main/preload、GIF 原字节保存、取消、历史重启恢复，隔离 profile。日志 desktop-111-main.log |
| npm run desktop:dist | 成功生成 x64 NSIS，最终构建日志 desktop-111-build.log；前端仅输出 .desktop-build/client-dist |
| 包内容检查 | 3887 项，无 env、SQLite、uploads、测试文件；含 Sharp、提取器、前端及完整 Chrome。最终散列见产物信息 |
| npm run test:desktop:package | 最终通过；隔离插桩副本在中文/空格路径启动随包 Chrome、SQLite、单实例、认证及重启恢复多页/GIF。desktop-111-package-final.log / desktop-packaged-results.json。不是未插桩 EXE 的安装验收 |

原生输入结果：`E:\`（manual/browse）→ `E:\DesignExtractor Personal`；`E:\Applications\`（manual）及 `E:\Applications`（browse）→ `E:\Applications\DesignExtractor Personal`；完整产品目录不重复追加；中文/空格及完整自定义目录保留。测试用真实存在的 E 盘，未伪造不存在的 D 盘；不存在盘符按预期拒绝。范围测试覆盖 user/machine 默认值、来回切换、各自原登记、自定义保留、恢复默认、同范围允许与跨范围拒绝。旧登记是内存夹具，**不等价于真实旧版本安装**。

包运行测试采用构建目录副本加入测试 bootstrap，在未经修改的 main 执行前设置隔离 appData；仅该副本关闭 ASAR 完整性验证，发布 EXE/ASAR 保持原样。最初测试副本重包未正确解包 Sharp 导致模块加载失败，随后隔离目录位于程序副本内触发数据分离断言，均已修正；最终解包 node_modules/@img，数据 profile 位于独立同级目录，完整测试通过。这种受测副本不能替代未插桩发布包的真实安装启动验收。

## 未完成与风险

| 验收项目 | 状态 |
| --- | --- |
| 目录补全前后、旧版冲突实际界面截图 | 未取得有效截图。Computer Use 曾读取旧版欢迎页文本，但捕获图像与目标不符；后续激活失败，重试返回 GetCursorPos 拒绝访问 (0x80070005)。已停止界面输入，异常图像不作为证据交付 |
| 浏览对话框实际选择 E 根目录/父目录/产品目录、取消和恢复按钮 | 原生函数测试完成；真实交互未验收 |
| 当前用户普通权限安装及最终 EXE/Chrome/快捷方式/登记 | 1.1.1 未执行；不得套用 1.1.0 的安装结果 |
| 所有用户 Program Files 实际落盘、机器级登记和快捷方式 | 未执行；只有编译函数与调用顺序证据 |
| UAC 同意、拒绝、权限失败与返回范围页 | 未执行；源码实现不等价于实测 |
| 第二个非管理员账户 SQLite/uploads 隔离 | 未执行；稳定 per-account 数据路径未改变 |
| 1.0.0→1.1.1、同范围覆盖、换目录、取消升级、卸载保留 | 未执行；已保护并更新专用测试脚本，保留旧 EXE |
| 跨范围真实旧版冲突说明截图 | 未执行，未创建假的日常账户安装登记来代替 |
| 非空目录/磁盘不足/只读/UAC 拒绝真实失败注入 | 未执行；保留预检和错误说明 |
| 实时平台 GIF/稿定/创客贴提取下载 | 本轮未联网验收；夹具回归与下载冒烟通过不等价于线上平台验收 |
| 干净 Windows 10/11、代码签名、SmartScreen | 未执行；安装包 NotSigned，无安全信誉认证结论 |

安装与数据目录分离，appId 固定 `com.designextractor.personal`，数据仍按账户存放 `%APPDATA%/DesignExtractorPersonal/personal`。所有用户只共享程序文件。跨范围仍要求备份、保留数据卸载后再安装，不提供无缝迁移；不删除数据库、上传、其他账户或备份。卸载默认保留数据，不提供主动清空选项。框架升级不是事务式回滚，失败恢复仍需旧安装包和个人冷备份。

## 最终产物

安装包：`release/DesignExtractor-Personal-1.1.1-x64-Setup.exe`。Windows x64，版本 1.1.1，产品名“去水印下载助手”，未签名。随包 Puppeteer 21.11.0 / Chrome 121.0.6167.85 未改变。大小和 SHA-256 由最终文件生成，见同目录 `.sha256` 与 `server/test-artifacts/desktop-package-inspection.json`。1.0.0 与 1.1.0 安装包保留。

- 大小：230,090,128 bytes（219.43 MiB）。
- SHA-256：`8d949d6303a0f3d743540e4fc7bdcde5e2783c027e35ae1ca9bb59126fafaeb7`。
- Authenticode：NotSigned；文件版本 1.1.1。

后续在可恢复环境执行指南中的两种范围真实安装命令及人工 UAC/多账户/界面检查；通过前保持候选状态。
