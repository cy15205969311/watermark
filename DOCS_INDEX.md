# 文档索引

## 核心文档

### 项目概览
- [README.md](README.md)：项目总览、环境配置、接口说明、平台能力、联调与排障入口，作为默认开发入口文档。
- [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md)：当前仓库的真实目录结构、模块职责、浏览器服务与提取链路分层说明，适合新成员快速建立代码认知。

### 桌面应用
- [DESKTOP_1.2.0_STORAGE_REPORT.md](DESKTOP_1.2.0_STORAGE_REPORT.md)：安装目录 personal、SID 隔离、安全迁移、Bug 反馈与本轮候选包验收。
- [DESKTOP_1.2.0_REPORT.md](DESKTOP_1.2.0_REPORT.md)：1.2.0 未签名候选、构建测试与真实安装待验收项。
- [DESKTOP_1.2.0_BACKUP_TESTS.md](DESKTOP_1.2.0_BACKUP_TESTS.md)：备份一致性、恢复回滚、取消及诊断专项。
- [DESKTOP_1.2.0_DOWNLOADS_REPORT.md](DESKTOP_1.2.0_DOWNLOADS_REPORT.md)：历史迭代的 Downloads 测试；其 AppData 回退策略已被本轮 personal 存储改造替代。
- [DESKTOP_GUIDE.md](DESKTOP_GUIDE.md)：Windows 个人版安装、开发、打包、双数据库隔离、数据备份与排障指南。

### 平台提取逻辑
- [PLATFORM_EXTRACTION_LOGIC_FOR_PYTHON.md](PLATFORM_EXTRACTION_LOGIC_FOR_PYTHON.md)：图怪兽 / 创客贴 / 稿定设计 / 花瓣网四个平台提取链路的总览文档，重点覆盖真实调用链、候选图筛选、多页识别、结果归一化和 Python 迁移建议。
- [818PS_EXTRACTION_LOGIC.md](818PS_EXTRACTION_LOGIC.md)：818ps / 图怪兽提取链路的完整实现说明，覆盖 API 入口、分享接口、静态抓取、动态分页激活、结果归一化和旧版兜底。
