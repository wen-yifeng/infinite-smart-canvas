(function attachSmartCanvasRunData(global){
    'use strict';

    const DEFAULT_REFERENCE_LIMIT = 20;
    const GENERATION_META_KEYS = Object.freeze([
        'runPrompt',
        'runModelPrompt',
        'runSettings',
        'sourceNodeId',
        'runAt',
        'promptDraftHtml',
        'promptDraftText'
    ]);

    class ImageTaskRecoverSignal extends Error {
        constructor(info){
            const data = info || {};
            super(data.message || '任务未丢失，可稍后手动查询结果');
            this.imageTaskRecover = true;
            this.taskId = data.taskId || data.task_id || '';
            this.recoverTaskId = data.recoverTaskId || data.upstream_task_id || data.task_id || '';
            this.providerId = data.providerId || data.provider_id || '';
            this.kind = data.kind || 'image';
        }
    }

    function escapeHtmlText(value){
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function splitSmartPromptItems(text){
        const trimmed = String(text || '').trim();
        if(!trimmed) return [];
        const numbered = trimmed.split(/\s*(?:^|\s)\d+\s*[.、)）．]\s+/).map(item => item.trim()).filter(Boolean);
        if(numbered.length >= 2) return numbered;
        const lines = trimmed.split(/\r?\n+/).map(item => item.trim()).filter(Boolean);
        return lines.length >= 2 ? lines : [trimmed];
    }

    function inputRefKey(item){
        if(!item?.url) return '';
        const nodeId = item.nodeId || '';
        const imageIndex = Number.isFinite(Number(item.imageIndex)) ? String(Number(item.imageIndex)) : '';
        return nodeId && imageIndex !== '' ? `${nodeId}|${imageIndex}` : `url|${item.url}`;
    }

    function blockedInputRefKeys(node){
        return new Set(Array.isArray(node?.blockedInputRefs) ? node.blockedInputRefs.filter(Boolean) : []);
    }

    function isInputRefBlocked(node, item){
        if(!node || !item?.url) return false;
        return blockedInputRefKeys(node).has(inputRefKey(item));
    }

    function uniqueReferenceImages(images, maxReferences=DEFAULT_REFERENCE_LIMIT){
        const refs = [];
        const seen = new Set();
        const numericLimit = Number(maxReferences);
        const limit = Number.isFinite(numericLimit) ? Math.max(0, numericLimit) : DEFAULT_REFERENCE_LIMIT;
        (images || []).forEach((item, index) => {
            if(!item?.url || seen.has(item.url) || refs.length >= limit) return;
            seen.add(item.url);
            refs.push({
                ...item,
                name:item.name || `图${refs.length + 1}`,
                role:item.role || `image_${refs.length + 1}`,
                imageIndex:Number.isFinite(Number(item.imageIndex)) ? Number(item.imageIndex) : index
            });
        });
        return refs;
    }

    function stripRunInputMeta(meta, escapeHtml=escapeHtmlText){
        if(!meta) return meta;
        const cleanPrompt = meta.promptText || meta.displayPrompt || meta.prompt || '';
        const escape = typeof escapeHtml === 'function' ? escapeHtml : escapeHtmlText;
        return {
            ...meta,
            promptHtml:escape(cleanPrompt),
            promptText:cleanPrompt,
            promptRefs:[],
            inputRefs:meta.inputRefs || meta.promptRefs || [],
            sourceNodeId:''
        };
    }

    function stripImageGenerationMeta(item){
        if(!item) return item;
        GENERATION_META_KEYS.forEach(key => delete item[key]);
        return item;
    }

    function nonPreviewOutputImages(images=[]){
        return (images || []).filter(item => item?.url);
    }

    function cleanHistoryImages(images=[]){
        const seen = new Set();
        return nonPreviewOutputImages(images)
            .map(item => stripImageGenerationMeta({...item}))
            .filter(item => {
                const key = `${item.kind || ''}|${item.url || ''}`;
                if(seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    function smartPendingTasks(node){
        if(!node || !Array.isArray(node.pendingTasks)) return [];
        return node.pendingTasks.filter(task => task?.taskId);
    }

    function extractUpstreamTaskId(text){
        const match = String(text || '').match(/(?:task_id|taskId|task id)\s*[=:：]\s*([A-Za-z0-9_.:-]+)/i);
        return match ? match[1] : '';
    }

    function providerIdForSmartTask(node, task, fallbackProviderId='comfly'){
        return task?.providerId || node?.runSettings?.provider_id || fallbackProviderId || 'comfly';
    }

    global.SmartCanvasRunDataPrimitives = Object.freeze({
        DEFAULT_REFERENCE_LIMIT,
        GENERATION_META_KEYS,
        splitSmartPromptItems,
        inputRefKey,
        blockedInputRefKeys,
        isInputRefBlocked,
        uniqueReferenceImages,
        stripRunInputMeta,
        stripImageGenerationMeta,
        nonPreviewOutputImages,
        cleanHistoryImages,
        smartPendingTasks,
        ImageTaskRecoverSignal,
        extractUpstreamTaskId,
        providerIdForSmartTask
    });
})(window);
