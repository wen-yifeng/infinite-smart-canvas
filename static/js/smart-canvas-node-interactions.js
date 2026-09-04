(function attachSmartCanvasNodeInteractions(global){
    'use strict';

    const ACTION_SELECTOR = '.node-delete,.node-drop,[data-smart-node-action],[data-image-task-query],.image-delete,.image-name-badge,.smart-video-play';
    const MEDIA_SELECTOR = '.thumb-item,.image-wrap';

    function create(options={}){
        const {
            world,
            getNodes = () => [],
            getSelection = () => ({primaryId:'', ids:[], image:{nodeId:'', index:-1}}),
            setSelection = () => {},
            getSuppressNodeClickUntil = () => 0,
            getSuppressImageClickUntil = () => 0,
            setSuppressImageClickUntil = () => {},
            scheduleRender = () => {},
            hideRunTimer = () => {},
            toggleSelection = () => {},
            syncSelectionUi = () => {},
            updateComposer = () => {},
            deleteNodeFromButton = () => {},
            runNodeToolbarAction = () => {},
            queryImageTask = () => {},
            deleteImage = () => {},
            mediaKindForItem = () => '',
            clearImageClickTimer = () => {},
            scheduleImageClick = callback => callback(),
            activateVideoPreview = () => {},
            openImagePreview = () => {},
            scheduleComposerUpdate = () => {},
            pickMediaForNode = () => {},
            setUploadTargetId = () => {},
            clearPendingGroupUploadPoint = () => {},
            renameImage = () => {},
            getNodeAspectRatio = () => 0,
            beginThumbnailDrag = () => {},
            resetNodeAspect = () => {},
            beginNodeResize = () => {},
            beginNodeDrag = () => {},
            allowPortDrag = () => true,
            beginPortDrag = () => {},
            setNodeDropEffect = () => {},
            setNodeDropPreview = () => {},
            handleNodeDrop = () => {},
        } = options;

        if(!world || typeof world.addEventListener !== 'function'){
            throw new Error('Smart Canvas node interaction root is required');
        }

        let selectionBound = false;
        let mediaBound = false;
        let actionBound = false;
        let manipulationBound = false;
        let dropBound = false;

        const nodeForId = id => getNodes().find(node => node?.id === id);
        const nodeIdFromElement = element => element?.dataset?.nodeId || element?.closest?.('.image-node')?.dataset?.id || '';
        const mediaTarget = element => {
            const nodeId = element?.closest?.('.image-node')?.dataset?.id || '';
            const targetNodeId = element?.dataset?.refNodeId || nodeId;
            const imageIndex = Number(element?.dataset?.refImageIndex ?? element?.dataset?.imageIndex ?? 0);
            const owner = nodeForId(targetNodeId);
            return {nodeId, targetNodeId, imageIndex, owner, image:owner?.images?.[imageIndex]};
        };

        function selectMedia(target){
            setSelection({primaryId:target.nodeId, ids:[], image:{nodeId:target.targetNodeId, index:target.imageIndex}});
        }

        function openMedia(element, target){
            clearImageClickTimer();
            setSuppressImageClickUntil(Date.now() + 260);
            if(mediaKindForItem(target.image || {}) === 'video'){
                hideRunTimer(target.owner || nodeForId(target.nodeId));
                activateVideoPreview(element);
                return;
            }
            selectMedia(target);
            openImagePreview(target.targetNodeId, target.imageIndex);
        }

        function selectMultiMediaSummary(element, event){
            const nodeId = element?.closest?.('.image-node')?.dataset?.id || '';
            const owner = nodeForId(nodeId);
            if(!owner) return;
            clearImageClickTimer();
            hideRunTimer(owner);
            if(event?.shiftKey) toggleSelection(nodeId);
            else setSelection({primaryId:nodeId, ids:[], image:{nodeId:'', index:-1}});
            syncSelectionUi();
            updateComposer();
        }

        function bindSelectionDelegation(){
            if(selectionBound) return;
            selectionBound = true;

            world.addEventListener('click', event => {
                const element = event.target?.closest?.('.image-node');
                if(!element || !world.contains(element)) return;
                if(event.target?.closest?.(ACTION_SELECTOR)) return;
                if(event.target?.closest?.(MEDIA_SELECTOR)) return;
                event.stopPropagation();

                if(Date.now() < Number(getSuppressNodeClickUntil()) || 0) return;

                const id = element.dataset.id;
                const node = nodeForId(id);
                if(!node) return;

                if(element.classList.contains('smart-node-compact')) scheduleRender();
                hideRunTimer(node);

                const selection = getSelection() || {};
                if(event.shiftKey){
                    toggleSelection(id);
                    syncSelectionUi();
                    updateComposer();
                    return;
                }

                const currentIds = Array.isArray(selection.ids) ? selection.ids : [];
                const currentImage = selection.image || {};
                const alreadySelected = selection.primaryId === id && currentIds.length === 0 && !currentImage.nodeId;
                setSelection({primaryId:id, ids:[], image:{nodeId:'', index:-1}});
                syncSelectionUi();
                updateComposer();
                if(alreadySelected) return;
            });

        }

        function bindMediaDelegation(){
            if(mediaBound) return;
            mediaBound = true;

            world.addEventListener('dragstart', event => {
                const element = event.target?.closest?.(MEDIA_SELECTOR);
                if(!element || !world.contains(element)) return;
                event.preventDefault();
            });

            world.addEventListener('mousedown', event => {
                const element = event.target?.closest?.(MEDIA_SELECTOR);
                if(!element || !world.contains(element)) return;
                // Low-zoom summaries must not open media, but must bubble so the node can drag.
                if(element.classList.contains('multi-media-summary')) return;
                if(event.target?.closest?.('video,audio')) return;
                if(event.button !== 0 || event.target?.closest?.('.image-delete,.image-name-badge')) return;
                if(Number(event.detail || 0) < 2) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                openMedia(element, mediaTarget(element));
            }, true);

            world.addEventListener('click', event => {
                const element = event.target?.closest?.(MEDIA_SELECTOR);
                if(!element || !world.contains(element)) return;
                if(event.target?.closest?.('video,audio') || event.target?.closest?.(ACTION_SELECTOR)) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                if(element.classList.contains('multi-media-summary')){
                    selectMultiMediaSummary(element, event);
                    return;
                }
                if(Date.now() < Number(getSuppressImageClickUntil()) || 0) return;

                const target = mediaTarget(element);
                const owner = nodeForId(target.nodeId);
                if(event.shiftKey && Number(event.detail || 1) === 1){
                    clearImageClickTimer();
                    hideRunTimer(owner);
                    toggleSelection(target.nodeId);
                    syncSelectionUi();
                    updateComposer();
                    return;
                }
                if(mediaKindForItem(target.image || {}) === 'video' || Number(event.detail || 1) >= 2){
                    openMedia(element, target);
                    return;
                }

                clearImageClickTimer();
                scheduleImageClick(() => {
                    hideRunTimer(owner);
                    selectMedia(target);
                    syncSelectionUi();
                    scheduleComposerUpdate(180);
                }, 220);
            });

            world.addEventListener('dblclick', event => {
                const element = event.target?.closest?.(MEDIA_SELECTOR);
                if(!element || !world.contains(element)) return;
                if(event.target?.closest?.('video,audio') || event.target?.closest?.(ACTION_SELECTOR)) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                if(element.classList.contains('multi-media-summary')){
                    openMedia(element, mediaTarget(element));
                    return;
                }
                openMedia(element, mediaTarget(element));
            }, true);
        }

        function bindActionDelegation(){
            if(actionBound) return;
            actionBound = true;

            world.addEventListener('mousedown', event => {
                const control = event.target?.closest?.(ACTION_SELECTOR);
                if(!control || !world.contains(control)) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
            }, true);

            world.addEventListener('click', event => {
                const control = event.target?.closest?.(ACTION_SELECTOR);
                if(!control || !world.contains(control)) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();

                const nodeElement = control.closest('.image-node');
                const nodeId = nodeIdFromElement(control);

                if(control.classList.contains('node-drop')){
                    hideRunTimer(nodeForId(nodeId));
                    if(event.shiftKey){
                        toggleSelection(nodeId);
                        syncSelectionUi();
                        updateComposer();
                        return;
                    }
                    setSelection({primaryId:nodeId, ids:[], image:{nodeId:'', index:-1}});
                    clearPendingGroupUploadPoint();
                    setUploadTargetId(nodeId);
                    syncSelectionUi();
                    updateComposer();
                    pickMediaForNode(nodeId);
                    return;
                }
                if(control.classList.contains('node-delete')){
                    deleteNodeFromButton(nodeId);
                    return;
                }
                if(control.matches('[data-smart-node-action]')){
                    runNodeToolbarAction(nodeId, control.dataset.smartNodeAction);
                    return;
                }
                if(control.matches('[data-image-task-query]')){
                    queryImageTask(control.dataset.imageTaskQuery, control.dataset.taskId);
                    return;
                }
                if(control.classList.contains('image-delete')){
                    deleteImage(nodeId, Number(control.dataset.imageIndex));
                    return;
                }
                if(control.classList.contains('smart-video-play')){
                    const item = control.closest('[data-image-index]');
                    const targetNodeId = item?.dataset.refNodeId || nodeId;
                    const imageIndex = Number(item?.dataset.refImageIndex ?? item?.dataset.imageIndex ?? 0);
                    const owner = nodeForId(targetNodeId);
                    if(mediaKindForItem(owner?.images?.[imageIndex] || {}) !== 'video') return;
                    clearImageClickTimer();
                    setSuppressImageClickUntil(Date.now() + 260);
                    hideRunTimer(owner);
                    activateVideoPreview(control);
                }
            });

            world.addEventListener('dblclick', event => {
                const badge = event.target?.closest?.('.image-name-badge');
                if(!badge || !world.contains(badge)) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();

                const nodeElement = badge.closest('.image-node');
                const item = badge.closest('[data-image-index]');
                const targetNodeId = item?.dataset.refNodeId || nodeElement?.dataset.id || '';
                const imageIndex = Number(item?.dataset.refImageIndex ?? item?.dataset.imageIndex ?? 0);
                clearImageClickTimer();
                setSuppressImageClickUntil(Date.now() + 260);
                renameImage(targetNodeId, imageIndex);
            }, true);

            world.addEventListener('wheel', event => {
                if(event.target?.closest?.('[data-thumb-scroll]')) event.stopPropagation();
            }, {passive:false});
        }

        function bindManipulationDelegation(){
            if(manipulationBound) return;
            manipulationBound = true;

            world.addEventListener('mouseover', event => {
                const handle = event.target?.closest?.('.node-resize-handle');
                if(!handle || !world.contains(handle)) return;
                const nodeId = nodeIdFromElement(handle);
                if(getNodeAspectRatio(nodeId) > 0) handle.title = '按原始比例缩放；双击恢复原始比例';
            });

            world.addEventListener('mousedown', event => {
                const nodeElement = event.target?.closest?.('.image-node');
                if(!nodeElement || !world.contains(nodeElement) || event.button !== 0) return;
                const nodeId = nodeElement.dataset.id || '';
                const thumbnail = event.target?.closest?.('.thumb-item');
                if(thumbnail){
                    if(event.target?.closest?.('video,audio') || event.target?.closest?.('.mini-x')) return;
                    if(Number(event.detail || 1) >= 2) return;
                    beginThumbnailDrag(event, nodeId, thumbnail);
                    return;
                }
                const resizeHandle = event.target?.closest?.('.node-resize-handle');
                if(resizeHandle){
                    event.preventDefault();
                    event.stopPropagation();
                    beginNodeResize(event, nodeId, resizeHandle);
                    return;
                }
                const port = event.target?.closest?.('.node-port');
                if(port){
                    event.preventDefault();
                    event.stopPropagation();
                    if(allowPortDrag()) beginPortDrag(event, nodeId, port);
                    return;
                }
                if(event.target?.closest?.('.mini-x, .thumb-item, select, input, textarea, button')) return;
                if(event.shiftKey && !event.altKey) return;
                event.preventDefault();
                event.stopPropagation();
                beginNodeDrag(event, nodeId, nodeElement);
            });

            world.addEventListener('dblclick', event => {
                const handle = event.target?.closest?.('.node-resize-handle');
                if(handle && world.contains(handle)){
                    event.preventDefault();
                    event.stopPropagation();
                    resetNodeAspect(nodeIdFromElement(handle));
                    return;
                }
                const port = event.target?.closest?.('.node-port');
                if(port && world.contains(port)) event.stopPropagation();
            });

            world.addEventListener('click', event => {
                const port = event.target?.closest?.('.node-port');
                if(port && world.contains(port)) event.stopPropagation();
            });
        }

        function bindDropDelegation(){
            if(dropBound) return;
            dropBound = true;

            world.addEventListener('dragover', event => {
                const nodeElement = event.target?.closest?.('.image-node');
                if(!nodeElement || !world.contains(nodeElement)) return;
                setNodeDropEffect(event, nodeElement.dataset.id || '');
                setNodeDropPreview(event, nodeElement.dataset.id || '', true);
            });

            world.addEventListener('dragleave', event => {
                const nodeElement = event.target?.closest?.('.image-node');
                if(!nodeElement || !world.contains(nodeElement) || nodeElement.contains(event.relatedTarget)) return;
                setNodeDropPreview(event, nodeElement.dataset.id || '', false);
            });

            world.addEventListener('drop', event => {
                const nodeElement = event.target?.closest?.('.image-node');
                if(!nodeElement || !world.contains(nodeElement)) return;
                event.preventDefault();
                event.stopPropagation();
                setNodeDropPreview(event, nodeElement.dataset.id || '', false);
                handleNodeDrop(event, nodeElement.dataset.id || '');
            });
        }

        function bindAll(){
            bindSelectionDelegation();
            bindMediaDelegation();
            bindActionDelegation();
            bindManipulationDelegation();
            bindDropDelegation();
        }

        return Object.freeze({bindAll, bindSelectionDelegation, bindMediaDelegation, bindActionDelegation, bindManipulationDelegation, bindDropDelegation});
    }

    global.SmartCanvasNodeInteractions = Object.freeze({create, ACTION_SELECTOR, MEDIA_SELECTOR});
})(window);
