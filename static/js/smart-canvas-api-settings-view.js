/*
 * smart-canvas-api-settings-view.js — API 设置 iframe 域（Phase 2 P2.9，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createApiSettingsView(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：API 设置模态框（iframe 嵌入 api-settings.html）、快捷键透传、
 * 状态提示、开关逻辑与 window message 分发。
 */
export function createApiSettingsView(ctx) {

    const {
        applyTheme,
        handleAssetLibraryUpdatedMessage,
        handleCanvasTaskUpdatedMessage,
        handleCanvasUpdatedMessage,
        refreshIcons,
        refreshSmartConfigFromSettings
    } = ctx;

// API 设置模态框逻辑（支持 toggle）
let smartCanvasApiSettingsModal, smartCanvasApiSettingsFrame, smartCanvasApiSettingsClose, smartCanvasApiSettingsStatus;
let smartCanvasApiSettingsHideTimer;

function smartCanvasApiSettingsUrl(){
    const url = new URL('/static/api-settings.html', window.location.origin);
    url.searchParams.set('embed', '1');
    return `${url.pathname}${url.search}`;
}

function preloadSmartCanvasApiSettingsFrame(){
    const frame = document.getElementById('smartCanvasApiSettingsFrame');
    if(!frame || frame.getAttribute('src')) return;
    frame.src = smartCanvasApiSettingsUrl();
}

function bindSmartCanvasApiSettingsFrameShortcuts(){
    const frameWindow = smartCanvasApiSettingsFrame?.contentWindow;
    if(!frameWindow || frameWindow.__smartCanvasSettingsShortcutsBound) return;
    frameWindow.__smartCanvasSettingsShortcutsBound = true;
    frameWindow.addEventListener('keydown', event => {
        if(event.code === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey){
            event.preventDefault();
            event.stopPropagation();
            closeSmartCanvasSettings();
            return;
        }
        if(event.code === 'KeyZ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey){
            const target = event.target;
            if(!target?.closest?.('input, textarea, select, option, [contenteditable="true"]')){
                event.preventDefault();
                event.stopPropagation();
                closeSmartCanvasSettings();
            }
        }
    });
}

function syncSmartCanvasApiSettingsFrame(){
    const frameWindow = smartCanvasApiSettingsFrame?.contentWindow;
    if(!frameWindow) return;
    bindSmartCanvasApiSettingsFrameShortcuts();
    const theme = document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light';
    frameWindow.postMessage({type:'studio-theme', theme}, location.origin);
    const lang = window.StudioI18n?.lang?.();
    if(lang) frameWindow.postMessage({type:'studio-lang', lang}, location.origin);
}

function showSmartCanvasApiSettingsStatus(text){
    if(!smartCanvasApiSettingsStatus) return;
    smartCanvasApiSettingsStatus.textContent = text || '';
    window.clearTimeout(smartCanvasApiSettingsHideTimer);
    if(text) smartCanvasApiSettingsHideTimer = window.setTimeout(() => {
        if(smartCanvasApiSettingsStatus) smartCanvasApiSettingsStatus.textContent = '';
    }, 2400);
}

function openSmartCanvasSettings(){
    if(!smartCanvasApiSettingsModal) return;
    
    // Toggle: 如果已打开则关闭
    if(!smartCanvasApiSettingsModal.hidden && smartCanvasApiSettingsModal.classList.contains('open')){
        closeSmartCanvasSettings();
        return;
    }
    
    window.clearTimeout(smartCanvasApiSettingsHideTimer);
    smartCanvasApiSettingsModal.hidden = false;
    requestAnimationFrame(() => smartCanvasApiSettingsModal.classList.add('open'));
    if(!smartCanvasApiSettingsFrame?.getAttribute('src')) smartCanvasApiSettingsFrame.src = smartCanvasApiSettingsUrl();
    else syncSmartCanvasApiSettingsFrame();
    refreshIcons(smartCanvasApiSettingsModal);
}

function closeSmartCanvasSettings(){
    if(!smartCanvasApiSettingsModal || smartCanvasApiSettingsModal.hidden) return;
    smartCanvasApiSettingsModal.classList.remove('open');
    window.setTimeout(() => {
        if(!smartCanvasApiSettingsModal.classList.contains('open')) smartCanvasApiSettingsModal.hidden = true;
    }, 150);
    document.getElementById('smartCanvasSettingsBtn')?.focus({preventScroll:true});
}

function handleSmartCanvasWindowMessage(event){
    if(event.origin && event.origin !== location.origin) return;
    if(event.data?.type === 'api-settings-close'){
        closeSmartCanvasSettings();
        return;
    }
    if(event.data?.type === 'api-settings-status'){
        showSmartCanvasApiSettingsStatus(event.data.text);
        return;
    }
    if(event.data?.type === 'studio-theme') applyTheme(event.data.theme || 'dark');
    if(event.data?.type === 'providers-changed') refreshSmartConfigFromSettings();
    if(event.data?.type === 'asset_library_updated') handleAssetLibraryUpdatedMessage(event.data);
    if(event.data?.type === 'canvas_updated') handleCanvasUpdatedMessage(event.data);
    if(event.data?.type === 'canvas_task_updated') handleCanvasTaskUpdatedMessage(event.data);
    if(event.data?.type === 'studio-lang' && window.StudioI18n) window.StudioI18n.set(event.data.lang || 'zh');
}

eventManager.addGlobal(window, 'message', handleSmartCanvasWindowMessage);

// API 设置模态框初始化
(function(){
    smartCanvasApiSettingsModal = document.getElementById('smartCanvasApiSettingsModal');
    smartCanvasApiSettingsFrame = document.getElementById('smartCanvasApiSettingsFrame');
    smartCanvasApiSettingsClose = document.getElementById('smartCanvasApiSettingsClose');
    smartCanvasApiSettingsStatus = document.getElementById('smartCanvasApiSettingsStatus');
    
    if(smartCanvasApiSettingsClose){
        smartCanvasApiSettingsClose.addEventListener('click', closeSmartCanvasSettings);
    }
    
    if(smartCanvasApiSettingsModal){
        // 点击卡片外区域关闭
        smartCanvasApiSettingsModal.addEventListener('click', e => {
            if(e.target === smartCanvasApiSettingsModal) closeSmartCanvasSettings();
        });
    }
    
    if(smartCanvasApiSettingsFrame){
        smartCanvasApiSettingsFrame.addEventListener('load', () => {
            syncSmartCanvasApiSettingsFrame();
        });
    }

    if(typeof window.requestIdleCallback === 'function'){
        window.requestIdleCallback(preloadSmartCanvasApiSettingsFrame, {timeout:2000});
    } else {
        window.setTimeout(preloadSmartCanvasApiSettingsFrame, 1200);
    }
})();

    return {
        openSmartCanvasSettings
    };

}
