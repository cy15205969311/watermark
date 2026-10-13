# 图怪兽原始动画与授权下载修复记录

验证日期：2026-10-13。工作目录：`E:\watermark\watermark`。此记录补充前两轮的 `818PS_FIX_REPORT.md`，以本轮结论修正“原始动画字段即能证明原始文件”的旧判断。

## 1. 水印所在层

使用公开分享接口给出的完整签名地址执行正常 GET，保存响应 GIF，并通过 Sharp 多帧解码提取索引 0、12、23 的帧作诊断。三帧中央均可见“图怪兽”标记。因此，本样本的水印已经存在于下载文件像素中；页面显示层不是这份文件水印的必要来源。

诊断图片：`server/test-artifacts/live-frame-0.png`、`live-frame-12.png`、`live-frame-23.png`。响应文件：`server/test-artifacts/live-preview.gif`。这些本地诊断文件被 gitignore 排除；最终提取及下载仍使用动画文件，诊断帧不进入结果数组。

响应 SHA-256：`a81d5830ad9d7bcfa5c42b0fdc2c5ee13872abaf97f6d5361d8917bd94305d0e`。人工检查只适用于该次响应，不是通用水印检测器。接口 `hasVisibleWatermark` 保持 `unknown`，没有按路径或样本硬编码判断。

## 2. 当前资源及公开业务数据

复现链接：`https://818ps.com/g/002dR05L-314829761-24655456-4?user_source=r2066615&jump_type=`。

本次四个公共接口与公开编辑页均正常访问，未提交登录、下载收费、授权或导出请求。

| 位置 | 真实用途与响应 |
| --- | --- |
| share-template 的 data.preview[0] | 整页动态预览；gif_complete_img 的 !l1600 实际是 GIF，572×900，24 帧，1920ms，循环 0，489224 字节 |
| team-share-get-templ 的 preview[0] | 同一设计的 !l1000_b 静态预览，之前及本轮提取验证均识别为静态图 |
| get-template-page-data 的 url.preview[0].big_img | !w380_webp 动态 WebP 预览，按实际字节验证格式 |
| url.preview[0].small_img | !w128_h128 静态缩略图，独立保留，不覆盖 animationUrl |
| doc.work / url.work | 一页中七个文字/SVG 元素组成的画布数据，不是整页下载文件列表 |
| doc.pageAttr.pageInfo | 一页的画布属性；page_map 为空数组，pageInfo 长度为 1 |
| gifInfo[0].imagePath | ips_gif_asset 动画元素，不含全部文字/SVG，继续排除为整页结果 |
| get-template-info | code=1、msg=success、data=false，没有原始下载引用 |

本轮四个接口、静态页面业务数据与被动浏览器 JSON 检查没有发现可验证为原始完整动画或正式授权导出的资源引用。公开页面实际显示“无水印下载”“登录即可下载无水印大图”，同时有登录流程；部分用户资源接口明确返回“未登录”。这确认官方无水印下载入口需要登录。没有登录后的权限数据，不能判断登录后是否还需会员，也不能证明原文件永远不公开。

`gif_complete_img` 只描述路径，不能证明无水印。此次选中的是 `animation_preview`，不是原始文件。新下载框提供官方分享页链接，让用户按平台正常授权流程继续。

## 3. 故障与修复流程

原代码将 `originalAnimationUrl` 字段直接映射为 `original_animation`，只再检查动画格式，缺少整页归属与授权证据。完整页数加有效动画也会直接结束，在发现后续业务资源前选定预览。原前端主要区分静态与动态，对正式导出缺少独立状态。

修复后的实际 HTTP 调用链仍是 `/api/extract-image → imageExtractor.extractImage → 第三方网关 → extract818psImage → extract818ps → normalizeExtractPayload`。第三方证书故障继续回退本地；没有关闭 TLS。控制器兼容入口和其他平台分支保留。

本地执行分享 API 收集、必要的已知路径验证、静态内嵌 JSON、动态公开数据、必要的逐页激活。已有整页动态预览时跳过不能证明原始角色的预测路径，继续静态数据及一次被动浏览器补查。补查浏览器阶段上限 12 秒，导航上限 10 秒，复用池并在 finally 释放页面和实例，不点击导出或登录控件。需要补页时保留原有完整分页流程。

候选经过完整文件/帧验证后再确认资源角色；同页排序为：有业务和许可证据的原始动画、正式授权导出、可验证动态预览、属性未确认动态资源、静态预览。同页缩略图、不同分辨率和元素集合不增加设计页数。已失效原始候选不能覆盖有效预览。

原始或授权导出证据必须包含平台来源、设计整页范围、可靠页面映射、明确允许下载以及可访问且已解码的动画响应。只有字段名、扩展名、像素大小或帧数均不够。当前增加了有界的显式 downloadResources/exportResources/originalResources 元数据适配，要求 scope、resourceRole、authorization(provider/access/canDownload) 及页面标识；用于兼容明确的业务资源清单，并以本地夹具验证。**本样本没有返回这些字段，不能据此声称已验证图怪兽真实原始导出接口。** 未来公开业务结构不同，应基于实际字段新增适配；缺证据时继续返回 unknown/preview_only。

## 4. 本轮修改文件

| 文件 | 作用 |
| --- | --- |
| server/extractors/818ps-pages.js | 来源与授权证明、资源角色判定、原始/导出优先级、逐页与汇总下载状态、unknown 水印标记 |
| server/extractors/818ps.js | 验证后分类、有时限的被动公开数据补查、真实登录入口诊断、最终选择理由；重新生成最终状态告警 |
| server/utils/extractPayload.js | 新字段加入响应/parse/history 共用白名单；沿用现有 metadata JSON，无需再改 schema |
| client/src/store/index.js | Vuex、保存请求与旧历史兼容地传递新字段 |
| client/src/utils/resourceStatus.js | 统一预览/原始/正式导出文案，安全校验官方分享页链接 |
| client/src/App.vue | 结果提示与预览框显示资源状态，减少含签名资源的控制台输出 |
| client/src/components/HistoryItem.vue | 预览状态标签、已验证原始/导出独立文案；旧记录不会仅凭角色名宣称原始文件 |
| client/src/components/DownloadDialog.vue | 下载前说明预览属性，提供官方正常登录下载入口，保留实际动画 URL |
| server/test-818ps-regression.js | 扩展资源角色、授权、误导字段、动态补查及 HTTP 历史回归 |
| server/test-818ps-ui.py | 扩展原始/导出/预览状态、官方入口与保存字段浏览器验证 |
| server/test-818ps-optimized.js / test-extractors.js | 测试输出新增状态及签名脱敏 |
| 818PS_EXTRACTION_LOGIC.md / 818PS_FIX_REPORT.md / 本文 | 更新接口语义、真实证据与限制 |

本轮没有修改生产 MySQL 数据或删除数据表。既有 extraction_metadata_json 保存新增字段，所有 imageUrls/pages 继续保存和恢复。代理继续以字节流传输 GIF，不经 Sharp 或 Canvas 转换。

## 5. 响应语义

兼容原有 success、imageUrl、animationUrl、thumbnailUrl、imageUrls、pages、pageCount 等。新增 originalResourceStatus、downloadStatus、hasVisibleWatermark、selectionReason；单页记录也有独立的资源及下载状态。

| 状态 | 含义 |
| --- | --- |
| original_verified | 所有返回页面均为已验证的原始动画资源 |
| authorized_export_verified | 所有返回页面均为原始或正式授权导出资源，并包含正式导出 |
| preview_only | 返回集合含预览资源，不能整体宣称已取得原始文件 |
| unknown | 返回资源的原始/预览属性缺少足够证据 |
| unavailable | 没有可用资源 |

`animationStatus=verified_animated` 只证明实际动画；`completenessStatus=complete` 只证明设计页覆盖；`original_verified` 也不等于经过水印检测。混合资源集合汇总为 preview_only 或 unknown，pages 仍保留各页具体状态。

真实 GIF 本轮响应：success=true、pageCount=1、expectedPageCount=1、completenessStatus=complete、mediaType=image/gif、frameCount=24、durationMs=1920、resourceRole=animation_preview、animationStatus=verified_animated、originalResourceStatus=preview_only、downloadStatus=preview_only、hasVisibleWatermark=unknown。

metadata.originalResourceDiscovery 记录 checkedSources、referencedCandidates、verifiedCandidates、officialDownloadRequiresLogin 和 reason；本样本原始/导出引用计数均为 0，reason=official_download_requires_login。它描述本次已检查范围，不是“平台不存在原始资源”的断言。

## 6. 实际测试

本地 Node 测试使用内置 node:test、Sharp 生成媒体、HTTP/JSON/HTML 夹具、真实 Chromium 切页，以及隔离的 MySQL 适配器。测试不访问生产数据库。授权原始/导出场景均为本地明确标记的夹具，不能替代真实平台授权验证。

覆盖带水印预览角色（自动水印状态仍 unknown）、静态封面与动画并存、显式授权原始/导出择优及下载字节、original 字段误导、元素范围、权限拒绝、静态和失效所谓原始资源、运行时才出现的原始清单、不同页面混合角色、单页/五页/动态补页/缺页、材料排除、签名、TLS 故障、HTTP 保存历史与代理、其他平台归一化。

最终计数及真实联网结果见末尾验收记录。其他平台覆盖统一归一化和旧历史，未逐一对所有平台做真实联网提取。

验收记录：Node 回归 **28/28 通过，失败 0、跳过 0**；Python Playwright **11 项场景检查通过，失败 0**，包括实际浏览器动画、下载字节一致、重新解析下载 GIF、状态展示及保存字段。带水印测试夹具在两个实际帧内绘制 PREVIEW 字样；自动接口依然返回 unknown 水印状态。服务端所有修改 JS 语法检查通过；Vuex/ES 模块采用正确的 module 模式检查，Vue 项目 npm run build 通过。Vite 保留既有 CJS 弃用和大包体积提示。

真实联网：优化提取脚本、test-extractors 818ps 分支、统一 imageExtractor 三条入口均成功返回 24 帧预览及 preview_only 状态。前两条耗时分别约 10.6 秒、7.9 秒。统一入口遇到 TSGPT CERT_HAS_EXPIRED 后正常回退本地。三条均未发现可验证原始/正式导出引用。初次完整浏览器检查及两次提取看到官方登录提示；另一次有界检查只收到少量 JSON，尚未出现该提示，因此该次 reason 如实为 no_verified_original_in_checked_sources，不能将未观察到提示当作不需登录。

原静态复现链接实际失败 1 次，原因为页面明确返回 share_link_expired；这不是离线回归失败。没有真实授权原始下载地址，该场景只完成夹具测试，不虚报真实原始文件验证通过。所有测试浏览器已释放，测试 Vite 子进程已清理，临时联网检查脚本已删除。

## 7. 运行与复现

```powershell
cd E:\watermark\watermark\server
npm start
```

离线回归和真实公开链接：

```powershell
cd E:\watermark\watermark\server
node --test test-818ps-regression.js
node test-818ps-optimized.js "https://818ps.com/g/002dR05L-314829761-24655456-4?user_source=r2066615&jump_type="
node test-extractors.js 818ps "https://818ps.com/g/002dR05L-314829761-24655456-4?user_source=r2066615&jump_type="
```

前端：

```powershell
cd E:\watermark\watermark
npm --prefix client run build
$env:VITE_API_TARGET='http://127.0.0.1:5180'
python C:/Users/阿达/.codex/skills/webapp-testing/scripts/with_server.py --server "npm --prefix client run dev -- --host 127.0.0.1 --port 5179" --port 5179 -- python server/test-818ps-ui.py
```

观察 share_api_structure、original_resource_discovery、animation_validation、coverage、resource_selected、final 日志。原始成功必须看到有效业务许可证明与 original_verified/authorized_export_verified；仅有 verified_animated 不能作此判断。日志隐藏 auth_key 等临时凭证。

## 遗留限制

本轮真实公开数据只提供带水印预览；官方无水印下载入口需要登录。没有真实授权原始资源地址，无法宣称原文件下载问题已解决，也无法确认登录后会员限制。不会擦除版权水印、猜测原图 URL、删除授权参数或重建元素绕过导出权限。

旧静态分享链接本轮明确显示“邀请链接失效”，返回失败及 share_link_expired。签名过期、平台风控、结构变化、网络超时或生成延迟可能继续导致 partial/unknown/unavailable；已有有效预览在补查失败时保留。水印识别目前只有本样本人工帧检查，接口没有通用自动检测能力。
