# 稿定 DAM 多画板二次修复与验收

日期：2026-10-14。工作目录：`E:\watermark\watermark`。新分享码 `Ad6DQaV04VGwFPoey6DTw`，资产 ID `38262108362106959`。

## A. 根因与边界

上一轮 `collectDesignData()` 的 DAM 分支使用 `[preview_info, ...extends_previews]` 的长度生成 verified 页数证据。条件只有 gdimage、已关联 DAM 资产、扩展字段是数组及主预览存在，**空数组也进入该分支**。于是一个主预览生成 `count:1`，`finalizeState()` 在图片验证成功后判定 complete，`extractGaoding()` 因 complete 跳过动态路径。这是本次确认的代码缺陷。

已修改为：只有有额外预览条目的已确认 DAM 列表才使用上一轮多图语义。空扩展数组不生成页数证据、不虚构原生页码，总数维持 null，状态 unknown，并继续正常动态补全。明确的 pages/layouts 集合、pageCount 或完整官方导航仍可以证明单页。

另确认两个实际兼容问题：

- 匹配分享码的网络页面模型可能不重复资产 ID。先前新页会进入没有 designId 的分组，与原资产预览分离。现在只在目标资产唯一、数据已建立信任时，继承该资产 ID；有多个目标文件时不猜归属。
- `/api/parse` 调用归一化时漏传 platform，上一轮为稿定添加的按页面身份保留重复 URL 逻辑不能生效。现在传入 resolvedPlatform；三张不同画板共用 URL 的完整 HTTP 保存/历史测试通过。
- 前端下载通过 URL 查找页面时总会命中第一张同 URL 页面，造成下载文件名重复。现在先按页面位置取对应记录，确保各自页码。

用户日志中“扩展数组为空”的历史接口状态无法从今天的响应倒推具体成因。可能的渲染发布时间、更新或缓存原因仍未证实，不能宣称已经定位稿定服务端的原因。

## B. 当前链接的真实页面来源

**重要区别：首次联网复查时，接口已经返回两个扩展预览；修改代码前现有提取器就返回了 3 页。** 因此不能把本次说成“同一实时响应经本次修改从一页变三页”。用户历史日志的 1 页和今日实际 3 页是不同数据状态。

公开请求均 HTTP 200：

1. `GET https://www.gaoding.com/api/dam/shares/Ad6DQaV04VGwFPoey6DTw/resource`：`file_ids=[38262108362106959]`，content_id 同值，share_scope 为 ALL_READ，没有第二个文件 ID。
2. `GET https://www.gaoding.com/api/dam/asset/38262108362106959`：format=gdimage、editor_type=poster，标题为“家居装修定制服务介绍旧房改造焕新宣传小红书封面(1)”，`design_info={}`，source_preview_info.url=null，主预览及两个扩展预览都有实际 URL。
3. 三张 URL 都返回 HTTP 200、image/jpeg，解码尺寸都是 1242×1656。视觉检查分别是“品质装修定制”“全屋定制服务”“焕新全屋入住理想家”，内容不同，都是完整设计页面。

页面顺序沿用已确认的官方 DAM `multi-preview` 组件：主预览、extends_previews[0]、extends_previews[1]。同一资产 ID 关联三张预览，原生 pageId 未公开，如实保持 null，pageNumber 表示官方预览列表顺序。

`source_info.source_id=199272899` 是来源作品 ID，不把它冒充第二个 DAM 资产或页面 ID，也不据此拼接编辑器接口。本次没有公开 JSON 引用，designJsonStatus 仍为 reference_absent。真实 HTML 只提供目标资产 ID 和不完整预览元数据，没有额外页面清单。

任务描述中的编辑器截图未随本次消息以实际图像附件提供，不能独立验证截图的作品 ID。可以确认本分享的资产 ID、标题、三张不同资源及尺寸；不把截图描述当作接口总数证据。

### 资源对应表

以下路径均在 `https://gdesign-dam-hw.dancf.com/38262108362106959` 下。返回、验证和保存保留原始签名；文档只展示脱敏签名，不提供失效的可点击下载链接。

| 顺序 | 原始字段 | 实际尺寸 | 资源路径 |
| --- | --- | --- | --- |
| 1 | preview_info | 1242×1656 | /preview/render/uuid-833b81cb-9d57-4cc5-851c-de5121214321-hash-1197043564/bfb1be02-4f01-4b4e-ab9d-975dea73c699.jpeg?auth_key=[redacted] |
| 2 | extends_previews[0] | 1242×1656 | /preview/render/uuid-68acf866-c2ca-462e-98d0-b3c22423359d-hash-2792831990/6b11d668-befc-4a8e-b379-228f4ec345c5.jpeg?auth_key=[redacted] |
| 3 | extends_previews[1] | 1242×1656 | /preview/render/uuid-ed27b5eb-edd3-4881-8daf-e20623d34dab-hash-987196428/082adad5-1baf-447f-8db9-a30342f8091e.jpeg?auth_key=[redacted] |

原始产物在忽略目录 `server/test-artifacts/`：gaoding-artboards-share.json、gaoding-artboards-asset.json、gaoding-artboards-before.json、gaoding-artboards-after-api.json、gaoding-artboards-after-history.json。完整 URL 和签名只保留在本地原始 JSON；对应 txt 诊断脱敏。视觉对照图为 gaoding-artboards-contact.png。

稳定回归夹具 `server/fixtures/gaoding-dam-artboards.json` 只保留本次公开响应的相关结构、资源路径和目标关联，删除签名及账户标识；测试使用本地真实图片替换网络 URL，不把模拟图片称作线上资源。

## C. 本次增量修改

| 文件 | 作用 |
| --- | --- |
| server/extractors/gaoding.js | 撤销空扩展数组的 verified 单页推断；唯一目标下关联网络页模型；未确认清单时继续动态，预算内一次公开分享权限复查和待补全资产复查；新增清单来源、页 ID、逐页验证及激活诊断 |
| server/index.js | parse 归一化传入平台，避免不同画板共用 URL 时被截断 |
| client/src/App.vue | 下载优先按页面位置选择对应元数据，保留各自页码及文件名 |
| server/test-gaoding-regression.js | 新增空扩展、当前响应夹具、单目标网络页模型、动态三画板、有限复查、浏览器失败后的复查、权限撤销及相同 URL 画板的 HTTP 历史检查 |
| server/test-gaoding-ui.py | 验证三页和五页保存/查看/下载文件名；可加载本次实际 API 产物检查三张 URL 的前端顺序与下载入口 |
| server/verify-gaoding-live.js | 添加 --history 隔离内存适配器验证 parse/history，及 --artifact-prefix 避免多个真实案例产物覆盖 |
| server/fixtures/gaoding-dam-artboards.json | 本链接真实结构的无签名回归夹具 |
| README.md、GAODING_MULTIPAGE_FIX_REPORT.md、本文 | 更新空扩展语义、纠正上一轮单页结论、记录本次验收及限制 |

其他平台提取器未修改；无数据库字段迁移或生产数据库写入。前一轮公共归一化、Vuex 多页处理继续保留。

### 补全流程

正常分享关联和资产读取 → 解析公开页面集合/实际 JSON 引用 → 验证图片 → 若不完整则使用浏览器池收集相关网络数据和逐页主预览 → 若仍不完整且资产没有可靠页面清单，预算内复查一次已确认的公开分享/资产接口 → 再解析新出现的 JSON 引用 → 合并、按序返回实际页面。

复查先确认分享仍开放、未过期且无密码，并以最新 file_ids 确认文件仍属于该分享后才请求待补全资产；只使用已有公开端点，不猜编辑器 URL，不调用登录环境接口。复查携带 Cache-Control:no-cache，不删资源签名、不增加未验证接口，不无限重试。即使复查仍只有一个预览也保持 unknown。静态限定选项 staticOnly 仍限制为静态路径。

## D. 修复前后与最终结果

| 情况 | 实际页数 | 预期页数 | 完整性 | 来源 |
| --- | --- | --- | --- | --- |
| 用户提供的历史日志 | 1 | 1（错误推断） | complete（错误推断） | share-api-preview |
| 今日代码修改前首次真实运行 | 3 | 3 | complete | share-api-preview；接口已含两个扩展 |
| 本次代码修改后真实运行 | 3 | 3 | complete | share-api-preview |
| 历史空扩展结构夹具，修复后 | 1 | null | unknown | 目标结构化预览 |
| 空扩展初始响应，后续公开资产出现两张扩展的夹具 | 3 | 3 | complete | share-api-preview；有限复查 |

当前 `/api/extract-image`：collectedPageCount=3、pageCountConfidence=verified、identifiedPages=[1,2,3]、missingPages=[]、isComplete=true。三页都有相同 designId 和各自原始字段证据；pageId=null，不伪造编辑器画板 ID。

本次真实提取结果实际经过 `/api/parse` 和 `/api/history`：页面数组、URL 数组、顺序、页数及完整性逐项一致。数据库适配器为内存隔离，不代表生产 MySQL 写入验收；SQL 参数和 HTTP 保存恢复逻辑均执行。

## E. 测试结果

| 场景 | 输出/总数 | 结果 |
| --- | --- | --- |
| 新链接 Ad6DQaV04VGwFPoey6DTw + extract/parse/history | 3/3 | complete；三张线上资源均验证成功 |
| 上一轮 bbgdyxG0Jdm8ir5koNVTv + extract/parse/history | 3/3 | complete，无退化 |
| 原单预览链接 ZKZqaGEo5aMBudoBxbzCJ + extract/parse/history | 1/未知 | unknown，仍保留有效主预览并继续动态/有限复查 |
| 可靠单页 pages/layouts 模型 | 1/1 | complete，真实单页能力保留 |
| 一个 DAM 资产，空扩展，无 JSON，网络页面模型 | 3/3 | complete；三个页面关联同一资产 |
| 一个 DAM 资产，空扩展，逐页切换主预览 | 3/3 | complete；活动状态/资源更新验证通过 |
| 活动标记变化，主图不变 | 1/2 | partial；缺 [2]，不重复旧图 |
| 待补全资产有限复查后仍只有一张 | 1/未知 | unknown；没有伪造总数 |
| 复查发现分享关闭 | 0 | 不再获取资产，清除已收集资源 |
| 三张页面共用 URL，HTTP parse/history | 3/3 | 页面身份、数组长度与排序保留 |
| Vue 三页/五页共用 URL | 3/3、5/5 | 保存、预览及实际 data URL 下载通过，文件名页码各不相同 |
| Vue 加载本次真实 API JSON | 3/3 | 检查三张实际 URL 的保存、逐页预览及下载入口映射；图片响应由已验证资源的本地预览产物提供，跨域下载入口被拦截记录，不宣称线上浏览器下载完毕 |
| 图怪兽 GIF、多页、HTTP/历史 | 28 项 | 全部通过 |
| 创客贴提取函数与统一平台历史 | 本地两页 | 通过；没有声称创客贴线上链接验收 |

命令与结果：

- `node --test test-gaoding-regression.js`：37/37 通过。
- `node test-gaoding.js`：9/9 通过。
- `node --test test-818ps-regression.js`：28/28 通过。
- `node --check index.js`、imageExtractor.js、extractors/gaoding.js、utils/extractPayload.js：通过。
- `npm run build`：通过，保留既有 Vite CJS/大包提示。
- webapp-testing with_server.py 启动 Vite，执行 test-gaoding-ui.py：三/五页保存、预览、下载及失败路径通过；附 --live-fixture 的真实 API 产物检查亦执行。
- 真实验证：`node verify-gaoding-live.js '<分享地址>' --history --artifact-prefix=<案例名>`，三个稿定链接均执行。

## F. 兼容性与未验证内容

上一轮三页案例保持三页。GIF、多页、创客贴和统一历史兼容测试通过。单页完整必须有可靠页数/页面集合证据；原链接仅一张预览且无此证据时降为 unknown，是本次有意纠正的状态，不是资源提取退化。

本次没有合法公开编辑器 JSON 地址，因此未读取编辑器缩略图模型及原生画板 ID，未验证用户所述截图与资产 ID 的直接对应，也不绕过登录权限。当前三张图属于该分享的证据来自公开分享文件关联、资产响应及实际资源。若未来接口仍只公开一张、动态也没有页面清单，系统会如实返回 unknown，不能保证取得未公开的其他画板。

无法证实历史扩展为空的原因；有限复查只改善可能的发布/缓存时序，不宣称一定解决服务端数据缺失。已有浏览器预算、响应上限、并发控制、有限切页和 dynamic-visible 兜底继续保留。
