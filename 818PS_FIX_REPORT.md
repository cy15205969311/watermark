# 818ps 完整页面与 GIF 修复验收记录

测试日期：2026-10-13。实际项目目录：`E:\watermark\watermark`。

## A. 根因与真实调用链

主链路为 `index.js /api/extract-image → resolvePlatform → imageExtractor.extractImage → 第三方网关 → extract818psImage → extractors/818ps.extract818ps → normalizeExtractPayload`。保存由独立的 `/api/parse` 完成，不会再次抓取；历史记录通过 `/api/history` 返回，Vuex 恢复后由 App 结果弹窗与下载组件使用。`imageController.js` 是另一套兼容入口，主 Express 服务没有使用它。

初次访问静态复现链接时，公开接口的 `page_map` 和 `doc.pageAttr.pageInfo` 都确认只有一页。主预览处于 `ips_user_preview_api` 路径，旧路径黑名单将其排除；`doc.work[].attribute.picUrl` 中的 `psd_import/.../1.png` 是 318×307 的局部素材，画布尺寸为 1242×1660。原日志的 `pageCount: 1` 只能表示返回一张图片，不能证明返回整页。分享 API、静态和动态分析原先均有“拿到部分图就返回”的路径，归一化还会重建连续页码。

GIF 候选由 `818ps-pages.js buildPageResult` 最终选择。原策略只比较来源评分与尺寸，没有动画优先级；`image_signature_verified` 只确认文件头，并未验证帧数、时长或完整文件。原 `duplicates: 3` 是去掉 CDN 处理后缀后的路径归并，没有二进制相同性证据。

当前 GIF 链接公开接口已改为 `gif_complete_img/...gif`，与用户先前日志的 `ips_user_preview` 路径不同。真实完整 GET 结果如下：

| 公开候选 | 实际格式 | 单帧尺寸 | 帧数 | 总时长 | 文件字节数 |
| --- | --- | --- | --- | --- | --- |
| share-template `!l1600` | GIF | 572×900 | 24 | 1920ms | 489224 |
| team-share `!l1000_b` | JPEG | 572×900 | 1 | 不适用 | 120229 |
| big_img `!w380_webp` | WebP | 380×598 | 24 | 1920ms | 582364 |
| small_img `!w128_h128` | JPEG | 81×128 | 1 | 不适用 | 5216 |

`gifInfo[].imagePath` 指向画布中的动画元素；同一画布还有七个文字/SVG 元素，因此该 URL 不能作为合成后的完整设计稿。未找到可以证明为原始完整动画文件的独立字段。已取得的是动态预览。

前端结果弹窗原本使用页面数组的首图，下载也遍历数组；它并非只显示 thumbnail。漏洞在于缩略图混入数组、动画字段未被 Vuex/存储白名单保留、下载允许将 GIF 文件命名为 PNG。旧代理只支持花瓣，并没有使用 Sharp 转换 GIF；本次扩展图怪兽 CDN 后仍直接转发原始字节。

## B. 修改文件

| 文件 | 修改作用 |
| --- | --- |
| server/extractors/818ps.js | 按完整性收集/合并各阶段；复用浏览器池；等待真实切页；受控完整动画 GET；校验和诊断 |
| server/extractors/818ps-pages.js | 页面证据、素材上下文、保留页码、动画优先选择、内容哈希去重及完整性状态 |
| server/extractors/818ps-animation.js | GIF 块结构、完整性、帧延迟与循环解析，Sharp 多帧元数据和解码验证 |
| server/imageExtractor.js | 818ps 第三方结果不抢先结束；兼容兜底验证；避免重复网关调用 |
| server/utils/extractPayload.js | 完整性与动画字段白名单；主动画地址、静态缩略图及页数组分离 |
| server/index.js | 响应/保存/历史字段透传；二进制代理支持 GIF、HEAD 和 Range；凭证脱敏；可导入测试 |
| server/services/browser-pool.js | 等待上限、并发创建计数及重复归还保护（完整页面修复阶段） |
| server/thirdPartyApiGateway.js | 证书错误不重复请求；暂时错误有限重试；818ps 不复用单图缓存（完整页面修复阶段） |
| client/src/store/index.js | 恢复全部页面和动画信息，避免将缩略图加进下载数组 |
| client/src/App.vue | 动画预览/下载使用主资源；按页实际媒体格式命名；保存状态与警告；818ps 失败不伪造占位结果 |
| client/src/utils/imageProxy.js | 图怪兽图片使用保持签名的服务端字节代理 |
| client/src/components/HistoryItem.vue | 动态预览、静态降级、缺页及完整性未知提示 |
| client/src/components/DownloadDialog.vue | 动态资源不再提供静态格式改名，显示动态主预览 |
| database/schema.sql | 新库包含 nullable extraction_metadata_json，已有库由现有自动补列机制兼容 |
| server/test-818ps-regression.js | Node 内置测试、可控 HTTP/JSON/图片夹具、真实 Chromium 切页及隔离数据库 HTTP 回归 |
| server/test-818ps-ui.py | Playwright 原生播放、实际下载字节、历史与保存回归 |
| server/test-818ps-optimized.js / test-extractors.js | 日志脱敏、动画/完整性输出、关闭测试浏览器池、失败退出码 |
| .gitignore / 818PS_EXTRACTION_LOGIC.md / 本报告 | 忽略临时诊断资源与测试输出，记录当前行为和验收限制 |

## C. 页面与 GIF 验证流程

URL 解析 → 分享接口结构化候选与总页数证据 → 原始 URL 验证 → 已知公开路径 → 静态 JSON/HTML → 浏览器网络 JSON/DOM/滚动 → 顺序分页激活 → 增量合并 → 选每页有效主资源 → 完整性判断。可靠证据确认所有页有效后可结束；动画目标还要求已取得有效动态候选。素材集合不参与页面统计，部分结果保留缺页号，未知总数不伪报完整。

GIF 目标或 GIF 候选执行完整 GET，保留授权参数。文件上限 20MiB、完整 GET 上限 12 秒、动画验证并发 2、最多 400 候选；GIF 最多 1000 帧、解码像素上限 8000 万。普通图片使用有界文件头请求，不无差别下载全部图片。GIF87a/GIF89a 签名之后继续解析每个图像块、子块、GCE 延迟和结束 trailer；再以 Sharp `animated: true` 读取多帧元数据并实际解码，拒绝截断或损坏数据。零延迟是合法输入，未给延迟时保持 durationMs=null。

同一 CDN URL 变体独立下载验证，以实际格式判定 GIF、静态 GIF、静态图片或动画 WebP。完整内容哈希相同才计为二进制重复；不同角色/格式的变体保留在诊断中，再按页选主资源。没有原始角色证据时不能标记 original_animation。

## D. 返回字段和资源选择

兼容 `imageUrl/imageUrls/images/pages/pageCount/isMultiPage/source/metadata`。新增/保留 `expectedPageCount/collectedPageCount/pageCountConfidence/completenessStatus/isComplete/missingPages/warnings`。

GIF 目标增加 `mediaType/detectedFormat/isAnimated/frameCount/durationMs/loopCount/animationUrl/animationStatus/resourceRole`。主资源选择顺序为：验证有效且具有明确原始角色证据的动画 → 已验证 GIF 动态预览 → 其他已验证动态预览 → 静态预览。静态高分/大尺寸不会覆盖有效动画。

当前真实 GIF 响应的核心值：`pageCount=1`、`expectedPageCount=1`、`pageCountConfidence=verified`、`completenessStatus=complete`、`mediaType=image/gif`、`isAnimated=true`、`frameCount=24`、`durationMs=1920`、`loopCount=0`、`animationStatus=verified_animated`、`resourceRole=animation_preview`。主资源和 animationUrl 为已验证 `!l1600`，thumbnailUrl 独立采用 `small_img`。complete 表示设计页覆盖完整，不代表无水印、原始文件或平台授权类型。

## E. 前后端与存储

HTTP 响应和 `/api/parse` 使用同一字段白名单。全部页面 JSON 与动画元数据分开保存；`extraction_metadata_json` 由既有非破坏性补列机制增加，不删除或重建表。本次没有连接生产 MySQL 执行写入或迁移。历史恢复支持旧记录缺字段。

Vuex 保留动画元数据；列表使用 thumbnailUrl，结果大图和下载使用主资源/animationUrl。动态下载保留实际 GIF/WebP 格式，每页名称保留实际页码。代理保持二进制、Content-Type、长度与 Range，校验重定向主机，不做截图/Canvas/Sharp 转换。签名失效或加载失败提示重新解析，临时链接不当作永久有效资源。

## F. 实际测试结果与运行方法

- Node 回归：23 项通过，0 项失败，0 跳过。覆盖单页、多页排序、封面补全、真实延迟切页、拒绝旧预览、素材过滤、同页版本、缺页、证据冲突、GIF/单帧/动画 WebP、错误内容类型、HTML 错误页、截断、403、HEAD 回退、证书策略、签名保留、HTTP 保存/历史与字节代理。
- 前端浏览器：7 项检查通过。观察到不同帧的真实渲染像素；下载文件与原夹具逐字节一致，重新解析为两帧 GIF；动画字段与独立封面正常保存；旧记录和缺页提示正常；无前端运行时异常。截图和下载夹具在 server/test-artifacts，由测试自动生成。
- 其他平台：创客贴、稿定、Canva、花瓣统一归一化回归通过，专属分支保留。没有对所有其他平台真实远程资源作联网验收。
- GIF 真实链接：两个现有提取脚本通过；统一 extractImage 链路也通过。TSGPT 实测 CERT_HAS_EXPIRED，只请求一次 GET 后继续本地，未关闭 TLS 校验。
- 原静态链接：初次公开接口确认一页；后续页面明确返回“邀请链接失效”，当前两个提取脚本均没有取得有效页面。此远程用例未通过，不能以本地夹具替代声称该失效分享已修复。
- 修改 JavaScript 的语法检查和前端生产构建通过。构建仍提示既有 Vite CJS 弃用与较大 bundle；未扩展到无关打包重构。

后端启动：

```powershell
cd E:\watermark\watermark\server
npm start
```

后端回归与联网 GIF：

```powershell
node --test test-818ps-regression.js
node --check index.js
node --check imageExtractor.js
node --check extractors/818ps.js
node test-818ps-optimized.js "https://818ps.com/g/002dR05L-314829761-24655456-4?user_source=r2066615&jump_type="
node test-extractors.js 818ps "https://818ps.com/g/002dR05L-314829761-24655456-4?user_source=r2066615&jump_type="
```

前端构建：

```powershell
cd E:\watermark\watermark\client
npm run build
```

本地 UI 回归（需要 Python Playwright 与已安装 Chromium；可设置 PUPPETEER_EXECUTABLE_PATH）：

```powershell
cd E:\watermark\watermark
$env:VITE_API_TARGET='http://127.0.0.1:5180'
python C:/Users/阿达/.codex/skills/webapp-testing/scripts/with_server.py --server "npm --prefix client run dev -- --host 127.0.0.1 --port 5179" --port 5179 -- python server/test-818ps-ui.py
```

观察 `animation_validation/resource_selected/final`：必须同时有真实 detectedFormat、isAnimated=true、frameCount>1；不能只看 success 或 complete。检查 coverage 的可信预期、页映射和 missing；未知页数需显示 unknown。所有签名日志脱敏。

## G. 限制

当前仅确认动态预览，不确认无水印原始整页 GIF。公开 API 结构已在本次访问变化，签名 URL 会过期。登录、付费权限、已撤销分享、动画生成尚未完成等状态均可能无法获得动态资源；不会拼接签名、改写凭证、合成素材或突破访问控制。没有公开整页主资源时不会拿 gifInfo 元素代替设计稿。

动态 DOM 适配使用原有第N页标记，以及分页/缩略图导航上下文中的明确页属性；未知网站新控件结构仍可能需要后续适配。跨请求不复用临时签名；有上限的资源大小、页数、时间与浏览器交互意味着超大型设计可能返回 partial/unknown。MySQL 本次只验证真实 HTTP SQL 参数与 JSON 往返的隔离适配器，没有对用户数据库作实际写入验收。
# 本轮后续说明

原始动画与授权下载的最新结论见 [818PS_RESOURCE_FIX_REPORT.md](818PS_RESOURCE_FIX_REPORT.md)。字段名本身不再确认原始资源；本样本 GIF 文件帧内已有水印，公开官方无水印下载入口要求登录。
