/* PREVIEW_QUALITY_20260831
   节点卡片默认加载 /api/media-preview?w=768 预览；缩放停止后按实际显示设备像素
   升级到更高缓存档位（512/768/1024/1536/2048）。只升级不降级、只在 src 当前为
   预览 URL 时换 src；选中节点加载原图的 syncSmartSelectedImageResolution 流程
   始终优先，本模块仅同步提升 data-preview-src 供其取消选中后恢复。
   无独立常驻定时器：由 world 的 style/class/childList 变化（缩放、平移、重渲染）
   合并触发，img.src 不在监听过滤器内，不会自触发。 */
(function(global){
    'use strict';

    const TIERS = [512, 768, 1024, 1536, 2048];
    const MAX_DPR = 2.5;
    const PASS_DEBOUNCE_MS = 250;
    const UPGRADE_FACTOR = 1.2;

    let passTimer = 0;

    const world = () => document.getElementById('world');

    const suspended = () => Boolean(
        document.hidden
        || document.body?.classList.contains('smart-node-drag')
        || document.body?.classList.contains('smart-node-resize')
        || document.querySelector('.shell.panning,.shell.zoom-preview')
    );

    function tierFor(needed){
        for(const tier of TIERS){
            if(tier >= needed) return tier;
        }
        return TIERS[TIERS.length - 1];
    }

    function previewWidth(url){
        const match = /[?&]w=(\d+)/.exec(String(url || ''));
        return match ? Number(match[1]) : 0;
    }

    function withWidth(url, width){
        return String(url || '').replace(/([?&])w=\d+/, `$1w=${width}`);
    }

    function upgradeImage(img){
        const src = img.getAttribute('src') || '';
        const previewSrc = img.dataset.previewSrc || '';
        const basis = previewSrc.startsWith('/api/media-preview') ? previewSrc : src;
        if(!basis.startsWith('/api/media-preview')) return;
        const current = previewWidth(basis);
        if(!current || current >= TIERS[TIERS.length - 1]) return;
        const rect = img.getBoundingClientRect();
        if(rect.width <= 0) return;
        const needed = Math.round(rect.width * Math.min(MAX_DPR, global.devicePixelRatio || 1));
        if(needed <= current * UPGRADE_FACTOR) return;
        const target = tierFor(needed);
        if(target <= current) return;
        const upgraded = withWidth(basis, target);
        if(upgraded === basis) return;
        const probe = new Image();
        probe.onload = () => {
            if(!img.isConnected) return;
            img.dataset.previewSrc = upgraded;
            if(img.getAttribute('src') === basis) img.src = upgraded;
        };
        probe.src = upgraded;
    }

    function pass(){
        passTimer = 0;
        if(suspended()) return;
        const root = world();
        if(!root) return;
        root.querySelectorAll('img[data-preview-src][data-original-src]').forEach(img => {
            if(img.dataset.proxyFallbackTried === '1') return;
            upgradeImage(img);
        });
    }

    function schedulePass(delay = PASS_DEBOUNCE_MS){
        clearTimeout(passTimer);
        passTimer = setTimeout(pass, Math.max(0, Number(delay) || 0));
    }

    function init(){
        const root = world();
        if(!root) return;
        new MutationObserver(() => schedulePass()).observe(root, {
            attributes: true,
            attributeFilter: ['style', 'class'],
            childList: true,
            subtree: true
        });
        global.addEventListener('resize', () => schedulePass(), {passive: true});
        document.addEventListener('visibilitychange', () => {
            if(!document.hidden) schedulePass(0);
        }, {passive: true});
        schedulePass(600);
    }

    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
    else init();

    global.SmartCanvasPreviewQuality = Object.freeze({schedulePass});
})(window);
