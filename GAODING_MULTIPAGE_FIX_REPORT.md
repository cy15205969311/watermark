# 稿定 DAM 多页提取修复验收

验证日期：2026-10-14。目标分享码 `bbgdyxG0Jdm8ir5koNVTv`，资产 ID `38261829831620694`。

后续更正：本文记录上一轮行为，表中“空扩展数组证明原单图链接完整”的判断证据不足，已在二次修复中撤销。该链接仍返回有效一张预览，但总画板数保持 unknown；已确认三张扩展列表的案例仍返回三页。最新验收见 [GAODING_ARTBOARD_FIX_REPORT.md](GAODING_ARTBOARD_FIX_REPORT.md)。

## A. 根因与真实证据

真实链接修复前返回 **1 页 / unknown**，修复后 `/api/extract-image` 返回 **3 页 / complete**。总页数来自公开 DAM 资产页集合和官方客户端的展示语义，没有硬编码分享码或页数。

公开分享资源接口和目标资产接口都返回 HTTP 200。分享数据中的 `file_ids` 将分享码关联到上述资产，权限为 `ALL_READ`。资产响应包含主预览及两个扩展预览，`source_preview_info.url` 为 null，`design_info` 是空对象。

官方发布模块 `https://cdn.dancf.com/apps/gaoding/assets/index-ba86fef7-BQ4Hq91H.js` 的 `multi-preview` 组件使用 `[preview_info.url, ...extends_previews.map(p => p.url)]` 构建有序列表，按钮带 `data-preview-index`，活动按钮使用 `gd-dam-space__multi-preview__preview-item-active`。三张资源均实际请求成功、解码成功，并经视觉检查确认是三张内容不同的完整设计图。

修复前代码把没有显式 pageId/pageNumber 的扩展项全部归到 `primary`，三个有效候选只选出面积最大的一张，实际上返回了第三张。问题发生在页面语义解析和候选合并，并非接口只返回了封面。

对任务中的十个根因问题：

1. 只输出一页：三个完整资源被归为同一页面，按面积择优，丢失前两页。
2. 有 designIds、没有 designRefs：前者来自分享文件清单，后者只能来自实际提供的 JSON 引用；设计 ID 不代表 JSON 地址。
3. hasDesignJson=false：本链接 `design_info={}`，地址确实不存在，未发生 JSON 请求或解析失败。新日志明确为 `reference_absent`。
4. extends_previews：实际有两个额外页面；旧代码当作主预览的版本。只有已验证的 DAM 资产接口上下文加 gdimage 格式采用官方列表语义，普通扩展预览仍不据此增加页数。
5. 分享接口是否仅封面：分享资源接口给目标文件清单，随后资产接口已提供完整三张预览，无需猜测其他编辑器接口。
6. 原动态监听：监听初始化 document/fetch/xhr，但切页选择器没有覆盖官方 data-preview-index，也没有每次确认活动页及保存主图；无法证明原运行采集了切页响应。
7. 真实分页控件：发布客户端中已确认。此次独立真实浏览器诊断虽然挂载了 viewer，主预览和分页列表未渲染，不能宣称真实链接逐页交互成功。动态切页修复由真实 Chromium 本地夹具验证。
8. dynamic-visible：原实现只在所有点击结束后扫描一次，最多保留当前活动页；现在逐页快照与末尾兜底分开，分页失败时不会用末尾旧图补成完整。
9. unknown 返回：原代码已继续动态路径，但因以上解析缺陷和动态补全不足仍返回 unknown。允许预算结束后返回有效预览；unknown 不代表已确认单页。
10. 归一化与历史：本链接原丢页发生在提取器，不是 MySQL 截断。另修复了公共归一化和前端按 URL 去重时会合并“不同页面共用同一 URL”的风险，限制为有页面身份的稿定数据。

### 修复前后关键指标

| 指标 | 修复前实际值 | 修复后实际值 |
| --- | --- | --- |
| source | share-api-preview | share-api-preview |
| rawCandidates / validCandidates | 3 / 3 | 3 / 3 |
| pageCount | 1 | 3 |
| expectedPageCount | null | 3 |
| completenessStatus | unknown | complete |
| identifiedPages | 未确认页码 | [1, 2, 3] |
| missingPages | []（总数未知） | []（已验证齐全） |
| hasDesignJson | false | false，reference_absent |
| dynamic-visible | 尝试过，未补全 | 本链接已完整，无需启动 |

### 最终资源与页面对应关系

下列路径均在 `https://gdesign-dam-hw.dancf.com/38261829831620694` 下。实际提取、验证、API 返回和保存均保留原始 `auth_key`。文档和诊断展示将签名值脱敏，以下 URL 不是可直接使用的签名地址。原生 pageId 未公开，因此 pageId 如实为 null；pageNumber 来自官方列表顺序。

| 页序 | 原始字段证据 | 实际尺寸 | 资源路径 |
| --- | --- | --- | --- |
| 1 | preview_info | 1242×1656 | /preview/render/uuid-7b23b373-f89e-4179-bb6b-5c91dcc95ed9-hash-1277775991/e4640768-05f2-4eb1-81a2-c3da6964a7bf.jpeg?auth_key=[redacted] |
| 2 | extends_previews[0] | 1242×1656 | /preview/render/uuid-a3aca6d5-ab8a-4205-a658-04075a062397-hash-1274456600/c465f885-1b77-4ae1-97aa-0eeb735cae07.jpeg?auth_key=[redacted] |
| 3 | extends_previews[1] | 1242×2208 | /preview/render/uuid-cd4d4b21-df3f-4d1b-a91c-35f2dfba0b58-hash-1211533336/72547631-5ce6-42ef-ae87-e22776ab732c.jpeg?auth_key=[redacted] |

本地原始证据（test-artifacts 为忽略目录，不提交签名）：`server/test-artifacts/gaoding-multi-share.json`、`gaoding-multi-asset.json`、`gaoding-multipage-before.txt`、`gaoding-multipage-after.txt`、`gaoding-multipage-after.json`、`gaoding-multi-contact.png`。JSON 产物保留实际可用 URL，文本日志已脱敏。

## B. 修改文件

| 文件 | 修改原因 |
| --- | --- |
| server/extractors/gaoding.js | 解析已验证 DAM 页面集合、按页面顺序归并；JSON 请求及解析诊断、一次瞬态失败重试；真实导航发现、内部滚动、活动页和主图确认、逐页累积；限制响应数、并发、等待和交互次数；保留 dynamic-visible 兜底和 unknown/partial 状态 |
| server/utils/extractPayload.js | 稿定按 designId 与页面身份保留不同页面；pages 排序决定 URL 数组、主图及实际页数，防止 URL 相同的不同页面被截断 |
| client/src/App.vue | 保存与预览列表保留已识别页面身份，不按 URL 合并不同页面 |
| client/src/store/index.js | 稿定历史记录的 URL 数组依据有序 pages 恢复 |
| server/test-gaoding-regression.js | 增加五页 JSON、DAM 扩展语义、坏 JSON、瞬态重试、动态延迟/旧图/失败、同 URL 页面、五页 HTTP 历史和创客贴回归 |
| server/test-gaoding-ui.py | 验证未知预览、五页保存与查看切换、失败不保存占位图 |
| README.md、本文档 | 更新提取流程及验收证据；说明结构化资源保留实际签名参数 |

未改其他平台提取器，也未改数据库结构。历史 HTTP 测试使用隔离内存适配器，真实联网验证禁止数据库写入。

## C. 修复后的执行顺序

1. 规范化分享文案，识别 shareId，读取目标 HTML 的结构化数据。
2. 已知公开分享接口确认访问权限及 file_ids，再请求并校验目标资产 ID。已确认 DAM gdimage 列表按主预览、扩展预览顺序生成页面清单，普通扩展图片保持身份要求。
3. 对实际出现的 design_info.url 请求 JSON，记录请求、HTTP 类型/状态、解析、页面集合与目标关联。瞬态网络/5xx/429 最多尝试两次，不重试权限拒绝或非 JSON 解析错误。不凭设计 ID 拼接编辑器接口。
4. 合并 pages/layouts 和预览候选，验证图片字节、实际尺寸和比例，页面身份去重并排序。不同页允许共用资源 URL。
5. 只有尚未 complete 时使用现有浏览器池。document/fetch/xhr 响应最多 80 个、最多 4 个并发处理、单响应 4 MiB，按 URL 和内容指纹去重；等待响应的单次上限 1.5 秒，遵守总预算。
6. 查看目标 viewer 的官方索引导航或显式分页属性，有限滚动内部导航区域。仅明确总数或官方完整列表提供总页数证据，普通可见按钮数量不能直接证明总数。
7. 最多处理 32 个导航项，每页最多两次尝试；活动状态和已加载主预览必须对应目标页。等待资源更新，切换未确认则记录缺页，不保存旧图。逐页数据并入同一状态。
8. 有分页控件的 viewer 不再用一次末尾扫描给失败页分配图片。无可用分页控件时仍允许有目标关联证据的 dynamic-visible，完整性证据不足时保持 unknown。
9. 最终独立判断可用资源、可靠总数及页面覆盖；返回实际 pages/imageUrls 和 complete/partial/unknown，经统一 API 及现有多页历史字段保存。

## D. 实际测试结果

| 场景 | 实际输出 / 预期页数 | 缺页 | 状态 |
| --- | --- | --- | --- |
| 新真实分享 bbgdyxG0Jdm8ir5koNVTv，完整 HTTP 链路 | 3 / 3 | 无 | complete，share-api-preview |
| 原真实分享 ZKZqaGEo5aMBudoBxbzCJ | 1 / 1 | 无 | complete；DAM 显式空扩展数组 |
| 可靠单页 pages/layouts 夹具 | 1 / 1 | 无 | complete |
| 封面 → 五页 JSON，乱序页面及 layouts 同页版本 | 5 / 5 | 无 | complete，design-json-pages |
| 已验证 DAM 主图及两个扩展页面，不同比例 | 3 / 3 | 无 | complete |
| 动态网络 JSON，排除其他分享推荐数据 | 2 / 2 | 无 | complete |
| 实际 Chromium、官方导航属性、750ms 延迟切页 | 3 / 3 | 无 | complete；三个逐页快照 |
| 活动标记更新但图片没切换 | 1 / 2 | [2] | partial；旧图片不计新页 |
| 第二页资源请求失败，有限切页重试 | 1 / 2 | [2] | partial |
| DAM 第二页资源失败 | 2 / 3 | [2] | partial |
| 页数未知、结构化目标预览 | 1 / null | 无法确定 | unknown |
| 仅目标关联的 dynamic-visible | 1 / null | 无法确定 | unknown；兜底仍存在 |
| reliable single + dynamic-visible 匹配主预览尺寸 | 1 / 1 | 无 | complete |
| JSON 地址实际返回 HTML | 1 / null | 无法确定 | unknown，parse_failed |
| JSON 首次 503、第二次成功 | 2 / 2 | 无 | complete；两次请求 |
| 5 页 HTTP extract → parse → history | 5 / 5 | 无 | 页面、顺序、来源、完整性和独立缩略图均保留 |
| Vue 前端 5 个页面 ID 共用同一 URL | 5 / 5 | 无 | 保存完整五页，查看结果仍有翻页控件；无运行错误 |
| 创客贴实际提取函数 + 本地网络夹具 | 2 / 2 | 无 | static-scan；不是创客贴线上访问验收 |

检查命令及结果：

- `node --test test-gaoding-regression.js`：30/30 通过，包括实际 Chromium、公开接口模拟及隔离 HTTP/历史测试。
- `node test-gaoding.js`：9/9 原有辅助解析检查通过；该脚本是夹具测试，不把链接参数误称为联网验收。
- `node --test test-818ps-regression.js`：28/28 通过，包含 GIF 动画、静态页面、多页及 HTTP/历史兼容。
- `python server/test-gaoding-ui.py`：通过，使用 webapp-testing 的 with_server.py 启动 Vite，API 拦截避免数据库写入。
- `node --check index.js`、`imageExtractor.js`、`extractors/gaoding.js`、`utils/extractPayload.js`：通过。
- `npm run build`：通过，存在既有 Vite CJS/大包提示。
- 真实分享以 `node verify-gaoding-live.js '<分享链接>'` 验证 `/api/extract-image`，未向生产数据库保存记录。

## E. 限制

- 此链接没有公开编辑器 JSON 地址，验收对象是官方展示的完整整页预览集合，不宣称取得可编辑设计稿 JSON 或原始导出文件。
- 真浏览器诊断未渲染目标导航，真实链接的逐页点击未做成功声明；三页由公开资产接口、官方组件代码和实际图片共同证明。动态交互通过本地 Chromium 验证。
- DOM 交互目前支持已确认官方导航及明确页面属性；其他布局、canvas/blob、虚拟列表未暴露完整列表或主图时会保留 partial/unknown，最多尝试预算内可识别的页面。
- 图片只有局部元素、缩略图或缺少主预览时，不会用它们补齐页面。无法确定缺页序号时不虚构 missingPages。
- 分享关闭、密码权限、签名过期、服务器拒绝或资源请求失败仍会限制获取，保留相应状态；日志不输出有效签名。
