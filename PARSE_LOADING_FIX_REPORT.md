# 解析按钮加载状态与防重复请求修复

本轮只修改前端解析交互及相应浏览器测试。实际目录：`E:\watermark\watermark`。

## 1. 修改文件

- `client/src/App.vue`：同步解析锁、按钮禁用与指定文案、CSS 圆环、减少动态效果适配、提取超时、统一 finally 释放。
- `client/src/store/index.js`：移除历史查询与保存动作对解析 loading 的独立开关；保存请求超时和错误响应校验；保留历史查询期间新增的已保存记录。
- `server/test-parse-loading-ui.py`：使用现有 Python Playwright 环境测试真实 Vue 页面；接口均为本地模拟，无新依赖。
- 本文：记录执行链路、状态归属和验收结果。

## 2. 加载状态

复用已有 `store.state.loading`（初始 false），App 的 computed loading 同时驱动禁用、文字、圆环和 aria-busy。没有引入第二套解析加载变量。

原问题是 `/api/extract-image` 在 App 中通过 fetch 调用，loading 却只在 Vuex 保存 `/api/parse` 时开启；fetchHistory 也会设置和清除同一个状态。现在唯一持有者是 App.handleParse。

## 3. 防重复机制

handleParse 最先检查 loading；空输入立即提示返回。其余输入在首个异步操作前同步 commit SET_LOADING=true。快速连续直接调用该函数也被拦截，不依赖 DOM 更新或按钮 disabled。按钮显式使用 native-type=button，不触发表单默认提交。

实际页面没有 form、Enter 提交或额外快捷键解析入口；textarea 的 Enter 保持原有换行行为。所有已有解析触发均进入同一受锁保护的 handleParse。

## 4. 生命周期范围

URL 规范化/校验 → `/api/extract-image` → JSON、GIF、多页与资源状态处理 → Vuex.parseUrl 请求 `/api/parse` → ADD_RECORD 更新历史 → 清理成功输入 → finally 解锁。

页面挂载时的 GET /api/history 独立运行，不修改解析锁。若它晚于本次保存完成，合并期间新增记录，防止旧响应覆盖刚保存的结果。本次没有额外加入必须等待的历史刷新请求，也没有新增成功弹窗或改变现有预览打开方式。

## 5. 视觉状态

绿色按钮保留现有尺寸、圆角和布局；禁用时适度加深绿色、保持白字，cursor=wait。加载文案为“解析中，请稍候…”，正常文案为“解析链接”。

15px 圆环使用 2px 半透明边框及白色顶部边框，extract-spin keyframes 每 0.7 秒线性旋转。内容水平居中，8px 间距，按钮 min-width=0 避免长文案扩大 flex 最小宽度。prefers-reduced-motion: reduce 时停止旋转，继续保留文字与禁用。

## 6. 恢复与失败处理

最外层 finally 在成功、失败、异常和业务提前返回时统一清除 loading。提取请求使用 AbortController，120 秒上限，包含读取响应 JSON 的过程，结束后清理定时器；保存 Axios 请求上限 30 秒。保存业务失败或异常数据不会被误当成功并清空输入。

失败保留输入与此前成功记录，通过现有 SET_ERROR/el-alert 提示；不把旧结果当作本次成功。原有其他平台占位降级分支保持原行为。本地上传仍用自己的 uploading，不受解析锁控制。

## 7. 实际测试与构建

最终专项浏览器检查：**17 个场景组通过，失败 0**。覆盖立即禁用/旋转、首次调用后同步重复 20 次、额外鼠标/键盘及直接调用、提取/保存阶段只各发一个请求、历史完成不解锁、保存成功、HTTP/网络/JSON 失败、真实 AbortController 超时（只加速测试计时器）、保存业务/HTTP/异常对象及数组失败、空/非法输入、恢复后重试、桌面/375px 移动端宽度、减少动态效果、GIF 实际动画/两页预览、教程/本地上传入口/历史搜索、无图片业务提前返回、晚到历史不覆盖新记录。页面未发现运行时错误。

既有 `test-818ps-ui.py`：**11 项场景检查通过，失败 0**，包含真实动画展示、字节保持下载、下载 GIF 重解析、资源状态与历史元数据保存、旧历史和缺页提示。

Vuex 模块语法检查、git diff --check 和 `npm --prefix client run build` 均通过。构建仍有既有 Vite CJS 弃用及大包体积提示。本轮不更改后端提取算法、数据库或接口字段；测试使用模拟 API，未重新执行各平台真实联网提取。测试浏览器和测试 Vite 进程已清理。

复现命令：

```powershell
cd E:\watermark\watermark
npm --prefix client run build
python C:/Users/阿达/.codex/skills/webapp-testing/scripts/with_server.py --server "npm --prefix client run dev -- --host 127.0.0.1 --port 5179" --port 5179 -- python server/test-parse-loading-ui.py
```

加载画面保存在 gitignore 排除的 `server/test-artifacts/parse-loading-desktop.png` 和 `parse-loading-mobile.png`。

前端超时只终止浏览器请求；服务端原有抓取时间上限继续负责结束已启动的后台提取。本轮没有增加后端取消协议。
