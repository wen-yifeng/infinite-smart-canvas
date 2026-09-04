/* TOP_LEVEL_GLASS_INTERACTION_20260807
   Delegated pointer refraction for explicitly marked Tier-A interactions.
   No idle animation; suspended during canvas and homepage drag states. */
(() => {
    'use strict';
    const selector = '[data-av-interaction="top"]';
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let activeTarget = null;
    let activeRect = null;
    let pendingPointer = null;
    let frame = 0;

    const unavailable = target => !target
        || !target.isConnected
        || target.matches?.(':disabled,[aria-disabled="true"],[aria-busy="true"]')
        || ['dragging','is-dragging','loading','is-loading','running','is-running'].some(name => target.classList.contains(name));

    const suspended = () => Boolean(
        document.hidden
        || reducedMotion?.matches
        || document.body?.classList.contains('home-reordering')
        || document.body?.classList.contains('smart-node-drag')
        || document.body?.classList.contains('smart-node-resize')
        || document.querySelector('.shell.panning,.shell.zoom-preview')
    );

    const clear = () => {
        if(activeTarget){
            activeTarget.style.removeProperty('--av-glass-x');
            activeTarget.style.removeProperty('--av-glass-y');
            activeTarget.classList.remove('av-pointer-active');
        }
        activeTarget = activeRect = pendingPointer = null;
        if(frame){ cancelAnimationFrame(frame); frame = 0; }
    };

    const paint = () => {
        frame = 0;
        const pointer = pendingPointer;
        pendingPointer = null;
        if(!pointer || suspended()){ clear(); return; }
        const origin = pointer.target instanceof Element ? pointer.target : null;
        const target = origin?.closest?.(selector);
        if(unavailable(target) || target.dataset.avPointer === 'off'){ clear(); return; }
        if(activeTarget !== target){
            clear();
            activeTarget = target;
            activeTarget.classList.add('av-pointer-active');
        }
        const rect = activeRect || (activeRect = target.getBoundingClientRect());
        if(rect.width <= 0 || rect.height <= 0){ clear(); return; }
        const x = Math.max(0, Math.min(rect.width, pointer.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, pointer.clientY - rect.top));
        target.style.setProperty('--av-glass-x', `${x.toFixed(1)}px`);
        target.style.setProperty('--av-glass-y', `${y.toFixed(1)}px`);
    };

    document.addEventListener('pointermove', event => {
        if(event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen'){ clear(); return; }
        pendingPointer = event;
        if(!frame) frame = requestAnimationFrame(paint);
    }, {passive:true});
    document.addEventListener('pointerleave', clear, {passive:true});
    document.addEventListener('pointercancel', clear, {passive:true});
    document.addEventListener('visibilitychange', () => { if(document.hidden) clear(); }, {passive:true});
    window.addEventListener('blur', clear, {passive:true});
    window.addEventListener('resize', () => { activeRect = null; }, {passive:true});
    window.addEventListener('scroll', () => { activeRect = null; }, {passive:true, capture:true});
    reducedMotion?.addEventListener?.('change', clear);
})();
