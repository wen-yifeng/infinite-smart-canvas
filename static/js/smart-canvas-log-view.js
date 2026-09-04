/**
 * Smart Canvas run-log view: list rendering, copy/focus handlers, and media lightbox.
 *
 * This stays a classic-script factory so it can receive the canvas runtime's current
 * state and helpers without duplicating node, selection, or persistence state.
 */
(function () {
    'use strict';

    function create(dependencies) {
        const {
            escapeHtml,
            escapeAttr,
            tr,
            refreshIcons,
            getNodes,
            focusNode,
            copyMediaSizeFields,
            upstreamNodesForKinds,
            isSmartImageNode,
            parseSizeValue,
            imageResolutionLabel,
            outputUrlLooksVideo,
            smartPreviewImgHtml,
            smartVideoPreviewHtml,
            bindSmartPreviewImageFallbacks,
            copyTextToClipboard,
            smartMediaPreviewUrl,
            displayMediaUrl,
            fileNameFromUrl,
            downloadPreviewFile,
            formatRunDuration,
            nodeMediaSelector
        } = dependencies;

        function smartLogOutputItem(output){

            if(typeof output === 'string') return {url:output};

            if(!output || typeof output !== 'object') return null;

            const url = output.url || output.path || output.src || output.uri || '';

            if(!url) return null;

            return copyMediaSizeFields(output, {

                url,

                kind:output.kind || output.type || output.mediaKind || '',

                name:output.name || output.filename || ''

            });

        }

        function smartLogReferenceNode(log, reference, indexes={}){

            const refNodeId = reference?.nodeId || '';

            const direct = refNodeId ? indexes.nodeById?.get(refNodeId) || getNodes().find(node => node.id === refNodeId) : null;

            if(direct) return direct;

            const refUrl = String(reference?.url || '');

            const logNode = log?.nodeId ? getNodes().find(node => node.id === log.nodeId) : null;

            const upstream = upstreamNodesForKinds(logNode, ['input', 'flow']).filter(isSmartImageNode);

            const matchingUpstream = upstream.find(node => (node.images || []).some(image => String(image?.url || '') === refUrl));

            if(matchingUpstream) return matchingUpstream;

            if(upstream.length) return upstream[0];

            return refUrl ? indexes.nodeByImageUrl?.get(refUrl) || getNodes().find(node => (node.images || []).some(image => String(image?.url || '') === refUrl)) || null : null;

        }

        function normalizedSizeLabel(value){

            const parsed = parseSizeValue(value);

            const w = Number(parsed?.width || 0);

            const h = Number(parsed?.height || 0);

            return w > 0 && h > 0 ? `${Math.round(w)} x ${Math.round(h)}` : '';

        }

        function smartLogSizeSummary(log, outputs=[]){

            const req = log?.request || {};

            const requestLabel = normalizedSizeLabel(req.size || req.resolution || '');

            const actualLabels = [...new Set(outputs.map(imageResolutionLabel).filter(Boolean))];

            if(!actualLabels.length) return '';

            const actualText = actualLabels.slice(0, 3).join(', ');

            const more = actualLabels.length > 3 ? ` +${actualLabels.length - 3}` : '';

            const actualLabel = `${actualText}${more}`;

            if(requestLabel && actualLabels.some(label => label !== requestLabel)){

                return `请求 ${requestLabel} / 实际 ${actualLabel}`;

            }

            return `实际 ${actualLabel}`;

        }

        // CODEX 2026.08.09: 日志预览与画布预览共用一套缩放/平移语义

        const smartLogLightboxView = {scale:1, offsetX:0, offsetY:0, pan:null};

        function applySmartLogLightboxTransform(){

            const box = document.getElementById('smartLogLightbox');

            const img = box?.querySelector(nodeMediaSelector());

            const scale = Math.max(1, Math.min(8, Number(smartLogLightboxView.scale) || 1));

            const isZoomed = scale > 1.001;

            box?.classList.toggle('is-zoomed', isZoomed);

            if(!img) return;

            const offsetX = Number(smartLogLightboxView.offsetX) || 0;

            const offsetY = Number(smartLogLightboxView.offsetY) || 0;

            img.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;

            img.style.transformOrigin = 'center center';

        }

        function resetSmartLogLightboxTransform(){

            smartLogLightboxView.scale = 1;

            smartLogLightboxView.offsetX = 0;

            smartLogLightboxView.offsetY = 0;

            smartLogLightboxView.pan = null;

            document.getElementById('smartLogLightbox')?.classList.remove('is-panning');

            applySmartLogLightboxTransform();

        }

        function closeSmartLogLightbox(){

            const box = document.getElementById('smartLogLightbox');

            if(!box) return;

            box.classList.remove('open');

            const img = box.querySelector('img');

            if(img){ img.onerror = null; img.style.transform = ''; img.removeAttribute('src'); }

            resetSmartLogLightboxTransform();

        }

        // 日志与画布共用同一套极简图片预览：左上分辨率、右上下载，点击遮罩退出。

        function buildSmartLogLightboxHtml(){

            return `<div class="preview-image-frame"><img class="preview-media" alt="preview" draggable="false"><div class="preview-resolution" hidden></div><div class="image-preview-top-actions"><button class="preview-icon-btn" type="button" data-smart-log-locate title="定位节点" aria-label="定位节点"><i data-lucide="locate-fixed"></i></button><button class="preview-icon-btn" type="button" data-smart-log-download title="下载" aria-label="下载"><i data-lucide="download"></i></button><button class="preview-icon-btn" type="button" data-smart-log-close title="关闭" aria-label="关闭"><i data-lucide="x"></i></button></div></div>`;

        }

        function bindSmartLogLightboxEvents(box){

                // CODEX 2026.08.09: 取消双击关闭，改为右上角关闭按钮；空白关闭改用 pointerdown/up 配对，避开拖拽误触

                let logLightboxPointerDownTarget = null;

                box.addEventListener('pointerdown', e => { logLightboxPointerDownTarget = e.target; });

                box.addEventListener('pointerup', e => {

                    const downOnBlank = logLightboxPointerDownTarget && !logLightboxPointerDownTarget.closest('.preview-image-frame');

                    const upOnBlank = e.target && !e.target.closest('.preview-image-frame');

                    if(downOnBlank && upOnBlank) closeSmartLogLightbox();

                    logLightboxPointerDownTarget = null;

                });

                // CODEX 2026.08.09: 滚轮在画幅内缩放，放大后左键拖拽看局部

                const logLightboxFrame = () => box.querySelector('.preview-image-frame');

                box.addEventListener('wheel', e => {

                    const img = box.querySelector(nodeMediaSelector());

                    if(!box.classList.contains('open') || !img) return;

                    e.preventDefault();

                    e.stopPropagation();

                    if(!e.deltaY) return;

                    const rect = logLightboxFrame()?.getBoundingClientRect();

                    if(!rect?.width || !rect?.height) return;

                    const previousScale = Math.max(1, Math.min(8, Number(smartLogLightboxView.scale) || 1));

                    const nextScale = Math.max(1, Math.min(8, previousScale * Math.exp(-e.deltaY * 0.0015)));

                    if(Math.abs(nextScale - previousScale) < 0.001) return;

                    if(nextScale <= 1.001){

                        resetSmartLogLightboxTransform();

                        return;

                    }

                    const pointerX = e.clientX - (rect.left + rect.width / 2);

                    const pointerY = e.clientY - (rect.top + rect.height / 2);

                    const ratio = nextScale / previousScale;

                    const nextX = pointerX - (pointerX - smartLogLightboxView.offsetX) * ratio;

                    const nextY = pointerY - (pointerY - smartLogLightboxView.offsetY) * ratio;

                    const maxX = rect.width * (nextScale - 1) / 2;

                    const maxY = rect.height * (nextScale - 1) / 2;

                    smartLogLightboxView.scale = nextScale;

                    smartLogLightboxView.offsetX = Math.max(-maxX, Math.min(maxX, nextX));

                    smartLogLightboxView.offsetY = Math.max(-maxY, Math.min(maxY, nextY));

                    applySmartLogLightboxTransform();

                }, {passive:false});

                box.addEventListener('pointerdown', e => {

                    if(e.button !== 0 || Number(smartLogLightboxView.scale) <= 1.001) return;

                    if(!e.target.closest('.preview-image-frame') || e.target.closest('.image-preview-top-actions')) return;

                    e.preventDefault();

                    smartLogLightboxView.pan = {

                        pointerId:e.pointerId,

                        startX:e.clientX,

                        startY:e.clientY,

                        offsetX:Number(smartLogLightboxView.offsetX) || 0,

                        offsetY:Number(smartLogLightboxView.offsetY) || 0

                    };

                    box.classList.add('is-panning');

                    box.setPointerCapture?.(e.pointerId);

                });

                box.addEventListener('pointermove', e => {

                    const pan = smartLogLightboxView.pan;

                    if(!pan || pan.pointerId !== e.pointerId) return;

                    const rect = logLightboxFrame()?.getBoundingClientRect();

                    if(!rect?.width || !rect?.height) return;

                    const scale = Math.max(1, Math.min(8, Number(smartLogLightboxView.scale) || 1));

                    const maxX = rect.width * (scale - 1) / 2;

                    const maxY = rect.height * (scale - 1) / 2;

                    smartLogLightboxView.offsetX = Math.max(-maxX, Math.min(maxX, pan.offsetX + (e.clientX - pan.startX)));

                    smartLogLightboxView.offsetY = Math.max(-maxY, Math.min(maxY, pan.offsetY + (e.clientY - pan.startY)));

                    applySmartLogLightboxTransform();

                });

                const endLogLightboxPan = e => {

                    const pan = smartLogLightboxView.pan;

                    if(!pan || (e && pan.pointerId !== e.pointerId)) return;

                    smartLogLightboxView.pan = null;

                    box.classList.remove('is-panning');

                    if(e) box.releasePointerCapture?.(e.pointerId);

                };

                box.addEventListener('pointerup', endLogLightboxPan);

                box.addEventListener('pointercancel', endLogLightboxPan);

                box.addEventListener('click', e => {

                    if(e.target.closest('[data-smart-log-close]')){

                        e.preventDefault();

                        e.stopPropagation();

                        closeSmartLogLightbox();

                        return;

                    }

                    const locate = e.target.closest('[data-smart-log-locate]');

                    if(locate){

                        const targetId = box.dataset.logNodeId || '';

                        closeSmartLogLightbox();

                        focusNode(targetId, '生成节点');

                    }

                    const download = e.target.closest('[data-smart-log-download]');

                    if(download) downloadPreviewFile({url:box.dataset.downloadUrl || '', name:box.dataset.downloadName || ''});

                });

        }

        function applySmartLogLightboxMedia(box, url, nodeId){

            const img = box.querySelector('img');

            const resolution = box.querySelector('.preview-resolution');

            // 原图加载失败时回退到缩略图同款的 media-preview 代理（PIL 渲染，对截断文件更宽容）。

            let triedFallback = false;

            img.onerror = () => {

                if(triedFallback) return;

                triedFallback = true;

                const fb = smartMediaPreviewUrl({url}, 2048);

                if(fb && fb !== img.getAttribute('src')) img.src = fb;

            };

            img.onload = () => {

                const width = Number(img.naturalWidth || 0), height = Number(img.naturalHeight || 0);

                if(resolution){

                    resolution.hidden = !(width > 0 && height > 0);

                    resolution.textContent = width > 0 && height > 0 ? `${width} × ${height}` : '';

                }

            };

            box.dataset.downloadUrl = url;

            box.dataset.downloadName = fileNameFromUrl(url);

            box.dataset.logNodeId = nodeId;

            const locateButton = box.querySelector('[data-smart-log-locate]');

            if(locateButton) locateButton.disabled = !nodeId || !getNodes().some(node => node.id === nodeId);

            img.src = displayMediaUrl({url});

            resetSmartLogLightboxTransform();

            box.classList.add('open');

            refreshIcons();

        }

        function openSmartLogLightbox(url, kind='image', nodeId=''){

            if(!url) return;

            if(kind === 'video' || outputUrlLooksVideo(url)){ window.open(displayMediaUrl({url}), '_blank'); return; }

            let box = document.getElementById('smartLogLightbox');

            if(!box){

                box = document.createElement('div');

                box.id = 'smartLogLightbox';

                box.className = 'smart-log-lightbox';

                box.innerHTML = buildSmartLogLightboxHtml();

                document.body.appendChild(box);

                bindSmartLogLightboxEvents(box);

            }

            applySmartLogLightboxMedia(box, url, nodeId);

        }

        function smartLogPreviewNode(url, kind='image', nodeId=''){

            openSmartLogLightbox(url, kind, nodeId);

        }

        function buildSmartLogSummaryText(logs){

            const failed = logs.filter(log => log.status === 'failed').length;

            const running = logs.filter(log => ['running','pending','queued'].includes(String(log.status || '').toLowerCase())).length;

            const succeeded = logs.filter(log => log.status === 'success').length;

            return `成功 ${succeeded} · 运行中 ${running} · 失败 ${failed}`;

        }

        function buildSmartLogItemHtml(log, nodeById, nodeByImageUrl){

                const outputs = (log.outputs || []).map(smartLogOutputItem).filter(item => item?.url);

                const references = (log.refs || []).map(reference => {

                    const item = smartLogOutputItem(reference);

                    return item ? {...item, nodeId:reference?.nodeId || ''} : null;

                }).filter(item => item?.url);

                const failed = log.status === 'failed';

                const outputTarget = nodeById.get(log.targetNodeId)

                    || outputs.map(output => nodeByImageUrl.get(String(output.url || ''))).find(Boolean)

                    || nodeById.get(log.nodeId)

                    || null;

                const focusTarget = failed ? smartLogReferenceNode(log, references[0], {nodeById, nodeByImageUrl}) : outputTarget;

                let thumbItems;
                if(failed){
                    thumbItems = references.slice(0, 1);
                    if(!thumbItems.length && outputs.length) thumbItems = outputs.slice(0, 1);
                    if(!thumbItems.length && focusTarget?.images?.length){
                        const upstreamImg = focusTarget.images[0];
                        if(upstreamImg?.url) thumbItems = [{url: upstreamImg.url, kind: upstreamImg.kind || 'image', name: upstreamImg.name || ''}];
                    }
                } else {
                    thumbItems = outputs.slice(0, 8);
                }

                const focusLabel = failed ? '上游节点' : '生成节点';

                const thumbs = thumbItems.map(item => {

                    const safe = escapeAttr(item.url);

                    const kind = item.kind || (outputUrlLooksVideo(item.url) ? 'video' : 'image');

                    const label = imageResolutionLabel(item);

                    const attrs = `data-url="${safe}" data-kind="${escapeAttr(kind)}" data-log-node-id="${escapeAttr(focusTarget?.id || '')}" title="${escapeAttr(label || (failed ? '上游参考图' : '输出图'))}" alt="${failed ? '上游参考图' : '输出图'}"`;

                    return kind === 'video' ? smartVideoPreviewHtml(item, 152, attrs) : smartPreviewImgHtml(item, 152, attrs);

                }).join('');

                const date = new Date(log.createdAt || Date.now()).toLocaleString(window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN');

                const req = log.request || {};

                const taskId = req.task_id || req.taskId || req.prompt_id || req.promptId || '';

                const sizeSummary = smartLogSizeSummary(log, outputs);

                const subParts = [

                    date,

                    `${window.StudioI18n?.lang() === 'en' ? 'outputs' : '输出'} ${outputs.length}`,

                    sizeSummary,

                    taskId ? `ID ${taskId}` : '',

                ].filter(Boolean);

                const estimatedHeight = 180 + Math.max(0, thumbItems.length - 1) * 82 + (failed ? 48 : 0);

                return `<div class="log-item ${log.status === 'failed' ? 'failed' : ''}" style="contain-intrinsic-size:auto ${estimatedHeight}px">

                    <div class="log-main">

                        <div class="log-meta">

                            <span class="log-chip ${log.status === 'failed' ? 'status-failed' : 'status-ok'}">${escapeHtml(log.status === 'failed' ? tr('canvas.failed') : tr('canvas.success'))}</span>

                            <span class="log-chip log-platform">${escapeHtml(log.platform || '-')}</span>

                            ${log.model ? `<span class="log-chip">${escapeHtml(log.model)}</span>` : ''}

                            <span class="log-chip">${escapeHtml(formatRunDuration(log.runMs || 0))}</span>

                        </div>

                        <div class="log-subline">${subParts.map(part => `<span title="${escapeAttr(part)}">${escapeHtml(part)}</span>`).join('')}</div>

                        ${log.error ? `<div class="log-error" title="${escapeAttr(log.error)}" data-error="${escapeAttr(log.error)}">${escapeHtml(log.error)}</div>` : ''}

                    </div>

                    <div class="log-media">

                        <div class="log-thumbs">${thumbs}</div>

                        <button type="button" class="log-focus-btn" ${focusTarget ? `data-log-focus-node="${escapeAttr(focusTarget.id)}"` : 'disabled'} title="${focusTarget ? `定位${focusLabel}` : `${focusLabel}已不存在`}" aria-label="${focusTarget ? `定位${focusLabel}` : `${focusLabel}已不存在`}"><i data-lucide="locate-fixed"></i></button>

                    </div>

                    <div class="log-prompt" data-prompt="${escapeAttr(log.prompt || '')}">${escapeHtml(log.prompt || tr('canvas.noPromptMeta'))}</div>

                </div>`;

        }

        function bindSmartLogItemInteractions(smartLogList){

            smartLogList.querySelectorAll('[data-url]').forEach(el => {

                el.onclick = e => {

                    e.stopPropagation();

                    smartLogPreviewNode(el.dataset.url, el.dataset.kind || 'image', el.dataset.logNodeId || '');

                };

            });

            smartLogList.querySelectorAll('[data-log-focus-node]').forEach(button => {

                button.onclick = event => {

                    event.preventDefault();

                    event.stopPropagation();

                    const failed = button.closest('.log-item')?.classList.contains('failed');

                    focusNode(button.dataset.logFocusNode || '', failed ? '上游节点' : '生成节点');

                };

            });

        }

        function bindSmartLogCopyHandlers(smartLogList){

            const bindLogCopy = (selector, key) => {

                smartLogList.querySelectorAll(selector).forEach(el => {

                    el.onclick = async e => {

                        e.stopPropagation();

                        const text = el.dataset[key] || '';

                        const copied = await copyTextToClipboard(text);

                        const oldText = el.textContent;

                        el.textContent = copied ? tr('canvas.copied') : tr('canvas.copyFailed');

                        if(copied) el.classList.add('copied');

                        setTimeout(() => {

                            el.textContent = oldText;

                            el.classList.remove('copied');

                        }, 900);

                    };

                });

            };

            bindLogCopy('[data-prompt]', 'prompt');

            bindLogCopy('[data-error]', 'error');

        }

        let renderedLogItems = [];
        let renderedVisibleCount = 0;

        function renderList({list, summary, logs=[], visibleCount=0, summaryText=''}) {
            if(!list) return;
            const visibleLogs = logs.slice(0, visibleCount);
            const hasMoreLogs = visibleCount < logs.length;
            const previousScrollTop = list.scrollTop;

            const currentNodes = getNodes();
            const nodeById = new Map(currentNodes.map(node => [node.id, node]));
            const nodeByImageUrl = new Map();
            currentNodes.forEach(node => (node.images || []).forEach(image => {
                const url = String(image?.url || '');
                if(url && !nodeByImageUrl.has(url)) nodeByImageUrl.set(url, node);
            }));

            if(summary) summary.textContent = summaryText || buildSmartLogSummaryText(logs);

            const canAppend = renderedVisibleCount > 0
                && renderedVisibleCount <= visibleLogs.length
                && renderedVisibleCount < visibleCount
                && renderedLogItems.length === renderedVisibleCount
                && renderedLogItems.every((item, index) => item === visibleLogs[index]);

            let prependCount = 0;
            if(!canAppend && renderedVisibleCount === visibleCount && renderedVisibleCount > 0 && visibleLogs.length === visibleCount){
                const anchor = renderedLogItems[0];
                const anchorIndex = visibleLogs.indexOf(anchor);
                if(anchorIndex > 0 && anchorIndex <= visibleCount){
                    const remain = visibleCount - anchorIndex;
                    let suffixMatches = true;
                    for(let i = 0; i < remain; i++){
                        if(visibleLogs[anchorIndex + i] !== renderedLogItems[i]){
                            suffixMatches = false;
                            break;
                        }
                    }
                    if(suffixMatches) prependCount = anchorIndex;
                }
            }

            if(canAppend){
                const newLogs = visibleLogs.slice(renderedVisibleCount);
                const temp = document.createElement('div');
                temp.innerHTML = newLogs.map(log => buildSmartLogItemHtml(log, nodeById, nodeByImageUrl)).join('');

                bindSmartPreviewImageFallbacks(temp);
                bindSmartLogItemInteractions(temp);
                bindSmartLogCopyHandlers(temp);
                refreshIcons(temp);

                const more = list.querySelector('.log-more');
                if(more) more.remove();
                while(temp.firstChild) list.appendChild(temp.firstChild);
            } else if(prependCount > 0){
                const newLogs = visibleLogs.slice(0, prependCount);
                const temp = document.createElement('div');
                temp.innerHTML = newLogs.map(log => buildSmartLogItemHtml(log, nodeById, nodeByImageUrl)).join('');

                bindSmartPreviewImageFallbacks(temp);
                bindSmartLogItemInteractions(temp);
                bindSmartLogCopyHandlers(temp);
                refreshIcons(temp);

                const more = list.querySelector('.log-more');
                if(more) more.remove();

                const itemEls = Array.from(list.children).filter(el => el.classList.contains('log-item'));
                const removeStart = Math.max(0, itemEls.length - prependCount);
                for(let i = itemEls.length - 1; i >= removeStart; i--) itemEls[i].remove();

                const firstItem = itemEls[0];
                if(firstItem && firstItem.isConnected){
                    while(temp.firstChild) list.insertBefore(temp.firstChild, firstItem);
                } else {
                    while(temp.firstChild) list.appendChild(temp.firstChild);
                }
            } else {
                list.innerHTML = visibleLogs.length
                    ? visibleLogs.map(log => buildSmartLogItemHtml(log, nodeById, nodeByImageUrl)).join('')
                    : `<div class="log-empty">${escapeHtml(tr('canvas.noLogs'))}</div>`;

                bindSmartPreviewImageFallbacks(list);
                bindSmartLogItemInteractions(list);
                bindSmartLogCopyHandlers(list);
                refreshIcons(list);
            }

            if(hasMoreLogs) list.insertAdjacentHTML('beforeend', `<div class="log-more">继续下滑加载更多（${visibleLogs.length}/${logs.length}）</div>`);

            renderedLogItems = visibleLogs.slice();
            renderedVisibleCount = visibleCount;

            if(previousScrollTop) list.scrollTop = previousScrollTop;
        }

        return Object.freeze({
            closeLightbox: closeSmartLogLightbox,
            preview: smartLogPreviewNode,
            renderList
        });
    }

    window.SmartCanvasLogView = Object.freeze({ create });
}());
