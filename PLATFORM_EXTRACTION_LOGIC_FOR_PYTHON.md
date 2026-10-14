# 多平台提取逻辑总览（供 Python 重构参考）

## 1. 文档目的

这份文档面向当前 Node.js 项目里的四个平台提取实现：

- 图怪兽 / 818ps
- 创客贴
- 稿定设计
- 花瓣网

目标不是做产品介绍，而是把现在真实在跑的提取链路、函数分工、回退顺序、候选图筛选、多页识别、结果归一化方式整理出来，方便你后续对照优化 Python 脚本。

如果你需要图怪兽更细的逐函数说明，仓库里已经有单独文档：

- `818PS_EXTRACTION_LOGIC.md`

## 2. 当前真实入口链路

主入口在 `server/index.js` 的 `POST /api/extract-image`。

当前统一调用链可以概括为：

```text
POST /api/extract-image
  -> resolvePlatform(url, platform)
  -> extractImage(url, resolvedPlatform)                       // server/imageExtractor.js
  -> 阶段1：先尝试第三方 API 网关（花瓣跳过）
  -> 阶段2：按平台进入本地 extractor
  -> normalizeExtractPayload(result)
  -> 返回统一结构给前端
```

平台识别规则主要在 `resolvePlatform(url, platform)`：

- URL 含 `818ps` 或 `tuguaishou` -> `818ps`
- URL 含 `gaoding.com` 或 `gaoding.cn` -> `Gaoding`
- URL 含 `huaban.com` / `api.huaban.com` / `huabanimg.com` -> `Huaban`
- 创客贴主要依赖 `extractImage()` 中对 `chuangkit.com` 的判断

`extractImage(url, platform)` 的平台主分发顺序：

```text
818ps      -> extract818psImage(url)
Gaoding    -> extractGaodingImage(url)
Huaban     -> extractHuabanImage(url)
Chuangkit  -> extractChuangkitImageEnhanced(url)
```

注意两个外层特性：

- 花瓣会跳过第三方 API 网关，直接走本地公开接口逻辑。
- 创客贴即使第三方接口返回单张，也会继续尝试本地套图提取；只有本地没拿到多图时才回退第三方单图结果。

## 3. 统一返回结构

所有平台最终都会尽量归一到同一类结构，核心字段如下：

```json
{
  "success": true,
  "platform": "Gaoding",
  "imageUrl": "第一页图片",
  "thumbnailUrl": "缩略图或第一页图片",
  "imageUrls": ["第1页", "第2页"],
  "images": ["第1页", "第2页"],
  "pages": [
    { "page": 1, "imageUrl": "..." },
    { "page": 2, "imageUrl": "..." }
  ],
  "pageCount": 2,
  "isMultiPage": true,
  "source": "dynamic-network-preview-bundle",
  "method": "browser_network_preview_bundle",
  "linkType": "share",
  "original_url": "原始输入链接"
}
```

`server/index.js` 里的 `normalizeExtractPayload(result)` 会再次做统一清洗：

- 合并 `pages`、`imageUrls`、`images`、`imageUrl`、`thumbnailUrl`
- 去重
- 过滤明显无关资源
- 自动补 `pages`
- 自动计算 `pageCount`
- 自动推断 `isMultiPage`

对 Python 脚本来说，建议也保留这一层“最终归一化”，不要把平台特定逻辑直接暴露给调用方。

## 4. 通用迁移建议

这四个平台虽然实现不同，但底层提取模式大致一致：

1. 先做 URL 规范化和平台识别。
2. 如果平台有公开 API，优先用 API。
3. 如果 URL 内已有稳定 ID，优先尝试根据 ID 拼接直链并验证。
4. 先做静态 HTML 解析，再做浏览器动态提取。
5. 多页优先级高于单页。
6. 返回前统一做图片 URL 验证、去重、排序、补页码。

Python 版建议保留四类公共能力：

- `normalize_url()`
- `validate_image_url()`
- `dedupe_urls()`
- `build_result()` / `build_failure_result()`

## 5. 图怪兽 / 818ps

### 5.1 主要文件

- `server/imageExtractor.js`
- `server/extractors/818ps.js`
- `server/services/browser.js`
- `818PS_EXTRACTION_LOGIC.md`

### 5.2 外层入口

`extractImage()` 命中 818ps 后会调用：

```text
extract818psImage(url)
  -> 先调新版 extract818ps(url, { timeout, headless })
  -> 新版失败时回退旧逻辑
  -> 旧逻辑仍失败时继续网页抓取 / 浏览器兜底
```

也就是说，当前真正的主逻辑已经在 `server/extractors/818ps.js`，`server/imageExtractor.js` 里的 818ps 代码主要是兼容旧版兜底。

### 5.3 新版主流程

主函数：

```js
async function extract818ps(url, options = {})
```

执行顺序：

```text
1. normalizedUrl = trim(url)
2. resolvedUrl = resolve818psShareUrl(normalizedUrl)
3. queryParams = extractShareQueryParams(resolvedUrl)
4. 若有 shareId:
     -> extractFromShareApi()
     -> 成功直接返回
5. 若有 upicId:
     -> extractWithUpicIdPriority()
     -> 成功直接返回
6. -> scrapeWebpageEnhanced()
   -> 成功直接返回
7. -> extractDynamicContent()
8. -> analyzeDynamicData()
   -> 成功直接返回
9. 若仍失败且有 upicId:
     -> 再试一次 extractWithUpicIdPriority()
10. 返回 buildFailureResult("no_valid_image_found")
```

### 5.4 818ps 的关键优先级

当前排序反映了真实命中策略：

- 分享 API 最优先，因为成本最低、结构最稳定。
- `upicId` / `picId` 直连验证次优先，因为不需要解析整个页面。
- 静态 HTML 抓取优先于浏览器，因为更轻。
- Puppeteer 动态抓取最重，放最后。

### 5.5 分享 API 链路

关键函数：

- `resolve818psShareUrl()`
- `extractShareQueryParams()`
- `extractFromShareApi()`
- `extractExpectedPageCountFromShareApiPayloads()`

这部分核心思路是：

- 先把分享短链、跳转链接尽量解析到真实地址。
- 从 URL 里抽出 `shareId`、`share_uid`、`picId`、`upicId` 等参数。
- 调用图怪兽分享相关接口。
- 从接口 payload 中优先提取 `preview` 数组、多页预览、封面字段、原图字段。
- 根据分享接口里透露的页数字段判断是否应该返回多页。

### 5.6 基于 upicId 的直连优先

关键函数：

- `extractWithUpicIdPriority()`
- `build818psVariants()`
- `validateImageUrl()`

逻辑重点：

- 818ps 的很多链接最终都能映射到稳定图片资源路径。
- 会基于 `upicId`、`picId` 拼出多种可能 URL。
- 同时会对现有 URL 做“去样式后缀、替换 preview 路径、替换扩展名”的无水印/原图变体尝试。
- 每个候选都必须经过 `validateImageUrl()` 验证，避免返回 404 或假图。

### 5.7 静态 HTML 抓取

关键函数：

- `scrapeWebpageEnhanced()`
- `normalizeResultImages()`

静态层会做的事情：

- 带 818ps 站点头信息请求页面。
- 用 Cheerio 解析 `img`、`data-src`、背景图、内嵌脚本、JSON 片段。
- 从 HTML 文本和结构化数据里提取图片候选。
- 根据图怪兽资源路径特征过滤掉图标、素材、贴纸、编辑器资源、水印层等无关图片。
- 若静态层已经拿到足够稳定的多页或高质量单页，直接返回。

### 5.8 动态抓取与多页识别

关键函数：

- `extractDynamicContent()`
- `captureDynamicSnapshot()`
- `scrollDynamicPage()`
- `activateDynamicPage()`
- `extractPageSpecificImageUrls()`
- `analyzeDynamicData()`
- `collectPreviewGroupsFromData()`
- `scoreDynamicImage()`

动态层不是单纯“打开页面拿第一张图”，而是明确围绕多页套图做了三件事：

1. 滚动页面，持续抓取新出现的图片和 JSON 数据。
2. 识别页面上的“第1页 / 第2页”这类分页标记。
3. 逐页激活缩略图或分页元素，再分别抓当前页图片。

动态抓取内部维护的核心数据包括：

- `imageUrls`
- `resourceUrls`
- `visibleCandidates`
- `pageMarkers`
- `pageSnapshots`
- `pageSpecificImages`
- `jsonData`
- `windowData`

`analyzeDynamicData()` 的优先级大致是：

```text
1. 先取逐页激活后得到的 pageSpecificUrls
2. 再看 JSON / windowData 里是否存在成组 preview urls
3. 再汇总所有动态候选做打分和验证
4. 多页优先，单页其次
```

### 5.9 818ps Python 迁移时必须保留的点

- 不要只依赖 HTML 中第一张 `og:image`。
- 一定保留 `shareId` 路线和 `upicId` 路线。
- 动态阶段必须有“分页元素激活”能力，否则多页经常退化成单页。
- 结果选择要优先成组预览图，再考虑单张大图。
- URL 验证必须带反盗链头，不能裸请求。

### 5.10 818ps 常见 source

- `share_api_share_template`
- `dynamic_page_activation`
- `dynamic_multi_page_extraction`
- `dynamic_json_extraction`
- `validated`

## 6. 创客贴

### 6.1 主要文件

- `server/imageExtractor.js`
- `server/services/browser.js`

创客贴和另外三个平台不一样，它没有单独的 `server/extractors/chuangkit.js`，而是分成两层：

- 服务层：`extractChuangkitImageEnhanced()` 负责入口和回退
- 浏览器层：`scrapeChuangkit()` 实际导出的是增强版 `scrapeChuangkitEnhanced()`

### 6.2 外层主流程

主函数：

```js
async function extractChuangkitImageEnhanced(url)
```

当前顺序：

```text
1. 判断 linkType：share / direct / template / other
2. 静态请求页面 HTML
3. 提取 meta / DOM / 背景图 / 文本中的候选图片
4. collectValidatedChuangkitCandidates() 做验证
5. 如果静态结果 > 1 张:
     -> 直接返回 source = "static-scan"
6. 否则进入 scrapeChuangkit(url)
7. 将浏览器结果与 staticFallbackUrls 合并去重
8. 如果浏览器有结果:
     -> 返回 source = result.source 或 "puppeteer-url"
9. 如果浏览器失败但静态还有结果:
     -> 返回 source = "static-fallback"
10. 再不行走 scrapeWithBrowser(url) 通用兜底
```

### 6.3 静态层做了什么

静态层主要扫描三类内容：

- `meta[property="og:image"]` 等 meta 标签
- 分享页、设计页、模板页常见 DOM 选择器
- HTML 文本中的图片 URL

典型特征：

- 会扫描 `img[src]`、`img[data-src]`、`data-original`
- 会解析 `style="background-image:url(...)"` 的背景图
- 会按创客贴设计图路径特征给 URL 打分
- 得分过低的缩略图、图标、素材图会被丢掉

如果静态阶段已经拿到多张有效图，就直接返回，不再启动 Puppeteer。

### 6.4 浏览器增强层主逻辑

浏览器主函数在 `server/services/browser.js`：

```js
async function scrapeChuangkitEnhanced(pageUrl)
```

内部关键函数：

- `normalizeChuangkitImageUrl()`
- `isBlockedChuangkitAssetUrl()`
- `scoreChuangkitDesignUrl()`
- `extractChuangkitPageHint()`
- `dedupeChuangkitUrls()`
- `buildChuangkitResult()`
- `buildOrderedChuangkitUrls()`
- `collectChuangkitDomCandidates()`
- `traverseChuangkitGallery()`

### 6.5 创客贴浏览器层的真实做法

#### 6.5.1 监听网络响应

页面加载后会监听 `response`：

- 如果响应是图片，直接拿 URL 和 `content-length` 记为候选。
- 如果响应是 JSON / HTML / JS 文本，会继续从文本里提取图片 URL。
- 候选会进入 `captureCandidate()`，统一打分并更新最佳结果。

#### 6.5.2 首轮 DOM 抓取

`collectChuangkitDomCandidates(page)` 会从当前页面抓：

- 缩略图列表
- `data-page` / `data-index` 相关元素
- `render_result` 路径图片
- 背景图 URL

它还会给每个候选记录：

- `pageHint`
- `domIndex`
- `selector`

这些信息后续会用来对套图排序。

#### 6.5.3 遍历套图缩略图

`traverseChuangkitGallery(page)` 是多页核心。

它会：

- 找缩略图、页签、slide、page-item 等元素
- 过滤不可见或尺寸异常元素
- 依次点击这些候选
- 每次点击后等待页面刷新，再继续收集新设计图

如果这个步骤缺失，Python 版通常只能拿到封面或当前页。

#### 6.5.4 二次 DOM 抓取与排序

点击缩略图之后会再次调用 `collectChuangkitDomCandidates()`。

随后 `buildOrderedChuangkitUrls()` 按以下优先级排序：

- 先按 `pageHint`
- 再按 `domIndex`
- 再按 `score`
- 最后按捕获顺序

这样能尽量把结果稳定排成 1 页、2 页、3 页。

#### 6.5.5 清理非设计元素

浏览器层会注入 CSS/JS，主动隐藏或移除：

- watermark
- overlay
- mask
- logo
- toolbar
- header
- sidebar
- footer

目的不是为了“破解”，而是让 DOM 收集和截图回退时更接近最终设计稿。

#### 6.5.6 回退顺序

如果浏览器层拿不到多张有序图，会按下面顺序回退：

1. `orderedImageUrls` 多图结果
2. `bestDesignImageUrl` 最优单图
3. 页面元素截图 `data:image/...`
4. DOM 最终兜底单图

### 6.6 创客贴 Python 迁移时必须保留的点

- 必须保留“网络响应抓图 + DOM 抓图 + 缩略图遍历”三条线并行。
- 必须保留 `pageHint` 排序，否则多页顺序会乱。
- 不能只抓最终页面里最大的 `img`，因为很多套图缩略图点击后才会切换。
- 最终结果要把浏览器命中的 URL 和静态命中的 URL 合并去重。

### 6.7 创客贴常见 source

- `static-scan`
- `static-fallback`
- `puppeteer-url`
- `puppeteer-screenshot`
- `generic-scrape`

## 7. 稿定设计

### 7.1 入口与流程

主要实现为 `server/extractors/gaoding.js` 的 `extractGaoding()`，由 `server/imageExtractor.js` 分发。稿定使用与目标分享关联的本地数据，避免第三方网关无关联图片直接成为结果。

```text
URL 规范化（只清理确认属于分享文案的 fragment）
  -> 静态 HTML 的 script JSON / web-widget contextdata
  -> 公开分享接口 /api/dam/shares/:code/resource
  -> 该分享 file_ids 对应的 /api/dam/asset/:id
  -> 可信预览字段与 design_info.url 对应的设计 JSON
  -> 解析 pages / layouts，验证整页图片与页面分组
  -> 未确认完整时继续浏览器池动态 HTML / 相关网络 JSON
  -> 有目标预览区、文件 ID 及图像证据时允许 dynamic-visible 兜底
```

普通渠道头来自稿定公开客户端配置。分享需要密码、已关闭或过期时，报告限制并停止设计资源请求；不附加登录凭证、不关闭 TLS 验证。

### 7.2 页面与来源判定

`collectDesignData()` 跳过普通元素、推荐、UI 等分支，收集页面级 `source_preview_info`、`preview_info` 及缩略图等字段。每个候选保留分享/设计/页面标识、证据字段路径、资源角色及验证结果。

`pages[]` 优先作为页面结构；等价 `layouts[]` 可以按页面 ID 补充预览，缺少 ID 且数量相同时按位置对齐。不同分辨率在同一页面分组中选主图；`extends_previews` 没有页面标识时作为同页版本，不能单凭数量认定多页。

`fetchDesignJsonPageUrls()` 在静态阶段继续读取所有已关联设计 JSON，即使 HTML 已有封面或多图。真实单页 JSON 与多页 JSON 都支持。

`finalizeState()` 使用图像响应类型、真实尺寸、已知宽高比及字段角色进行验证。签名 URL 保持原参数，来源可靠的长海报不会因为通用尺寸阈值被拒绝。

### 7.3 完整性与动态兜底

`pageCount` 是实际输出数量；`expectedPageCount` 只取可靠页面数据，不从图片数量或资源文件名猜测。新增字段与图怪兽现有结构一致：`collectedPageCount`、`pageCountConfidence`、`completenessStatus`、`isComplete`、`missingPages`。

仅数量证据与有效整页资源一致时标为完整。只取得封面或缩略图时保留部分状态；总页数未知时 `isComplete: null`、`completenessStatus: unknown`。

`dynamic-visible` 保留，限定在 `#dam-preview-container` 中匹配目标文件 ID 的已加载图片。有可靠单页数量与匹配整页尺寸时可以完整成功；仅存在可见图而没有完整性证据时仍为未知。

动态阶段复用现有浏览器池，限制网络响应数量、正文大小、分页次数与请求预算。最终日志记录实际来源、数量和证据，避免将“取得一张图”等同于“完整提取成功”。

### 7.4 验证

- `node test-gaoding.js`：辅助函数回归。
- `node --test test-gaoding-regression.js`：本地 HTML/JSON、真实图像、浏览器和隔离数据库 HTTP 回归。
- `node verify-gaoding-live.js [url]`：真实 HTTP 联网验证，禁止生产数据库写入。
- 专项前端回归：`server/test-gaoding-ui.py`，通过 webapp-testing 的 with_server 启动 Vite。

当前复现的真实证据、资源 URL、图片与限制见 `GAODING_FIX_REPORT.md`。常见来源为 `share-api-preview`、`html-preview`、`design-json-pages`、`dynamic-network-preview`、`dynamic-html-preview`、`dynamic-visible`。

## 8. 花瓣网

### 8.1 主要文件

- `server/extractors/huaban.js`
- `server/index.js`

### 8.2 花瓣与另外三个平台的最大区别

花瓣当前逻辑不是以 Puppeteer 为核心，而是以公开 API 为核心。

主函数：

```js
async function extractHuaban(url, options = {})
```

总流程：

```text
1. classifyLink(url)
2. pin      -> extractPin()
3. board    -> extractBoard()
4. discovery-> extractDiscovery()
5. 不支持的链接 -> buildFailureResult()
```

### 8.3 链接分类

`classifyLink(url)` 会识别：

- `pin`
- `board`
- `discovery`

这里既支持普通页面 URL，也兼容 `api.huaban.com` 的路径形式。

### 8.4 公开 API 路径

当前固定 API 根：

- `API_ROOT = https://api.huaban.com`

原图 host：

- `RAW_IMAGE_HOST = https://hbimg.huabanimg.com`

### 8.5 单个 pin 提取

`extractPin(url)` 的流程：

```text
1. 提取 pinId
2. GET /pins/{pinId}
3. 从 payload.pin 构建 entry
4. normalizePinImageUrl(pin)
5. validateImageUrl(entry.imageUrl)
6. 如果 previewOnly:
     -> buildPreviewImageResult()
7. 否则:
     -> buildImageResult()
```

`normalizePinImageUrl(pin)` 的核心逻辑：

- 优先使用 `pin.file.key`
- 拼成 `https://hbimg.huabanimg.com/{file.key}`
- 如果没有 `file.key`，再从 `pin.file.url` 提取路径并转成 `hbimg.huabanimg.com` 地址

### 8.6 board / discovery 提取

#### 8.6.1 `extractBoard(url)`

- 请求 board 元信息
- 请求 `/boards/{boardId}/pins`
- 进入 `buildFeedResult(pins, originalUrl, extras)`

#### 8.6.2 `extractDiscovery(url)`

- 根据发现页 URL 构造 discovery API
- 请求后同样进入 `buildFeedResult()`

### 8.7 花瓣的 previewOnly 判定

关键函数：

- `isPublicPreviewOnlyPin(pin)`
- `buildPreviewOnlyReason(pin)`
- `buildPreviewOnlyResult()`
- `buildPreviewImageResult()`

逻辑含义：

- 有些花瓣素材公开接口只能拿到带水印预览图，拿不到无水印原素材。
- 当前实现不会把这种情况误判成彻底失败，而是显式返回：
  - `status = "preview_image"`：拿到了可下载的公开预览图
  - `status = "preview_only"`：只有“公开只能预览”的结论，没有可用图片

这部分对 Python 版非常重要，因为花瓣很多素材本来就没有匿名公开无水印下载地址。

### 8.8 列表页结果构建

`buildFeedResult()` 会：

1. 从 pins 构建 entry 列表
2. 去重
3. 按 `limit` 控制最大条数
4. 区分 `previewOnlyEntries` 和 `publicEntries`
5. 优先验证可公开访问图片
6. 如果只有 previewOnly，也尽量返回带状态说明的结果，而不是纯失败

### 8.9 图片验证与反盗链

关键函数：

- `getHotlinkHeaders(imageUrl)`
- `validateImageUrl(imageUrl)`

验证方式：

- 先 HEAD
- HEAD 不可靠时再 GET `Range: bytes=0-0`
- 要求 HTTP 200/206
- 要求 `content-type` 看起来像图片
- 如果能读出大小，要求至少大于最小阈值

请求头会补：

- `Referer: https://huaban.com/`
- `Origin: https://huaban.com`

### 8.10 `/api/proxy-image` 的作用

`server/index.js` 里有一个：

```text
GET /api/proxy-image
```

它会对 `*.huabanimg.com` 这类图片请求补 Referer/Origin，主要用于前端展示时绕过防盗链。

注意：

- 这个代理不是“提取逻辑”的核心。
- 它只是让前端能够稳定展示已经提取到的花瓣图片。

### 8.11 花瓣 Python 迁移时必须保留的点

- 花瓣优先 API，不要默认上浏览器抓取。
- 要接受“只能拿到公开预览图”的现实，并把状态区分清楚。
- 列表页应按条目构建结果，不要只取第一张。
- 反盗链请求头必须补齐。

### 8.12 花瓣常见 source / status

source：

- `huaban-pin-api`
- `huaban-board-api`
- `huaban-discovery-api`

status：

- `success`
- `preview_image`
- `preview_only`

noticeCode：

- `huaban_preview_image`
- `huaban_preview_only`

## 9. 四个平台的反盗链与请求头差异

Python 版建议按平台维持不同的 headers 策略。

### 9.1 图怪兽 / 818ps

- `Referer: https://818ps.com/`
- `Origin: https://818ps.com`

### 9.2 创客贴

- `Referer: https://www.chuangkit.com/`
- `Origin: https://www.chuangkit.com`

### 9.3 稿定设计

- `Referer: https://www.gaoding.com/`
- `Origin: https://www.gaoding.com`

### 9.4 花瓣网

- `Referer: https://huaban.com/`
- `Origin: https://huaban.com`

如果 Python 脚本后面出现“能解析出 URL，但下载时报 403 / 404 / 空内容”，第一优先排查的就是 Referer、Origin 和 HEAD/Range 验证方式。

## 10. 建议保留的 Python 伪代码骨架

```python
def extract_image(url: str, platform: str | None = None) -> dict:
    resolved_platform = resolve_platform(url, platform)

    if resolved_platform == "Huaban":
        result = extract_huaban(url)
    else:
        result = try_third_party_gateway(url, resolved_platform)
        if not is_good_result(result):
            if resolved_platform == "818ps":
                result = extract_818ps(url)
            elif resolved_platform == "Gaoding":
                result = extract_gaoding(url)
            elif resolved_platform == "Chuangkit":
                result = extract_chuangkit(url)

    return normalize_extract_payload(result)
```

各平台内部都建议维持类似结构：

```python
def extract_xxx(url: str) -> dict:
    normalized_url = normalize_url(url)

    result = try_api(normalized_url)
    if is_multi_page(result) or is_high_confidence(result):
        return result

    result2 = try_static_html(normalized_url)
    if is_multi_page(result2) or is_high_confidence(result2):
        return choose_better(result, result2)

    result3 = try_dynamic_browser(normalized_url)
    return normalize_result(choose_better(result, result2, result3))
```

## 11. 最后结论

如果你要把当前 Node 逻辑迁到 Python，四个平台最需要保留的不是“具体选择器本身”，而是下面这些策略：

- 入口统一，平台内部各自拆成 API / 静态 / 动态 / 兜底。
- 多页结果优先级高于单页。
- 候选图一定要打分、验证、去重、排序。
- 不同平台必须使用不同的反盗链请求头。
- 花瓣要支持 `preview_image` / `preview_only` 这种半成功状态。

按这个结构迁移，后续你只需要持续替换具体规则和选择器，而不需要反复推翻整个 Python 架构。
