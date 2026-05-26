# 818ps / 图怪兽提取逻辑详解

## 1. 文档目的

这份文档说明当前项目里“图怪兽 / 818ps 链接提取”是如何工作的，覆盖以下内容：

- API 请求从哪里进入
- 818ps 本地提取器的完整执行顺序
- 分享链接、多页套图、静态页面、动态页面分别如何处理
- 图片候选是如何过滤、打分、验证、归一化的
- 为什么还保留一条旧版兜底链路

这份文档对应当前代码实现，而不是历史方案或概念设计稿。

## 2. 相关文件

核心文件：

- `server/index.js`
- `server/imageExtractor.js`
- `server/extractors/818ps.js`
- `server/services/browser.js`

辅助入口：

- `server/controllers/imageController.js`
- `server/test-818ps-optimized.js`
- `server/test-extractors.js`

## 3. 总体入口链路

当前主服务入口在 `server/index.js` 的 `POST /api/extract-image`。

完整调用链如下：

```text
客户端请求 /api/extract-image
  -> server/index.js
  -> resolvePlatform(url, platform)
  -> extractImage(url, resolvedPlatform)            // server/imageExtractor.js
  -> 平台判断命中 818ps / tuguaishou
  -> extract818psImage(url)                         // server/imageExtractor.js
  -> 优先调用新版 extract818ps(url)                // server/extractors/818ps.js
  -> 若新版失败，再走旧版兜底逻辑
  -> normalizeExtractPayload(...)
  -> 返回统一结构给前端
```

注意：

- `server/controllers/imageController.js` 里也有 `extract818ps(url)` 的调用入口，但当前主运行链路主要走 `server/index.js` + `server/imageExtractor.js`。
- `extractImage(url, platform)` 在更外层还会先尝试第三方 API 网关；如果第三方直接成功，可能不会进入本地图怪兽提取器。

## 4. 外层服务层逻辑

`server/imageExtractor.js` 中的 `extractImage(url, platform)` 会分两层处理：

### 4.1 第一层：第三方 API 网关

逻辑位置：

- `server/imageExtractor.js`

行为：

- 先尝试 `extractViaThirdPartyAPIWithCache(url, platform)`
- 如果第三方直接返回有效图片，则优先返回
- 对图怪兽来说，这一步属于“外层捷径”，不属于本地爬取核心

### 4.2 第二层：平台特定本地提取

当平台是 `818ps` 或 URL 包含 `818ps.com` / `tuguaishou.com` 时：

```text
extractImage(...)
  -> extract818psImage(url)
```

`extract818psImage(url)` 的职责是：

1. 先调用新版优化提取器 `extract818ps(url, { timeout, headless })`
2. 如果新版没有拿到结果，再回退到旧版逻辑

因此，真正的主逻辑现在已经在 `server/extractors/818ps.js`。

## 5. 新版提取器总流程

`server/extractors/818ps.js` 中的主函数是：

```js
async function extract818ps(url, options = {})
```

执行顺序如下：

```text
1. 规范化输入 URL
2. 解析/补全分享链接的最终地址
3. 从 URL 中提取 picId / upicId / share_id / share_uid 等参数
4. 如果有 share_id，优先走分享接口提取
5. 如果有 upicId，优先走已知资源路径直连验证
6. 尝试静态 HTML 抓取
7. 尝试动态页面抓取（Puppeteer）
8. 如果前面都失败，再重试一次 upicId 直连
9. 仍然失败则返回统一失败结果
```

代码中的顺序非常重要，因为它体现了当前对“成本”和“命中率”的平衡：

- 分享 API 成本最低，优先
- 已知资源路径直连很快，第二优先
- 静态 HTML 解析比浏览器轻，优先于动态抓取
- Puppeteer 最重，放在后面

## 6. 输入规范化与上下文补齐

### 6.1 URL 规范化

函数：

- `normalizeCandidateUrl`
- `resolve818psShareUrl`

目标：

- 统一 `//xxx` 为 `https://xxx`
- 去掉无效引号、转义
- 对分享链接做一次真实跳转解析，拿到最终 URL

### 6.2 分享链接跳转解析

函数：

- `resolve818psShareUrl(inputUrl)`

逻辑：

- 如果 URL 里已经带有 `share_id` 或 `upicId`，直接认为它已经是可用链接
- 否则用 `axios.get()` 请求页面，让服务端跟随重定向
- 再从最终响应里提取真实地址

这样做的目的，是把一些“短分享链接 / 包装页链接”解析成后续可直接使用的 URL。

### 6.3 URL 参数解析

函数：

- `extractShareQueryParams(inputUrl)`

提取字段：

- `picId`
- `upicId`
- `shareId`
- `shareUid`
- `saveType`
- `userSource`

这些参数决定后续能不能走分享 API 和已知资源路径。

## 7. 第一优先级：分享 API 提取

函数：

- `extractFromShareApi(url)`

这是新版提取器里最“低成本、高命中”的路径。

### 7.1 前置条件

只有 URL 中存在 `share_id` 时才会尝试。

如果同时还有 `upicId` 和 `shareUid`，会请求更多接口。

### 7.2 调用的接口

代码里会按条件调用这些接口：

```text
share-template
team-share-get-templ
get-template-page-data
get-template-info
```

对应实现中实际拼接的地址：

- `https://818ps.com/apiV1/template/index/share-template?share_id=...`
- `https://818ps.com/api/team-share-get-templ?...`
- `https://818ps.com/apiv2/get-template-page-data?...`
- `https://818ps.com/apiv2/get-template-info?...`

### 7.3 分享 API 的提取思路

关键函数：

- `fetchJson`
- `extractExpectedPageCountFromShareApiPayloads`
- `extractShareApiPreviewGroups`
- `extractPreviewUrlsFromArray`
- `normalizePreviewGroupUrls`

提取器会：

1. 先把多个接口的 JSON 都拉回来
2. 从其中的 `preview`、`page_map`、`pageInfo` 等结构推断预期页数
3. 从数组对象里提取预览图 URL
4. 对 URL 做去重、排序、过滤
5. 校验这些 URL 是否真的可访问

### 7.4 分享 API 里重点识别的字段

常见字段来自常量 `SHARE_PREVIEW_FIELDS`，包括：

- `origin_img`
- `big_img`
- `img`
- `image`
- `imageUrl`
- `preview`
- `previewUrl`
- `cover`
- `coverUrl`
- `user_preview_ue`
- `user_preview`

### 7.5 什么时候直接返回

对某个预览组，如果满足下面任一条件，就会直接返回：

- 预期只有 1 页
- 有效图片数已经达到预期页数
- 有效图片数大于 1

如果没有完全达到预期页数，但已经拿到部分有效结果，会先保留“最好的部分结果”。

## 8. 第二优先级：upicId / picId 直连验证

函数：

- `buildUpicIdCandidates`
- `build818psVariants`
- `extractWithUpicIdPriority`
- `findFirstValidCandidate`

### 8.1 这条路径解决什么问题

当 URL 里已经明确给出 `upicId`、`picId` 时，很多时候不需要再解析页面，直接就能拼出真实资源地址。

### 8.2 候选 URL 的生成方式

会先构造一批基础路径，例如：

- `user_preview_ue`
- `user_preview`
- `pic`

会同时覆盖这些域名：

- `img.818ps.com`
- `cdn.818ps.com`
- `static.818ps.com`
- `img.tuguaishou.com`

还会自动尝试这些扩展名：

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`

### 8.3 变体扩展

`build818psVariants(url)` 会继续对同一个 URL 做多种变体生成，例如：

- 去掉 `!l1600` 这类尺寸后缀
- 去掉 `!xxx` 风格的处理后缀
- 把 `ips_user_preview_api/` 改写成 `pic/`
- 把 `user_preview_ue/` 改写成 `pic/`
- 把 `preview` 改写成 `origin`
- 更换图片扩展名

这是图怪兽链路里非常关键的一步，因为很多页面里暴露的是“预览图路径”，但真实原图路径和它只差一两个路径片段。

### 8.4 验证策略

不会盲目返回第一个拼出来的 URL，而是：

1. 并发校验候选 URL
2. 找到第一个真正能访问的资源
3. 返回该资源

## 9. 图片 URL 校验与防盗链处理

关键函数：

- `getAntiHotlinkHeaders`
- `validateImageUrl`
- `isValidImageResponse`
- `extractReportedSize`

### 9.1 防盗链头

对不同域名会补不同的 `Referer` / `Origin`：

- 图怪兽域名使用 `https://tuguaishou.com/`
- 818ps 域名使用 `https://818ps.com/`

### 9.2 校验策略

校验顺序：

1. 先发 `HEAD`
2. 如果不稳定，再发带 `Range: bytes=0-0` 的 `GET`

通过条件：

- 状态码是 `200` 或 `206`
- `Content-Type` 像图片
- 文件大小不是明显异常的小文件

这样做的目的是：

- 尽量少下载完整大图
- 又能避开部分 CDN 不支持或错误处理 `HEAD` 的情况

## 10. 第三优先级：静态 HTML 抓取

函数：

- `scrapeWebpageEnhanced`

这是“不启动浏览器”的静态解析路径。

### 10.1 静态抓取入口

提取器会直接请求页面 HTML，然后组合多种来源找候选图：

- `<meta>` 图
- `<img>` / `srcset`
- 内联样式中的 `background-image`
- 页面里嵌入的 JSON
- 正则全文兜底

### 10.2 静态解析用到的函数

- `extractMetaImageFromHtml`
- `extractJsonData`
- `extractWithCheerio`
- `extractWithRegexFallback`
- `extractImageUrlsFromData`
- `collectPreviewGroupsFromData`

### 10.3 为什么先看结构化分组

静态阶段会优先从 JSON 数据中寻找“多页预览组”。

因为单纯抓一堆 URL 往往会混入：

- 元素素材
- 图标
- 水印图
- 按钮和贴纸资源

而结构化预览组通常更接近真实分页设计稿。

### 10.4 静态阶段的返回优先级

顺序如下：

1. JSON 里命中的多页预览组
2. 页面中筛出的多页设计候选
3. `<meta>` 图
4. 单图最佳候选

对应 source 可能是：

- `static_group_xxx`
- `static_multi_page_extraction`
- `meta_image`
- `static_best_candidate`

## 11. 候选 URL 的过滤与打分

关键函数：

- `isRelevantDynamicImage`
- `isDesignPageCandidate`
- `scoreDynamicImage`

### 11.1 过滤目标

图怪兽页面里会混入大量无关图片，提取器会主动过滤：

- `favicon`
- `logo`
- `avatar`
- `tracking`
- `banner`
- `button`
- `sticker`
- `watermark`
- `ips_svg`
- `ips_icon`
- `ips_material`

### 11.2 什么算“相关图片”

只要 URL 命中这些信号之一，就更可能是设计图：

- `img.tuguaishou.com`
- `img.818ps.com`
- `cdn.818ps.com`
- `static.818ps.com`
- `user_preview_ue`
- `user_preview`
- `user_work`
- `preview`
- `work/`
- `pic/`
- `auth_key=`

### 11.3 什么算“设计页候选”

`isDesignPageCandidate(url)` 比 `isRelevantDynamicImage(url)` 更严格：

- 域名必须是可信 CDN
- 路径要像 `user_preview_ue`、`user_preview`、`user_work`、`works`
- 要尽量排除素材、小图、图标等噪音

### 11.4 打分逻辑

`scoreDynamicImage(url, source)` 会综合这些因素：

- 域名权重：`img.tuguaishou.com` 最高
- 路径权重：`user_preview_ue` 高于 `user_preview`
- 是否带 `auth_key`
- 是否带大尺寸后缀如 `!l1600`
- 文件扩展名
- URL 来源：`share_api_*`、`page_specific`、`resource`、`json`、`page_source`
- 是否属于设计页候选

同时也会对这些信号做扣分：

- `icon`
- `thumb`
- `small`
- `asset`
- `element`

## 12. 第四优先级：动态页面抓取

函数：

- `extractDynamicContent`
- `captureDynamicSnapshot`
- `scrollDynamicPage`
- `activateDynamicPage`
- `analyzeDynamicData`

这是图怪兽多页提取最重但也最强的一层。

### 12.1 浏览器启动策略

使用：

- `puppeteer-extra`
- `StealthPlugin`

浏览器配置重点：

- `headless: "new"`
- `--no-sandbox`
- `--disable-setuid-sandbox`
- `--disable-dev-shm-usage`
- `--disable-blink-features=AutomationControlled`

同时会：

- 设置随机 `User-Agent`
- 补 `Accept-Language`
- 补 `Referer` / `Origin`

### 12.2 请求拦截

动态抓取时会直接拦截一部分请求：

- `font`
- `media`

目的是减少无关资源消耗，让页面尽快进入可分析状态。

### 12.3 动态快照抓取的核心内容

`captureDynamicSnapshot(page)` 一次会抓到这些数据：

- `pageSource`: 当前整页 HTML
- `windowData`: 页面挂在 `window` 上的业务数据
- `jsonData`: 页面内联 JSON 脚本
- `imageUrls`: DOM 中扫到的图片 URL
- `resourceUrls`: Performance 资源列表中的图片 URL
- `visibleCandidates`: 可见区域内的大图候选
- `pageMarkers`: 页面里识别到的“第 N 页”标记

### 12.4 DOM 扫描时读取的来源

会遍历整个 DOM，并尝试从这些地方读图片：

- `src`
- `data-src`
- `data-original`
- `data-url`
- `data-background`
- `href`
- `poster`
- `currentSrc`
- `srcset`
- `style.backgroundImage`
- `style.background`
- `style.maskImage`

### 12.5 为什么要记录 visibleCandidates

并不是所有图片都一样重要。

动态快照里会给候选打上这些几何特征：

- `width`
- `height`
- `area`
- `visibleArea`
- `isCentered`
- `isLarge`

后面的 `selectSnapshotPreviewUrls()` 会利用这些几何信息，优先选择：

- 可视区域更大
- 更居中
- 更像主设计图

### 12.6 滚动策略

`scrollDynamicPage(page, roundIndex)` 不只是滚动浏览器窗口，还会：

- 找页面内部可滚动容器
- 对每个容器分别推进滚动
- 同时触发 document 级滚动
- 记录本轮是否真的产生新内容

主循环最多滚动 8 轮，连续 2 轮没有新增图片和有效移动就提前结束。

### 12.7 分页激活策略

`activateDynamicPage(page, pageNumber)` 会在 DOM 中查找文本类似 `第N页` 的元素。

找到后会：

- 尝试定位可点击元素
- `scrollIntoView`
- 触发一组鼠标事件
- 调用 `.click()`
- 尝试点击覆盖层

它的目标不是“模拟一次普通点击”而已，而是尽量把页面真正切到目标页。

### 12.8 每页单独快照

拿到分页标记后，会逐页执行：

```text
激活第 N 页
  -> 等待页面刷新
  -> 再抓一轮 snapshot
  -> 对本页新出现的图片做预览图选择
  -> 记录到 pageSnapshots
```

最终会形成：

- `pageSnapshots`
- `pageSpecificImages`

这些是动态多页提取最重要的中间产物。

## 13. 动态结果分析策略

函数：

- `analyzeDynamicData(dynamicData, originalUrl)`

返回优先级如下：

### 13.1 第一优先级：逐页激活得到的分页图

调用：

- `extractPageSpecificImageUrls(dynamicData)`

如果通过逐页激活拿到了多于 1 张分页图，直接返回：

- `source: "dynamic_page_activation"`

### 13.2 第二优先级：结构化多页组

会从这些来源继续提结构化数据：

- `dynamicData.jsonData`
- `dynamicData.windowData`

然后复用：

- `collectPreviewGroupsFromData(...)`

如果某个结构化组验证后得到多张有效图，直接返回：

- `source: dynamic_structured_xxx`

### 13.3 第三优先级：所有动态候选合并后再筛

使用：

- `collectDynamicImageCandidates(dynamicData)`

候选来源会被统一并去重：

- 页面 DOM
- Performance 资源
- 分页激活新增图
- 各页快照
- `pageSource` 文本
- `jsonData`
- `windowData`

如果这些候选里能筛出一组设计页图片，就返回：

- `dynamic_multi_page_extraction`
- 或 `dynamic_json_extraction`

### 13.4 最终单图兜底

如果实在没有多页结果，但存在一个打分最高且验证可用的图片，也会返回单图成功。

## 14. 多页识别的核心思路

图怪兽多页提取的关键，不是“抓到更多图片”，而是“抓到每一页对应的主预览图”。

当前实现主要靠四类信号：

### 14.1 结构化预览数组

来自分享 API 或内联 JSON。

这类最可靠，因为它通常已经带有明确的分页顺序。

### 14.2 `第N页` 分页标记

来自动态页面 DOM。

这类信号可以帮助浏览器逐页切换，拿到每页主图。

### 14.3 设计页路径模式

例如：

- `user_preview_ue`
- `user_preview`
- `user_work`
- `/works/`

### 14.4 URL 中的页码线索

函数：

- `extractUrlPageNumber`
- `extract818psPreviewPageNumber`
- `sortUrlsByPageToken`

它会尽量从 URL 自身推导页码，再按页码排序，减少多页结果乱序的问题。

## 15. 结果归一化

函数：

- `normalizeResultImages`
- `buildSuccessResult`
- `buildFailureResult`
- `attachResolvedUrlContext`

无论前面哪条路径命中，最终都会归一化为统一结构：

```json
{
  "success": true,
  "platform": "818ps",
  "imageUrl": "...",
  "imageUrls": ["..."],
  "images": ["..."],
  "pages": [
    { "page": 1, "imageUrl": "..." }
  ],
  "pageCount": 1,
  "isMultiPage": false,
  "source": "..."
}
```

还会补充：

- `originalUrl`
- `resolvedUrl`
- `metadata`

其中 `metadata` 常见包含：

- `totalFound`
- `afterFilter`
- `afterDedup`
- `expectedPageCount`
- `results`

## 16. 旧版兜底链路

虽然现在主逻辑已经迁到 `server/extractors/818ps.js`，但 `server/imageExtractor.js` 的 `extract818psImage(url)` 仍然保留了旧版回退逻辑。

它的顺序是：

1. 调新版 `extract818ps`
2. 失败时直接从 `picId/upicId` 拼接传统静态 URL
3. 再做一次网页静态扫描
4. 再尝试第三方服务兜底
5. 最后调用 `server/services/browser.js` 里的 `scrape818ps(url)`

### 16.1 为什么保留旧版

因为某些极端情况下，新版可能因为页面结构变化失效，而旧版 still useful：

- 直接拼接 URL 有时仍然能命中
- 老的 Puppeteer 逻辑偏向“截图和强行去水印”，在少数反常页面上还能救场

### 16.2 `scrape818ps(url)` 的特点

旧版浏览器兜底更偏“页面可视结果恢复”，而不是结构化资源提取：

- 会注入样式移除水印元素
- 会按关键词删除 DOM 中的图怪兽品牌层
- 会尝试清理文字水印、角落水印、高 z-index 覆盖层

所以它更像“兜底可视抓取”而不是主提取算法。

## 17. 维护时最需要关注的点

### 17.1 分享 API 结构是否变化

如果 `share-template`、`team-share-get-templ` 等接口字段变化，优先检查：

- `extractShareApiPreviewGroups`
- `extractExpectedPageCountFromShareApiPayloads`

### 17.2 页面里“第N页”标记是否变化

如果动态多页突然失效，优先检查：

- `captureDynamicSnapshot`
- `activateDynamicPage`
- `scrollDynamicPage`

### 17.3 资源路径是否换了

如果页面还能打开但图片拿不到，优先检查：

- 新的 CDN 域名
- 新的预览图路径前缀
- 新的图片后缀处理方式

### 17.4 无关素材是否混入过多

如果返回了很多素材图、贴纸、图标而不是主设计图，优先调整：

- `BLOCKED_IMAGE_KEYWORDS`
- `isRelevantDynamicImage`
- `isDesignPageCandidate`
- `scoreDynamicImage`

## 18. 调试建议

### 18.1 跑优化版提取器

```bash
cd server
node test-818ps-optimized.js "https://818ps.com/..."
```

### 18.2 跑统一提取测试

```bash
cd server
node test-extractors.js 818ps "https://818ps.com/..."
```

### 18.3 重点看日志中的 source

如果想判断当前命中了哪条链路，最重要的是看最终返回的 `source`，例如：

- `share_api_share_template`
- `share_api_team_share_get_templ`
- `user_path_priority`
- `static_group_xxx`
- `static_multi_page_extraction`
- `static_best_candidate`
- `dynamic_page_activation`
- `dynamic_structured_browser.json`
- `dynamic_multi_page_extraction`
- `dynamic_json_extraction`

## 19. 一句话总结

当前图怪兽提取器的核心思路不是“只靠一种方式抓图”，而是按成本和命中率分层：

```text
分享 API -> 已知路径直连 -> 静态 HTML -> 动态浏览器分页激活 -> 旧版兜底
```

真正让它稳定工作的关键是三件事：

- 先用结构化数据拿多页预览
- 再用动态分页激活补全每一页主图
- 最后用严格的过滤、打分和 URL 验证把噪音压掉
