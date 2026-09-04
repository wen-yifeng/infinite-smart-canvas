(function(global){
    'use strict';

    function cloneSmartSettings(source){
        try {
            return JSON.parse(JSON.stringify(source || {}));
        } catch(e) {
            return {...(source || {})};
        }
    }

    function settingsForStorage(source){
        const clean = cloneSmartSettings(source);
        clean.videoTempShLinks = (clean.videoTempShLinks || []).filter(item => item?.manual === true);
        return clean;
    }

    function normalizeSmartVideoModeSettings(target, preferMultimodal=false){
        if(!target || typeof target !== 'object') return target;
        target.videoUseFrameRoles = Boolean(target.videoUseFrameRoles);
        if(preferMultimodal && !target.videoUseFrameRoles && target._videoMultimodalUserSet !== true) target.videoMultimodal = true;
        else target.videoMultimodal = Boolean(target.videoMultimodal);
        if(target.videoUseFrameRoles) target.videoMultimodal = false;
        return target;
    }

    function isApiLikeEngine(engine){
        return ['api', 'volcengine'].includes(String(engine || '').toLowerCase());
    }

    function isGptImageAutoSizeModel(model){
        const raw = String(model || '').trim().toLowerCase();
        const normalized = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const compact = raw.replace(/[^a-z0-9]+/g, '');
        return normalized === 'gpt-image-2'
            || normalized.startsWith('gpt-image-2-')
            || normalized.endsWith('-gpt-image-2')
            || normalized.includes('-gpt-image-2-')
            || compact === 'gptimage2'
            || compact.startsWith('gptimage2')
            || compact.endsWith('gptimage2');
    }

    function defaultSmartApiResolution(model){
        return isGptImageAutoSizeModel(model) ? '4k' : '1k';
    }

    function mediaItemForStorage(item){
        if(!item || typeof item !== 'object') return item;
        const clean = {...item};
        delete clean.cloudUrl;
        delete clean.uploadedUrl;
        delete clean.originalRemoteUrl;
        delete clean.tempCloudUrl;
        delete clean._inlineVideoActive;
        return clean;
    }

    function buildCanvasForStorage({
        canvas=null,
        canvasDefaultSmartSettings=null,
        initialSmartSettings=null,
        smartLogPreviewNodeId='',
        normalizeDocument=null,
    } = {}){
        let clean = cloneSmartSettings(canvas || {});
        if(typeof normalizeDocument === 'function') clean = normalizeDocument(clean) || clean;
        clean.settings = settingsForStorage(canvasDefaultSmartSettings || initialSmartSettings || {});
        delete clean.logs;
        if(Array.isArray(clean.nodes)) clean.nodes = clean.nodes.filter(node => node.id !== smartLogPreviewNodeId);
        (clean.nodes || []).forEach(node => {
            if(Array.isArray(node.images)) node.images = node.images.map(mediaItemForStorage);
            if(node.runSettings) node.runSettings = settingsForStorage(node.runSettings);
        });
        return clean;
    }

    global.SmartCanvasStoragePrimitives = Object.freeze({
        cloneSmartSettings,
        settingsForStorage,
        normalizeSmartVideoModeSettings,
        isApiLikeEngine,
        isGptImageAutoSizeModel,
        defaultSmartApiResolution,
        mediaItemForStorage,
        buildCanvasForStorage,
    });
})(window);
