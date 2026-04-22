/* ============================================================================
 * WordCloud Sidebar - Obsidian 插件
 * 右侧边栏词云生成器 (v1.1.3)
 * ============================================================================ */
var obsidian = require('obsidian');

const VIEW_TYPE_WORDCLOUD = 'wordcloud-sidebar-view';
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8766';
const VIEW_TIMEOUT_MS = 20000; // 20s 请求超时
const MAX_TEXT_LENGTH = 50000;  // 最大发送字数，防止长笔记压垮服务

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
            .settingEl.addClass('wordcloud-settings-dep');
        const infoEl = containerEl.createEl('div', {
            cls: 'wordcloud-settings-info',
        });
        infoEl.createEl('p', { text: '安装依赖：pip install wordcloud jieba matplotlib' });
        infoEl.createEl('p', { text: '启动服务：python wordcloud_server.py' });
        infoEl.createEl('p', { text: '服务地址：http://127.0.0.1:8766' });
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

        // 防抖版本的 generate（300ms 内只执行最后一次）
        this._debouncedGenerate = obsidian.debounce(
            () => this.generate(),
            300,
            true // true = 立即执行一次，之后等待冷静期
        );

        // 注册文件切换事件（切换笔记时自动重新生成词云）
        this.registerEvent(
            this.plugin.app.workspace.on('file-open', (file) => {
                if (file && this.status !== 'server-offline') {
                    this._debouncedGenerate();
                }
            })
        );

        // 侧边栏初次打开时，若当前已有打开的笔记，立即生成一次
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && this.status !== 'server-offline') {
            this.generate();
        }
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

        // reloadBtn 使用 registerDomEvent（Obsidian 在 onClose 时自动清理）
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
            // XSS 安全：完全用 DOM API + textContent，不走 innerHTML
            const state = content.createDiv({ cls: ['wordcloud-state', 'wordcloud-error'] });
            state.createDiv({ cls: 'wordcloud-icon-large' }).textContent = '⚠️';
            const p = state.createEl('p', { cls: 'error-message' });
            p.textContent = this.errorMessage || '生成失败';

        } else if (this.status === 'server-offline') {
            const state = content.createDiv({ cls: ['wordcloud-state', 'wordcloud-server-offline'] });
            state.createDiv({ cls: 'wordcloud-icon-large' }).textContent = '🖥️';
            state.createEl('p').textContent = '词云服务未启动';
            state.createEl('p', { cls: 'sub-text' }).textContent = '请先安装并启动服务：';

            const cmdBlock = state.createDiv({ cls: 'cmd-block' });
            cmdBlock.createDiv({ cls: 'cmd-line' }).textContent = 'pip install wordcloud jieba matplotlib';
            cmdBlock.createDiv({ cls: 'cmd-line' }).textContent = 'python wordcloud_server.py';

            // retry-btn 用 registerDomEvent 注册（Obsidian 在 onClose 时自动清理）
            const retryBtn = state.createEl('button', { cls: 'retry-btn' });
            retryBtn.textContent = '重试连接';
            this.registerDomEvent(retryBtn, 'click', () => this.generate());
        }
    }

    /** 检测 Obsidian 深色模式，返回 { bg, colormap } */
    _detectTheme() {
        // 优先级：用户自定义配置 > 深色/浅色 class > 系统跟随
        const settings = this.plugin.settings;
        if (settings.backgroundColor) {
            return { bg: settings.backgroundColor, colormap: settings.colormap || 'viridis' };
        }
        const isDarkClass = document.body.classList.contains('theme-dark');
        const isLightClass = document.body.classList.contains('theme-light');
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        const isDark = isDarkClass || (!isLightClass && prefersDark);
        return isDark
            ? { bg: '#1e1e1e', colormap: 'plasma' }
            : { bg: 'white', colormap: 'viridis' };
    }

    async generate() {
        if (this.isGenerating) return;

        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            this.status = 'idle';
            const c = this.container?.querySelector('.wordcloud-content');
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
            const content = this.container?.querySelector('.wordcloud-content');
            if (content) this.refreshContent(content);

            // 深色模式适配
            const { bg, colormap } = this._detectTheme();
            const serverUrl = this.plugin.settings.serverUrl || DEFAULT_SERVER_URL;
            const topN = this.plugin.settings.topN || 80;

            // 截断超长文本，防止请求体过大
            const trimmedText = text.slice(0, MAX_TEXT_LENGTH);

            // 使用 Obsidian requestUrl，超时由 timeout 参数控制
            const response = await obsidian.requestUrl({
                url: `${serverUrl}/wordcloud/base64`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: trimmedText,
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

            const c = this.container?.querySelector('.wordcloud-content');
            if (c) this.refreshContent(c);
        } finally {
            this.isGenerating = false;
        }
    }

    onClose() {
        // registerDomEvent 注册的监听器由 Obsidian 自动清理，此处无需手动操作
        this.container = null;
    }
}

/* ---------------------------------------------------------------------------
 * 插件主体
 * --------------------------------------------------------------------------- */
class WordCloudSidebarPlugin extends obsidian.Plugin {

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
            // leaf.detach() 返回 Promise，逐一等待完成后再返回
            for (const leaf of leaves) {
                await leaf.detach();
            }
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
        // 视图打开后的初始生成由 onOpen() 中的逻辑处理，避免 file-open 与此处重复触发
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_WORDCLOUD);
        console.log('[WordCloud Sidebar] 卸载');
    }
}

window.WordCloudSidebarPlugin = WordCloudSidebarPlugin;
module.exports = WordCloudSidebarPlugin;
