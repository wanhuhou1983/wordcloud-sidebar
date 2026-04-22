# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.4] - 2026-04-22

### Fixed
- **debounce + lock 语义冲突**：引入 `_currentTargetPath` 追踪目标文件，请求完成后检查是否已切换笔记，若已切换则丢弃结果并重新触发生成
- **onOpen 直接调用 generate()**：统一改为 `_debouncedGenerate()`，与 file-open 事件处理逻辑一致，消除竞争
- **loading/idle 状态 innerHTML 不一致**：全部改用 `createDiv({ cls: [...] })` DOM API
- **data.json 空文件残留**：已删除（Obsidian 会自动创建）
- **README.md 缺失**：新增完整说明文档（安装/配置/故障排除）
- **CHANGELOG.md 缺失**：新增

## [1.1.3] - 2026-04-22

### Fixed
- **`createEl`/`createDiv` class 参数格式**：全部改用 `{ cls: '...' }` / `{ cls: [...] }` 标准 options 对象
- **`container` null TypeError**：3 处 `this.container.querySelector` 全部加 `?.` 可选链
- **长笔记无截断**：新增 `MAX_TEXT_LENGTH = 50000`，超出自动截断
- **file-open 快速切换请求堆积**：`obsidian.debounce(..., 300, true)` 冷静期防抖
- **CSS `.wordcloud-settings-dep` 缺少对齐**：增加 `align-items: flex-start`

## [1.1.2] - 2026-04-22

### Fixed
- **retry-btn 监听器泄漏**：DOM 销毁后 `removeEventListener` 无效，改为 `registerDomEvent` 由 Obsidian 自动清理
- **file-open + activateView 双重触发**：移除 `activateView()` 中的显式 `generate()` 调用
- **toggleSidebar 未 await**：改为 `for...of await` 顺序等待完成
- **errorMessage XSS 隐患**：全部改用 `createEl().textContent`，消除 innerHTML 注入风险
- **endpoint getter 死代码**：已删除
- **settingEl.style 内联样式**：移入 CSS class `.wordcloud-settings-dep`
- **深色模式 fallback 缺失**：`_detectTheme()` 新增 `window.matchMedia` 系统跟随 fallback

## [1.1.1] - 2026-04-22

### Fixed
- **硬编码个人路径** `C:\Users\linhu\...`：`manifest.json` 同步至 1.0.1
- **硬编码个人路径泄露**：改为通用安装命令提示
- **retry-btn 裸 addEventListener**：`onClose` 中清理监听器
- **`manifest.json` 无效 `styles` 字段**：已删除
- **data.json 空占位文件**：已删除
- **超时错误未归类为 server-offline**：增加 `timeout`/`AbortError` 关键词匹配
- **深色模式词云不适配**：新增 `_detectTheme()` 检测主题
- **服务地址硬编码**：新增 `WordCloudSidebarSettingTab` 设置页

## [1.1.0] - 2026-04-22

### Added
- `isGenerating` 防抖锁：防止快速切换笔记时重复请求后端
- `file-open` 事件监听：切换笔记时自动重新生成词云
- `registerEvent` + `registerDomEvent`：规范事件注册，插件卸载时自动清理
- `workspace.detachLeavesOfType`：卸载时干净销毁视图
- `workspace.getLeavesOfType`：用原生 API 判断视图状态

## [1.0.2] - 2026-04-14

### Fixed
- GitHub Release 同步

## [1.0.1] - 2026-04-12

### Added
- 初始版本：WordCloud Sidebar 插件基础功能
- Ribbon 图标触发右侧边栏
- 读取当前笔记文本调用本地词云服务
- 8 种配色方案
- 深色模式基础适配
