/* ============================================================================
 * WordCloud Sidebar - Obsidian 插件
 * 右侧边栏词云生成器
 * ============================================================================ */

const VIEW_TYPE_WORDCLOUD = 'wordcloud-sidebar-view';
const SERVER_URL = 'http://127.0.0.1:8766';
const SERVER_WORDCLOUD_ENDPOINT = `${SERVER_URL}/wordcloud/base64`;

/* ---------------------------------------------------------------------------
 * 词云侧边栏视图
 * --------------------------------------------------------------------------- */
class WordCloudSidebarView {
    constructor(leaf, plugin) {
        this.leaf = leaf;
        this.plugin = plugin;
        this.container = null;
        this.status = 'idle'; // idle | loading | success | error | server-offline
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
        this.container = this.leaf.containerEl;
        this.render();
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

        /* 重新生成按钮 */
        header.querySelector('.wordcloud-reload-btn').addEventListener('click', () => {
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
                    <p>点击右上角图标<br>生成当前笔记词云</p>
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
            content.querySelector('.retry-btn').addEventListener('click', () => {
                this.generate();
            });
        }
    }

    async generate() {
        /* 1. 获取当前笔记内容 */
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            this.status = 'error';
            this.errorMessage = '未打开任何笔记';
            this.refreshContent(this.container.querySelector('.wordcloud-content'));
            return;
        }

        let text;
        try {
            text = await this.plugin.app.vault.read(activeFile);
        } catch (e) {
            this.status = 'error';
            this.errorMessage = `读取笔记失败: ${e.message}`;
            this.refreshContent(this.container.querySelector('.wordcloud-content'));
            return;
        }

        if (!text || text.trim().length < 10) {
            this.status = 'error';
            this.errorMessage = '笔记内容太少（至少10个字符）';
            this.refreshContent(this.container.querySelector('.wordcloud-content'));
            return;
        }

        /* 2. 显示 loading */
        this.status = 'loading';
        const content = this.container.querySelector('.wordcloud-content');
        if (content) this.refreshContent(content);

        /* 3. 调用词云服务 */
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000); // 30s 超时

            const response = await fetch(SERVER_WORDCLOUD_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    width: 700,
                    height: 500,
                    background_color: 'white',
                    top_n: 80,
                    colormap: 'viridis'
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                let errMsg = `HTTP ${response.status}`;
                try {
                    const errData = await response.json();
                    errMsg = errData.error || errMsg;
                } catch (_) {}
                throw new Error(errMsg);
            }

            const data = await response.json();

            if (!data.success || !data.image) {
                throw new Error(data.error || '服务返回数据格式错误');
            }

            this.status = 'success';
            this.imageDataUrl = data.image;
            if (content) this.refreshContent(content);

        } catch (err) {
            if (err.name === 'AbortError') {
                this.status = 'error';
                this.errorMessage = '请求超时（30秒）';
            } else if (err.message.includes('fetch') || err.message.includes('ERR_CONNECTION_REFUSED') || err.message.includes('NetworkError')) {
                this.status = 'server-offline';
                this.errorMessage = '';
            } else {
                this.status = 'error';
                this.errorMessage = err.message;
            }
            const c = this.container.querySelector('.wordcloud-content');
            if (c) this.refreshContent(c);
        }
    }

    async onClose() {
        this.container = null;
    }
}

/* ---------------------------------------------------------------------------
 * 插件主体
 * --------------------------------------------------------------------------- */
class WordCloudSidebarPlugin extends Plugin {
    view = null;
    state = 'collapsed'; // collapsed | expanded

    async onload() {
        console.log('[WordCloud Sidebar] 插件加载中…');

        /* 注册视图类型 */
        this.registerView(
            VIEW_TYPE_WORDCLOUD,
            (leaf) => (this.view = new WordCloudSidebarView(leaf, this))
        );

        /* 添加右侧边栏 ribbon 图标 */
        this.addRibbonIcon('cloud', '生成词云', async (evt) => {
            await this.toggleSidebar();
        });

        /* 添加命令：生成当前笔记词云 */
        this.addCommand({
            id: 'generate-wordcloud',
            name: '生成当前笔记词云',
            hotkeys: [],
            callback: async () => {
                await this.ensureSidebarOpen();
                if (this.view) {
                    await this.view.generate();
                }
            }
        });

        console.log('[WordCloud Sidebar] 插件加载完成');
    }

    /* 展开/收起侧边栏 */
    async toggleSidebar() {
        if (this.state === 'collapsed') {
            await this.ensureSidebarOpen();
            if (this.view) {
                await this.view.generate();
            }
        } else {
            await this.closeSidebar();
        }
    }

    async ensureSidebarOpen() {
        if (this.state === 'expanded' && this.view) {
            /* 已展开，则刷新 */
            return;
        }
        /* 右侧工作区 */
        const leaf = this.app.workspace.getRightLeaf(false);
        await leaf.setViewState({
            type: VIEW_TYPE_WORDCLOUD,
            active: true,
        });
        this.app.workspace.rightRevealInParent();
        this.state = 'expanded';
    }

    async closeSidebar() {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WORDCLOUD);
        for (const leaf of leaves) {
            await leaf.detach();
        }
        this.view = null;
        this.state = 'collapsed';
    }

    onunload() {
        console.log('[WordCloud Sidebar] 插件卸载');
        this.closeSidebar();
    }
}

module.exports = WordCloudSidebarPlugin;
