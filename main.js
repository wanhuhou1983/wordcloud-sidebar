/* ============================================================================
 * WordCloud Sidebar - Obsidian 插件
 * 右侧边栏词云生成器 (重构优化版)
 * ============================================================================ */
var obsidian = require('obsidian');

const VIEW_TYPE_WORDCLOUD = 'wordcloud-sidebar-view';
const SERVER_URL = 'http://127.0.0.1:8766';
const SERVER_WORDCLOUD_ENDPOINT = `${SERVER_URL}/wordcloud/base64`;

/* ---------------------------------------------------------------------------
 * 词云侧边栏视图
 * --------------------------------------------------------------------------- */
class WordCloudSidebarView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.container = null;
        this.status = 'idle'; // idle | loading | success | error | server-offline
        this.isGenerating = false; // 防抖锁：防止快速切换笔记时重复请求
    }

    /* 视图类型 */
    getViewType() {
        return VIEW_TYPE_WORDCLOUD;
    }

    /* 视图图标 */
    getIcon() {
        return 'cloud';
    }

    /* 视图标题 */
    getDisplayText() {
        return '词云';
    }

    /* DOM 渲染 */
    async onOpen() {
        this.container = this.containerEl;
        this.render();

        // 注册事件：当用户在工作区切换当前笔记时，自动重新生成词云
        this.registerEvent(
            this.plugin.app.workspace.on('file-open', (file) => {
                // 如果有新文件打开，并且服务器之前不是宕机状态，就自动触发
                if (file && this.status !== 'server-offline') {
                    this.generate();
                }
            })
        );
    }

    render() {
        this.container.empty();

        /* 整体容器 */
        const wrapper = document.createElement('div');
        wrapper.className = 'wordcloud-sidebar-wrapper';
        this.container.appendChild(wrapper);

        /* 头部 */
        const header = document.createElement('div');
        header.className = 'wordcloud-header';
        header.innerHTML = `
            <span class="wordcloud-title">📊 词云</span>
            <button class="wordcloud-reload-btn" title="重新生成">
                <span>🔄</span>
            </button>
        `;
        wrapper.appendChild(header);

        /* 内容区 */
        const content = document.createElement('div');
        content.className = 'wordcloud-content';
        wrapper.appendChild(content);

        /* 状态渲染 */
        this.refreshContent(content);

        /* 重新生成按钮 (使用规范的 registerDomEvent 防止内存泄漏) */
        const reloadBtn = header.querySelector('.wordcloud-reload-btn');
        this.registerDomEvent(reloadBtn, 'click', () => {
            this.generate();
        });
    }

    refreshContent(content) {
        content.empty();

        if (this.status === 'loading') {
            content.innerHTML = `
                <div class="wordcloud-state wordcloud-loading">
                    <div class="wordcloud-spinner"></div>
                    <p>正在生成词云…</p>
                </div>
            `;
        } else if (this.status === 'idle') {
            content.innerHTML = `
                <div class="wordcloud-state wordcloud-idle">
                    <div class="wordcloud-icon-large">☁️</div>
                    <p>打开笔记，自动生成词云</p>
                </div>
            `;
        } else if (this.status === 'success') {
            const img = document.createElement('img');
            img.src = this.imageDataUrl;
            img.className = 'wordcloud-image';
            img.alt = '词云';
            img.draggable = false;
            content.appendChild(img);
        } else if (this.status === 'error') {
            content.innerHTML = `
                <div class="wordcloud-state wordcloud-error">
                    <div class="wordcloud-icon-large">⚠️</div>
                    <p class="error-message">${this.errorMessage || '生成失败'}</p>
                </div>
            `;
        } else if (this.status === 'server-offline') {
            content.innerHTML = `
                <div class="wordcloud-state wordcloud-server-offline">
                    <div class="wordcloud-icon-large">🖥️</div>
                    <p>词云服务未启动</p>
                    <p class="sub-text">请先运行 Python 服务：</p>
                    <code class="cmd-code">python "C:\\Users\\linhu\\.workbuddy\\skills\\wordcloud-freq\\scripts\\wordcloud_server.py"</code>
                    <button class="retry-btn">重试连接</button>
                </div>
            `;
            // 因为这段 DOM 是动态重写的，之前的监听器会被自然回收，所以用 addEventListener 是安全的
            content.querySelector('.retry-btn').addEventListener('click', () => {
                this.generate();
            });
        }
    }

    async generate() {
        // 【防抖保护】如果正在生成中，直接丢弃新请求，防止卡顿
        if (this.isGenerating) return; 
        
        /* 1. 获取当前笔记内容 */
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            this.status = 'idle'; // 如果全关了，回到闲置状态比较好
            this.refreshContent(this.container.querySelector('.wordcloud-content'));
            return;
        }

        this.isGenerating = true; // 上锁

        try {
            let text;
            try {
                text = await this.plugin.app.vault.read(activeFile);
            } catch (e) {
                throw new Error(`读取笔记失败: ${e.message}`);
            }

            if (!text || text.trim().length < 10) {
                throw new Error('笔记内容太少（至少10个字符）');
            }

            /* 2. 显示 loading */
            this.status = 'loading';
            const content = this.container.querySelector('.wordcloud-content');
            if (content) this.refreshContent(content);

            /* 3. 调用词云服务 */
            const response = await obsidian.requestUrl({
                url: SERVER_WORDCLOUD_ENDPOINT,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    width: 700,
                    height: 500,
                    background_color: 'white',
                    top_n: 80,
                    colormap: 'viridis'
                }),
                throw: true
            });

            const data = JSON.parse(response.text);

            if (!data.success || !data.image) {
                throw new Error(data.error || '服务返回数据格式错误');
            }

            this.status = 'success';
            this.imageDataUrl = data.image;
            if (content) this.refreshContent(content);

        } catch (err) {
            const errMsg = err.message || String(err);
            console.error('[WordCloud] 请求失败:', errMsg);
            
            if (errMsg.includes('ECONNREFUSED') || errMsg.includes('net::') || errMsg.includes('ERR_CONNECTION')) {
                this.status = 'server-offline';
                this.errorMessage = '';
            } else {
                this.status = 'error';
                this.errorMessage = errMsg;
            }
            
            const c = this.container.querySelector('.wordcloud-content');
            if (c) this.refreshContent(c);
        } finally {
            // 【防抖保护】请求结束，无论成功失败都解锁
            this.isGenerating = false; 
        }
    }

    async onClose() {
        this.container = null;
    }
}

/* ---------------------------------------------------------------------------
 * 插件主体
 * --------------------------------------------------------------------------- */
class WordCloudSidebarPlugin extends obsidian.Plugin {
    
    async onload() {
        console.log('[WordCloud Sidebar] 插件加载中…');

        /* 注册视图类型 */
        this.registerView(
            VIEW_TYPE_WORDCLOUD,
            (leaf) => new WordCloudSidebarView(leaf, this)
        );

        /* 添加右侧边栏 ribbon 图标：负责展开/折叠面板 */
        this.addRibbonIcon('cloud', '词云侧边栏', async (evt) => {
            await this.toggleSidebar();
        });

        /* 添加命令：生成当前笔记词云 */
        this.addCommand({
            id: 'generate-wordcloud',
            name: '生成当前笔记词云',
            hotkeys: [],
            callback: async () => {
                await this.activateView();
            }
        });

        console.log('[WordCloud Sidebar] 插件加载完成');
    }

    /* 规范的展开/收起侧边栏逻辑 (依赖 Obsidian 原生 API 而非自建 state) */
    async toggleSidebar() {
        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_WORDCLOUD);
        
        if (leaves.length > 0) {
            // 如果已经打开了，就关闭它
            leaves.forEach(leaf => leaf.detach());
        } else {
            // 如果没打开，就激活并展示
            await this.activateView();
        }
    }

    /* 激活视图并触发生成 */
    async activateView() {
        const { workspace } = this.app;
        let leaf;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_WORDCLOUD);
        
        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({
                type: VIEW_TYPE_WORDCLOUD,
                active: true,
            });
        }
        
        workspace.revealLeaf(leaf);
        
        // 如果视图存在，直接触发一次生成
        if (leaf.view instanceof WordCloudSidebarView) {
            leaf.view.generate();
        }
    }

    onunload() {
        console.log('[WordCloud Sidebar] 插件卸载');
        // 插件卸载时，优雅地清理掉相关的面板
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_WORDCLOUD);
    }
}

/* 暴露给 Obsidian 的插件加载器 */
window.WordCloudSidebarPlugin = WordCloudSidebarPlugin;
module.exports = WordCloudSidebarPlugin;
