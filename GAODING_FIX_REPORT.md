# 稿定指定设计稿修复与验收记录

验证日期：2026-10-14。实际修改目录：`E:\watermark\watermark`，未修改旁边的 `watermark-lan-access`。

## 真实复现与根因

原版本联网运行复现：`source: dynamic-visible`、`pageCount: 1`。实际返回：

```text
https://cdn.dancf.com/fe-assets/20240218/Users/hongcha/Downloads/802bc7457cdfe2f8df0a68f64ac5bcd2.png
```

资源实际响应为 `image/png`，940×560，238674 字节。已下载并检查图像：箱包、帽子、鞋的装饰图片，与目标旅游海报不符。这里的错误判断来自实际图片和业务关联检查，并非仅依据 `fe-assets` 路径。

旧动态提取把网络 JSON 散图、网络文本散图、DOM 图片合并后评分，最终统一称作 `dynamic-visible`。候选只需要通过尺寸/文件体积检查，不要求来自目标设计稿。该 JPG/PNG 的出现位置不足以证明设计稿关联。

分享页新版业务信息位于 `<web-widget contextdata="...">`，旧代码主要读取 script JSON 和字符串匹配，未解析该属性。真实 SSR 给出分享码 `ZKZqaGEo5aMBudoBxbzCJ`、文件 ID `38261490322241625`、旅游设计稿标题及 1242×1656 的尺寸，但 SSR 的 `preview_info` 没有 URL。

另有代码层问题：静态多图时提前返回，跳过设计 JSON；设计 JSON 仅在至少两图时直接使用，单页 JSON 图被忽略；普通元素预览也参与选页；多图和动态来源加分可能压过来源可靠的单页。此次真实链接并没有取得 `design_info.url` 或页面数组，因此这些问题不能当作本次线上返回错误图的已证实直接原因。

API/前端链路没有发现“正确主图被缩略图覆盖”的本次根因：旧提取器本身就返回错误图片。另修复了前端失败后保存随机占位图、页面归一化丢失关联证据、预览状态覆盖完整性提醒的问题。

## 修复后的顺序与关联证据

1. URL 解析器清理确认属于分享文案的 fragment，保留查询参数及未知业务 fragment。
2. 读取 HTML script/属性 JSON，优先处理 `contextdata` 中当前分享的文件信息。
3. 对 `/dam/share/:code`，读取新版公开分享接口，再读取该接口明确列出的文件详情。
4. 收集 `source_preview_info`、`preview_info`、可信页面级缩略图等；继续请求关联的 `design_info.url`。不会因静态封面或多图就跳过此步骤。
5. 解析 `pages[]`、`layouts[]`，同 ID 的布局可补充页面预览，等长且缺少 ID 时按同位置对齐，避免重复计页。拒绝普通元素预览。`extends_previews` 无页面标识时作为同页版本，不凭数组长度虚构分页。
6. 未确认完整时通过现有浏览器池继续抓取动态 HTML、相关网络 JSON 和有限分页按钮；按来源角色、页面标识、真实图像尺寸选择，保留签名 URL。
7. `dynamic-visible` 只采集目标预览容器内、已加载、能匹配文件 ID 的图片。存在尺寸信息时校验宽高比。缺少总页数证据时保持 `unknown`；有可靠单页数量与匹配的整页尺寸时可以完整成功。

公开接口及普通渠道头来自稿定页面实际发布的 JS 模块：`/api/dam/shares/:shareCode/resource`、`/api/dam/asset/:id`，生产渠道头 `x-business-id: 13`、`x-channel-id: 32`。这是正常公开请求，未添加登录凭据、未绕过密码、未关闭 TLS 验证。密码保护、关闭或过期会明确报告并停止设计资源请求。

当前稿定链路使用本地关联提取，避免无分享/页码证据的第三方网关图片直接成为最终结果。其他平台网关顺序未改。现有网关的证书失败分类、不重试证书错误、TLS 验证均保留。

## 修复后真实 HTTP 响应

运行 `node verify-gaoding-live.js` 调用了实际 Express `/api/extract-image` 路由及真实提取器，仅在 API 启动时替换数据库适配器，禁止生产数据库写入。

```yaml
success: true
source: share-api-preview
pageCount: 1
expectedPageCount: null
collectedPageCount: 1
pageCountConfidence: unknown
completenessStatus: unknown
isComplete: null
status: preview_image
resourceRole: page_preview
shareId: ZKZqaGEo5aMBudoBxbzCJ
designId: '38261490322241625'
width: 1242
height: 1656
contentType: image/jpeg
validationStatus: valid
evidencePath: share_api.asset[38261490322241625].preview_info
```

真实证据链：分享接口 `share_config_info.share_code` 匹配输入；`file_ids` 包含 `38261490322241625`；文件详情 `id` 匹配该 ID；资源来自该详情的 `preview_info.url`。

最终资源路径（签名在报告中脱敏，API 响应保留实际参数）：

```text
https://gdesign-dam-hw.dancf.com/38261490322241625/preview/render/uuid-1d124388-fbe5-4df9-97a3-3f2122e1cff8-hash-2634235565/5bb8068e-6b59-477d-b7d1-c4fd89d12f04.jpeg?auth_key=[redacted]
```

已实际下载并检查图片，为绿地旅行海报，含“奔赴山海”“去听风的声音 去看云的形状”等文案。见 `server/test-artifacts/gaoding-after-preview.jpeg`。修复前后原始提取结果见 `gaoding-before.json`、`gaoding-after.json`，真实 HTTP 响应见 `gaoding-live-api.json`，带签名参数的文件仅作为本地诊断产物。

本次仍是 `pageCount: 1`，但它已是明确属于目标文件的整页预览。接口没有总页数，`design_info: {}`、`extends_previews: []`、`source_preview_info.url: null`；这些证据不能证明总页数恰为 1，也不能证明取得原始可编辑文件，所以不宣称完整单页或原始导出成功。

## 修改文件

| 文件 | 修改原因 |
| --- | --- |
| `server/extractors/gaoding.js` | 修复分享关联、公开数据、页面/布局解析、候选分组验证、完整性、池复用及诊断；保留可见图兜底 |
| `server/imageExtractor.js` | 稿定使用关联提取，透传测试/请求选项，明确无资源与完整性状态 |
| `server/index.js` | 日志区分取得预览、完整成功及未取得图片，接口格式与数据库逻辑保持兼容 |
| `client/src/App.vue` | 无目标图时不保存占位图，保留页面证据与完整性提醒；保留原有未提交加载状态改动 |
| `server/test-gaoding.js` | 旧多页测试明确加入已确认完整的条件，不再把单纯多图视为完整 |
| `server/test-gaoding-regression.js` | HTML/JSON、真实图像、Chromium、公开接口模拟与隔离数据库的 HTTP 回归 |
| `server/test-gaoding-ui.py` | 真实前端测试未知完整性提示、关联元数据保存、失败不写占位图与可重试 |
| `server/inspect-gaoding.js` | 可重复的只读页面、网络、DOM、错误图内容诊断 |
| `server/verify-gaoding-live.js` | 隔离数据库的真实 HTTP 联网验证 |
| `PLATFORM_EXTRACTION_LOGIC_FOR_PYTHON.md` | 同步稿定专项最新执行流程 |
| `GAODING_FIX_REPORT.md` | 复现证据、变更及验收说明 |

`client/src/store/index.js`、加载状态报告及旧加载测试在本次任务开始前已存在未提交修改，未将其归为本次新增修改。

## 验证与限制

- 三个要求的 `node --check` 通过。
- `node test-gaoding.js`：9 项辅助测试通过。
- `node --test test-gaoding-regression.js`：20 项专项测试，包含真实单页、部分多页、JSON 补页、网络延迟加载、局部元素、同页版本、签名 URL、动态兜底未知与完整单页、历史保存及恢复。
- `node --test test-818ps-regression.js`：28 项通过，含 GIF 帧/格式验证、二进制代理、动态图下载、动态多页及历史恢复。
- 前端原有加载交互：17 个场景通过；专项稿定 UI 通过；`npm run build` 通过。构建仍有已有的包体积/CJS 提示。
- 当前复现链接已完成真实图片和真实 HTTP 响应验证。
- 历史分享 `RgQONAoAy0AkCoQVR0PHE` 的公开接口确认已关闭或过期，返回明确限制，未用其他图片替代。
- 创客贴/Canva 等只验证了统一分页结构兼容性；未对这些平台新增联网验收，也未修改其专用提取算法。

签名图片会过期，应重新解析获取新 URL。预览接口未提供总页数或可编辑设计 JSON 时，当前结果只能确认为目标预览，不能推断完整设计稿页数。动态分页仅在明确的预览区分页控件上有限执行；未知分页结构保持部分或未知状态。
