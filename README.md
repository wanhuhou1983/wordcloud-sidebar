# WordCloud Sidebar

在 Obsidian 右侧边栏自动生成当前笔记的词云图。支持深色模式、配色方案自定义、切换笔记自动更新。

---

## 功能特性

- 📊 **自动生成** — 打开任意笔记，词云自动渲染，无需手动操作
- 🔄 **切换更新** — 切换笔记时词云同步更新（带 300ms 防抖）
- 🌙 **深色模式适配** — 自动检测 Obsidian 主题，切换背景色与配色方案
- 🎨 **8 种配色方案** — Viridis / Plasma / Inferno / Magma / Blues / Greens / Reds / Set1
- ⚙️ **完全可配置** — 服务地址、背景色、配色方案、词频数量均可设置
- 🔒 **安全** — 所有 DOM 操作使用原生 API，无 XSS 风险

---

## 安装

### 前置依赖：Python 词云服务

本插件依赖本地运行的 Python HTTP 服务。

```bash
# 1. 安装 Python 依赖
pip install wordcloud jieba matplotlib

# 2. 下载词云服务脚本
#    服务脚本位于 WorkBuddy skills 目录：
#    C:\Users\linhu\.workbuddy\skills\wordcloud-freq\scripts\wordcloud_server.py
#    或运行命令获取：pip install wordcloud-freq-skill（如果可用）

# 3. 启动服务（默认端口 8766）
python wordcloud_server.py
```

> **提示**：可使用 Windows 任务计划程序或系统自启工具将服务设为开机启动。

### 安装插件

**方式一：社区插件市场（推荐）**
1. Obsidian 设置 → 社区插件 → 开启社区插件
2. 搜索 `WordCloud Sidebar`，安装并启用

**方式二：BRAT（开发者/测试版）**
1. 安装 BRAT 插件
2. 在 BRAT 设置中添加：`https://github.com/wanhuhou1983/wordcloud-sidebar`
3. 启用 WordCloud Sidebar

**方式三：手动安装**
1. 克隆仓库到本地
2. 将插件文件夹复制到 Vault 的 `.obsidian/plugins/` 目录
3. Obsidian 设置 → 社区插件 → 启用 WordCloud Sidebar

---

## 配置

Obsidian 设置 → 插件选项 → WordCloud Sidebar

| 选项 | 说明 | 默认值 |
|------|------|--------|
| 词云服务地址 | HTTP 服务 URL | `http://127.0.0.1:8766` |
| 背景颜色 | 词云图片背景色 | `white` |
| 配色方案 | 颜色映射方案 | `viridis` |
| 词频数量 Top N | 显示高频词数量上限 | `80` |

---

## 使用方式

1. **确保词云服务已启动**（见上方「前置依赖」）
2. 点击 Obsidian 左侧边栏的 ☁️ 云朵图标，打开词云侧边栏
3. 打开任意笔记，词云自动生成
4. 点击 🔄 按钮可手动重新生成

---

## 故障排除

### 词云服务未启动

侧边栏显示「词云服务未启动」。请确认：

```bash
# 检查服务是否在运行
curl http://127.0.0.1:8766/

# 服务正常时应返回 HTML 页面
```

### 笔记内容太少

词云需要至少 10 个有效字符。请确保当前笔记有足够文本。

### 请求超时

大型笔记（超过 5 万字）会自动截断。若仍超时，请检查 Python 服务是否正常运行。

---

## 技术栈

- **前端**：Obsidian Plugin API（原生 JavaScript）
- **后端**：Python Flask + wordcloud + jieba + matplotlib
- **通信**：HTTP POST + Base64 图片传输

---

## 版本历史

见 [CHANGELOG.md](./CHANGELOG.md)

---

## 许可证

MIT
