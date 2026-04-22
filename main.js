/* ============================================================================
 * WordCloud Sidebar - Obsidian 插件
 * 右侧边栏词云生成器 (v1.1.1 - 修复版)
 * ============================================================================ */
var obsidian = require('obsidian');

const VIEW_TYPE_WORDCLOUD = 'wordcloud-sidebar-view';
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8766';
const VIEW_TIMEOUT_MS = 20000; // 20s 请求超时

/* ---------------------------------------------------------------------------
 * 设置选项卡
 * --------------------------------------------------------------------------- */
class WordCloudSidebarSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.setAttribute('aria-label', '词云设置');

        new obsidian.Setting(containerEl)
            .setName('词云服务地址')
            .setDesc('HTTP 服务地址，端口默认 8766')
            .addText(text => text
                .setPlaceholder(DEFAULT_SERVER_URL)
                .setValue(this.plugin.settings.serverUrl || DEFAULT_SERVER_URL)
                .onChange(async (value) => {
                    this.plugin.settings.serverUrl = value.trim() || DEFAULT_SERVER_URL;
                    await this.plugin.saveSettings();
                })
            );

        new obsidian.Setting(containerEl)
            .setName('背景颜色')
            .setDesc('词云图片背景色，支持英文颜色名或 #RRGGBB')
            .addText(text => text
                .setPlaceholder('white')
                .setValue(this.plugin.settings.backgroundColor || 'white')
                .onChange(async (value) => {
                    this.plugin.settings.backgroundColor = value.trim() || 'white';
                    await this.plugin.saveSettings();
                })
            );

        new obsidian.Setting(containerEl)
            .setName('词云配色方案')
            .setDesc('颜色映射方案名称')
            .addDropdown(dropdown => dropdown
                .addOptions({
                    'viridis': 'Viridis（紫→绿）',
                    'plasma': 'Plasma（蓝→粉）',
                    'inferno': 'Inferno（黑→黄）',
                    'magma': 'Magma（黑→粉）',
                    'Blues': 'Blues（深蓝）',
                    'Greens': 'Greens（绿色）',
                    'Reds': 'Reds（红色）',
                    'Set1': 'Set1（多彩）',
                })
                .setValue(this.plugin.settings.colormap || 'viridis')
                .onChange(async (value) => {
                    this.plugin.settings.colormap = value;
                    await this.plugin.saveSettings();
                })
            );

        new obsidian.Setting(containerEl)
            .setName('词频数量 Top N')
            .setDesc('显示高频词的数量上限')
            .addSlider(slider => slider
                .setLimits(20, 150, 10)
                .setValue(this.plugin.settings.topN || 80)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.topN = value;
                    await this.plugin.saveSettings();
                })
            );

        new obsidian.Setting(containerEl)
            .setName('词云服务依赖')
            .setDesc('需要先安装并启动 wordcloud-freq 服务')
            .settingEl.style.flexDirection = 'column';
        const infoEl = containerEl.createEl('div', {
            cls: 'wordcloud-settings-info',
            text: '安装方式：pip install wordcloud jieba matplotlib\n'
                + '启动服务：python wordcloud_server.py\n'
                + '服务地址：http://127.0.0.1:8766'
        });
        infoEl.style.cssText = 'font-size:12px;color:var(--text-muted);line-height:1.6;padding:8px;'
            + 'background:var(--background-secondary);border-radius:4px;margin-top:4px;';
    }
}

/* ---------------------------------------------------------------------------
 * 词云侧边栏视图
 * --------------------------------------------------------------------------- */
class WordCloudSidebarView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.container = null;
        this.status = 'idle'; // idle | loading | success | error | server-offline
        this.isGenerating = false; // 防抖锁
    }

    getViewType() { return VIEW_TYPE_WORDCLOUD; }
    getIcon() { return 'cloud'; }
    getDisplayText() { return '词云'; }

    async onOpen() {
        this.container = this.containerEl;
        this.render();

        // 切换笔记时自动重新生成词云
        this.registerEvent(
            this.plugin.app.workspace.on('file-open', (file) => {
                if (file && this.status !== 'server-offline') {
                    this.generate();
                }
            })
        );
    }

    render() {
        this.container.empty();

        const wrapper = document.createElement('div');
        wrapper.className = 'wordcloud-sidebar-wrapper';
        this.container.appendChild(wrapper);

        const header = document.createElement('div');
        header.className = 'wordcloud-header';
        header.innerHTML = `
            <span class="wordcloud-title">📊 词云</span>
            <button class="wordcloud-reload-btn" title="重新生成"><span>🔄</span></button>
        `;
        wrapper.appendChild(header);

        const content = document.createElement('div');
        content.className = 'wordcloud-content';
        wrapper.appendChild(content);

        this.refreshContent(content);

        // reloadBtn 使用 registerDomEvent（自动生命周期管理）
        const reloadBtn = header.querySelector('.wordcloud-reload-btn');
        this.registerDomEvent(reloadBtn, 'click', () => this.generate());
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
                    <p class="sub-text">请先安装并启动服务：</p>
                    <div class="cmd-block">
                        <div class="cmd-line">pip install wordcloud jieba matplotlib</div>
                        <div class="cmd-line">python wordcloud_server.py</div>
                    </div>
                    <button class="retry-btn">重试连接</button>
                </div>
            `;
            // retry-btn 用延迟绑定（DOM 由 innerHTML 动态生成，render() 的 registerDomEvent 管不到这里）
            this._retryBtnHandler = () => this.generate();
            content.querySelector('.retry-btn').addEventListener('click', this._retryBtnHandler);
        }
    }

    /** 检测 Obsidian 深色模式，返回 { bg, colormap } */
    _detectTheme() {
        const isDark = document.body.classList.contains('theme-dark');
        const settings = this.plugin.settings;
        if (settings.backgroundColor) {
            // 用户在设置页自定义了背景色，优先用用户配置
            return { bg: settings.backgroundColor, colormap: settings.colormap || 'viridis' };
        }
        return isDark
            ? { bg: '#1e1e1e', colormap: 'plasma' }
            : { bg: 'white', colormap: 'viridis' };
    }

    async generate() {
        if (this.isGenerating) return;

        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            this.status = 'idle';
            const c = this.container.querySelector('.wordcloud-content');
            if (c) this.refreshContent(c);
            return;
        }

        this.isGenerating = true;

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

            this.status = 'loading';
            const content = this.container.querySelector('.wordcloud-content');
            if (content) this.refreshContent(content);

            // 深色模式适配
            const { bg, colormap } = this._detectTheme();
            const serverUrl = this.plugin.settings.serverUrl || DEFAULT_SERVER_URL;
            const topN = this.plugin.settings.topN || 80;

            // 使用 Obsidian requestUrl，超时由 timeout 参数控制
            const response = await obsidian.requestUrl({
                url: `${serverUrl}/wordcloud/base64`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    width: 700,
                    height: 500,
                    background_color: bg,
                    top_n: topN,
                    colormap: colormap
                }),
                timeout: VIEW_TIMEOUT_MS,
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

            // ECONNREFUSED / net::ERR* / timeout / AbortError 均归类为服务离线
            if (errMsg.includes('ECONNREFUSED')
                || errMsg.includes('net::')
                || errMsg.includes('timeout')
                || errMsg.includes('AbortError')
                || errMsg.includes('ERR_CONNECTION')) {
                this.status = 'server-offline';
                this.errorMessage = '';
            } else {
                this.status = 'error';
                this.errorMessage = errMsg;
            }

            const c = this.container.querySelector('.wordcloud-content');
            if (c) this.refreshContent(c);
        } finally {
            this.isGenerating = false;
        }
    }

    onClose() {
        // 清理动态绑定的 retry-btn 监听器
        if (this._retryBtnHandler) {
            const btn = this.container?.querySelector?.('.retry-btn');
            if (btn) btn.removeEventListener('click', this._retryBtnHandler);
            this._retryBtnHandler = null;
        }
        this.container = null;
    }
}

/* ---------------------------------------------------------------------------
 * 插件主体
 * --------------------------------------------------------------------------- */
class WordCloudSidebarPlugin extends obsidian.Plugin {

    get endpoint() {
        return `${this.settings.serverUrl || DEFAULT_SERVER_URL}/wordcloud/base64`;
    }

    async onload() {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_WORDCLOUD,
            (leaf) => new WordCloudSidebarView(leaf, this)
        );

        // Ribbon 图标
        this.addRibbonIcon('cloud', '词云侧边栏', async () => {
            await this.toggleSidebar();
        });

        // 命令面板
        this.addCommand({
            id: 'generate-wordcloud',
            name: '生成当前笔记词云',
            callback: async () => {
                await this.activateView();
            }
        });

        // 设置页
        this.addSettingTab(new WordCloudSidebarSettingTab(this.app, this));

        console.log('[WordCloud Sidebar] 加载完成');
    }

    async loadSettings() {
        this.settings = Object.assign({
            serverUrl: DEFAULT_SERVER_URL,
            backgroundColor: '',
            colormap: 'viridis',
            topN: 80
        }, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async toggleSidebar() {
        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_WORDCLOUD);
        if (leaves.length > 0) {
            leaves.forEach(leaf => leaf.detach());
        } else {
            await this.activateView();
        }
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_WORDCLOUD);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_WORDCLOUD, active: true });
        }

        workspace.revealLeaf(leaf);

        if (leaf.view instanceof WordCloudSidebarView) {
            leaf.view.generate();
        }
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_WORDCLOUD);
        console.log('[WordCloud Sidebar] 卸载');
    }
}

window.WordCloudSidebarPlugin = WordCloudSidebarPlugin;
module.exports = WordCloudSidebarPlugin;
