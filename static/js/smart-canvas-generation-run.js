(function attachSmartCanvasGenerationRun(global){
    'use strict';

    function buildRunPlan(settings={}, options={}){
        const engine = String(settings.engine || 'api');
        const apiLike = options.apiLike === true;
        const video = apiLike && settings.apiKind === 'video';
        const imageCount = Math.max(1, Math.min(8, Math.round(Number(settings.count) || 1)));
        return {
            kind:video ? 'video' : 'image',
            expectedCount:apiLike && !video ? imageCount : 1,
            concurrent:apiLike || engine === 'modelscope'
        };
    }

    function applyOutpaintSettings(settings={}, outpaintSize=null, apiLike=false){
        if(!apiLike || settings.apiKind === 'video' || !outpaintSize) return settings;
        const width = Math.round(Number(outpaintSize.width) || 0);
        const height = Math.round(Number(outpaintSize.height) || 0);
        if(width <= 0 || height <= 0) return settings;
        return {...settings, resolution:'custom', ratio:'', customWidth:width, customHeight:height, customSize:`${width}x${height}`};
    }

    function imageTaskPayload({prompt='', settings={}, size='', referenceImages=[], maxReferences=20}={}){
        return {
            prompt,
            provider_id:settings.provider_id,
            model:settings.model,
            size,
            quality:settings.quality || 'auto',
            n:1,
            reference_images:(referenceImages || []).slice(0, Math.max(0, Number(maxReferences) || 0))
        };
    }

    function videoTaskPayload({prompt='', settings={}, images=[], videos=[], audios=[], trustedAsset=false}={}){
        return {
            prompt,
            provider_id:settings.videoProvider || 'comfly',
            model:settings.videoModel || 'veo3-fast',
            duration:Math.max(1, Math.min(60, Number(settings.videoDuration) || 5)),
            aspect_ratio:settings.videoAspect || '16:9',
            resolution:settings.videoResolution || '',
            images:images || [],
            videos:videos || [],
            audios:audios || [],
            enhance_prompt:Boolean(settings.videoEnhancePrompt),
            enable_upsample:Boolean(settings.videoEnableUpsample),
            watermark:Boolean(settings.videoWatermark),
            camerafixed:Boolean(settings.videoCameraFixed),
            generate_audio:Boolean(settings.videoGenerateAudio),
            multimodal:Boolean(settings.videoMultimodal),
            trusted_asset:Boolean(trustedAsset)
        };
    }

    function modelscopeTaskBody({modelKey='zimage', model={}, settings={}, prompt='', imageUrls=[], width=1024, height=1024, fallbackModel=''}={}){
        const resolution = `${width}x${height}`;
        if(modelKey === 'zimage') return {prompt, resolution};
        if(modelKey === 'qwen_edit') return {prompt, image_urls:imageUrls || [], resolution};
        return {
            prompt,
            model:modelKey === 'custom' ? (settings.msCustomModel || fallbackModel) : model.modelId,
            image_urls:imageUrls || [],
            width,
            height,
            size:resolution
        };
    }

    function pendingTaskRecords(taskIds=[], metadata={}){
        return (taskIds || []).filter(Boolean).map(taskId => ({
            taskId,
            kind:metadata.kind || 'image',
            providerId:metadata.providerId,
            model:metadata.model
        }));
    }

    function outputExtension(kind='image'){
        if(kind === 'video') return 'mp4';
        if(kind === 'audio') return 'mp3';
        if(kind === 'text') return 'txt';
        return 'png';
    }

    function outputTitle(count, kind='image'){
        const plural = Number(count) > 1;
        if(kind === 'video') return plural ? 'Videos' : 'Video';
        if(kind === 'audio') return plural ? 'Audios' : 'Audio';
        if(kind === 'text') return plural ? 'Texts' : 'Text';
        if(kind === 'file') return plural ? 'Group' : 'File';
        return plural ? 'Group' : 'Image';
    }

    global.SmartCanvasGenerationRunPrimitives = Object.freeze({
        buildRunPlan,
        applyOutpaintSettings,
        imageTaskPayload,
        videoTaskPayload,
        modelscopeTaskBody,
        pendingTaskRecords,
        outputExtension,
        outputTitle
    });
})(window);
