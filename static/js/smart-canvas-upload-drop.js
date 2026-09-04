/*
 * smart-canvas-upload-drop.js — 上传/拖放域（Phase 2 P2.9，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createUploadDrop(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：DataTransfer 文件/文本/本地路径解析、拖放 payload 协议、上传、
 * 追加图片到节点、本地图片导入。
 */
export function createUploadDrop(ctx) {

    const {
        MEDIA_GROUP_DEFAULT_SCALE,
        MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE,
        MEDIA_NODE_DEFAULT_SCALE,
        SMART_UPLOAD_MAX,
        applyFixedSmartImageNodeSize,
        createImageNodeAt,
        dataTransferItemEntry,
        executeSmartCanvasCommand,
        filesFromEntry,
        isSmartImageNode,
        isSupportedUploadFile,
        render,
        scheduleSave,
        selectedNode,
        smartCanvasAssetClient,
        smartCanvasUploadClient,
        toast,
        tr,
        viewportCenter
    } = ctx;

async function uploadFilesFromDataTransfer(dataTransfer){

    const items = [...(dataTransfer?.items || [])];

    const entries = items.map(dataTransferItemEntry).filter(Boolean);

    const raw = entries.length

        ? (await Promise.all(entries.map(filesFromEntry))).flat()

        : [...(dataTransfer?.files || [])];

    return raw.filter(isSupportedUploadFile);

}

function uploadTitleForItems(items, fallback='Upload'){

    const list = [...(items || [])];

    if(!list.length) return fallback;

    const kinds = new Set(list.map(item => item instanceof File ? mediaKindForFile(item) : mediaKindForItem(item)));

    if(kinds.size > 1) return list.length > 1 ? 'Media' : fallback;

    if(kinds.has('video')) return list.length > 1 ? 'Videos' : 'Video';

    if(kinds.has('audio')) return 'Audio';

    return list.length > 1 ? 'Group' : 'Image';

}

const SMART_IMAGE_DROP_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

const SMART_IMAGE_DROP_TEXT_TYPES = [

    'text/uri-list',

    'text/plain',

    'text/html',

    'DownloadURL',

    'text/x-moz-url',

    'text/x-file-url',

    'public.file-url',

    'public.url',

    'UniformResourceLocator',

    'FileName',

    'FileNameW'

];

const SMART_IMAGE_DROP_TYPE_HINT_RE = /^(?:files?|image\/.+|text\/(?:uri-list|html|plain|x-moz-url|x-file-url)|downloadurl|public\.(?:file-url|url)|uniformresourcelocator|filenamew?)$|application\/x-qt-(?:windows-mime|image)|application\/x-moz-file|com\.eagle/i;

function smartImageFilesFromDataTransfer(dataTransfer){

    return [...(dataTransfer?.files || [])].filter(isSupportedUploadFile);

}

function smartDropDataTypes(dataTransfer){

    return [...(dataTransfer?.types || [])].map(type => String(type || ''));

}

function readSmartDropData(dataTransfer, type){

    try { return dataTransfer?.getData?.(type) || ''; } catch(_) { return ''; }

}

function decodeSmartDropText(value){

    const text = String(value || '').trim();

    if(!text) return '';

    try { return decodeURIComponent(text); } catch(_) { return text; }

}

function smartDropTextFragments(value){

    const text = String(value || '').trim();

    if(!text) return [];

    const fragments = [];

    if(/<img|<a\s/i.test(text)){

        const doc = new DOMParser().parseFromString(text, 'text/html');

        doc.querySelectorAll('img[src],a[href]').forEach(el => fragments.push(el.getAttribute('src') || el.getAttribute('href') || ''));

    }

    text.split(/\r?\n/).forEach(line => {

        const item = line.trim();

        if(item) fragments.push(item);

    });

    const downloadUrl = text.match(/^image\/[^\s:]+:(.+)$/i);

    if(downloadUrl) fragments.push(downloadUrl[1]);

    return fragments;

}

function uniqueSmartDropValues(values){

    const seen = new Set();

    return values.filter(value => {

        const key = String(value || '').trim();

        if(!key || seen.has(key)) return false;

        seen.add(key);

        return true;

    });

}

function smartDropTextCandidates(dataTransfer){

    if(!dataTransfer) return [];

    const types = uniqueSmartDropValues([...SMART_IMAGE_DROP_TEXT_TYPES, ...smartDropDataTypes(dataTransfer)]);

    const values = types.map(type => readSmartDropData(dataTransfer, type)).filter(Boolean);

    return uniqueSmartDropValues(values.flatMap(smartDropTextFragments).map(decodeSmartDropText))

        .filter(s => s && !s.startsWith('#'));

}

function isRemoteSmartImageDropValue(value){

    const text = String(value || '').trim();

    return /^https?:\/\/.+/i.test(text) || /^data:image\//i.test(text) || /^blob:/i.test(text);

}

function isLocalSmartImageDropValue(value){

    const text = String(value || '').trim();

    if(!text) return false;

    let path = text;

    if(/^file:/i.test(path)){

        try {

            const url = new URL(path);

            if(url.protocol !== 'file:') return false;

            path = decodeURIComponent(url.pathname || path);

        } catch(_) {

            return false;

        }

    }

    if(/^\/[a-zA-Z]:[\\/]/.test(path)) path = path.slice(1);

    const clean = path.split(/[?#]/, 1)[0];

    const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(clean);

    const isPosixPath = clean.startsWith('/');

    return (isWindowsPath || isPosixPath) && SMART_IMAGE_DROP_EXT_RE.test(clean);

}

function smartLocalImagePathsFromDataTransfer(dataTransfer){

    return uniqueSmartDropValues(smartDropTextCandidates(dataTransfer).filter(isLocalSmartImageDropValue));

}

function smartImageNameFromUrl(url){

    try {

        const clean = String(url || '').split('?', 1)[0].split('#', 1)[0];

        return decodeURIComponent(clean.split('/').pop() || 'image');

    } catch(_) {

        return 'image';

    }

}

function smartImageDropPayload(dataTransfer){

    const files = smartImageFilesFromDataTransfer(dataTransfer);

    if(files.length) return {type:'files', files};

    const localPaths = smartLocalImagePathsFromDataTransfer(dataTransfer);

    if(localPaths.length) return {type:'localPaths', localPaths};

    const url = smartDropTextCandidates(dataTransfer).find(isRemoteSmartImageDropValue) || '';

    if(url) return {type:'url', url};

    return {type:'none'};

}

async function resolveSmartImageDropPayload(dataTransfer){

    const payload = smartImageDropPayload(dataTransfer);

    if(payload.type !== 'none') return payload;

    const files = await uploadFilesFromDataTransfer(dataTransfer);

    return files.length ? {type:'files', files} : payload;

}

function hasSmartImageDropData(dataTransfer){

    if(!dataTransfer) return false;

    if(smartImageFilesFromDataTransfer(dataTransfer).length) return true;

    const types = smartDropDataTypes(dataTransfer);

    if(types.some(type => SMART_IMAGE_DROP_TYPE_HINT_RE.test(type.toLowerCase()))) return true;

    return smartImageDropPayload(dataTransfer).type !== 'none';

}

function hasSmartAssetDrag(dataTransfer){

    return smartDropDataTypes(dataTransfer).includes('application/x-smart-asset');

}

function hasSmartInputThumbDrag(dataTransfer){

    return smartDropDataTypes(dataTransfer).includes('application/x-smart-input-thumb');

}

function setSmartDropCopyEffect(e, includeAsset=false){

    e.preventDefault();

    if(hasSmartInputThumbDrag(e.dataTransfer)) return;

    if(includeAsset && hasSmartAssetDrag(e.dataTransfer)){

        e.dataTransfer.dropEffect = 'copy';
        return;

    }
    if(hasSmartImageDropData(e.dataTransfer)){
        e.dataTransfer.dropEffect = 'copy';
    }

}

async function uploadFiles(files){

    const supported = [...(files || [])].filter(isSupportedUploadFile).slice(0, SMART_UPLOAD_MAX);

    if(!supported.length) return [];

    const uploaded = await smartCanvasUploadClient.uploadMany(
        supported.map(file => ({blob:file, name:file.name || 'media'}))
    );

    return uploaded.map((file, index) => ({

        ...file,

        kind:file.kind || mediaKindForFile(supported[index])

    }));

}

function appendImagesToSmartNode(uploaded, targetId='', opts={}){

    const images = [...(uploaded || [])].filter(file => file?.url);

    if(!images.length) return null;

    const result = executeSmartCanvasCommand('append-uploaded-media', () => {

        let node = ctx.nodes().find(n => n.id === targetId) || selectedNode();

        if(node && !isSmartImageNode(node)) node = null;

        if(opts.forceNew) node = null;

        if(!node){

            const center = opts.point || viewportCenter();

            node = createImageNodeAt(center, [], {skipUndo:true, skipRender:true, skipSave:true});

        }

        const previousCount = (node.images || []).length;

        const normalizedImages = images.map(file => ({...file, kind:file.kind || mediaKindForItem(file)}));
        const replaceSingleInput = Boolean(opts.replaceSingleInput);
        const manualRefs = Array.isArray(node.manualInputRefs) ? node.manualInputRefs : [];
        if(replaceSingleInput && manualRefs.length === 1){
            // Preserve completed output; only the explicit single input reference changes.
            node.manualInputRefs = [normalizedImages[0]];
        } else if(replaceSingleInput && previousCount === 1){
            node.images = [normalizedImages[0]];
            node.title = uploadTitleForItems(node.images, node.title || 'Image');
            applyFixedSmartImageNodeSize(node);
        } else {
            node.images = [...(node.images || []), ...normalizedImages];
        }

        if(!replaceSingleInput && node.images.length > 1){

            node.title = uploadTitleForItems(node.images, 'Group');

            if(previousCount <= 1 && (!Number.isFinite(Number(node.scale)) || Number(node.scale) === MEDIA_NODE_DEFAULT_SCALE || Number(node.scale) === MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE)){

                node.scale = MEDIA_GROUP_DEFAULT_SCALE;

            }

        }

        if(!replaceSingleInput && node.images.length === 1) node.title = uploadTitleForItems(node.images, node.title || 'Image');
        if(!replaceSingleInput && previousCount === 0) applyFixedSmartImageNodeSize(node);

        selectedId = node.id;

        selectedIds = [];

        selectedImage = {nodeId:'', index:-1};

        return node;

    }, {skipUndo:Boolean(opts.skipUndo), skipRender:true, skipSave:true});

    if(result){
        render({scope:'nodes', refreshConnections:false, refreshMinimap:true, refreshComposer:true});
        scheduleSave();
    }

    return result;

}

async function handleFiles(files, targetId='', opts={}){

    try {

        const fileList = [...(files || [])].filter(isSupportedUploadFile).slice(0, SMART_UPLOAD_MAX);

        if(!fileList.length) return null;

        const uploaded = await uploadFiles(fileList);

        if(!uploaded.length) return null;

        return appendImagesToSmartNode(uploaded.map((file, index) => ({...file, kind:file.kind || mediaKindForFile(fileList[index])})), targetId, opts);

    } catch(e) { toast(e.message || tr('smart.toastUploadFail')); return null; }

}

async function importSmartLocalImages(paths){

    if(!paths?.length) return [];

    const data = await smartCanvasAssetClient.importLocalImages(
        (paths || []).slice(0, SMART_UPLOAD_MAX),
        tr('smart.toastUploadFail')
    );

    return data.files || [];

}

async function handleSmartImageDropPayload(payload, targetId='', opts={}){

    try {

        let created = null;

        if(payload.type === 'files') created = await handleFiles(payload.files, targetId, opts);

        else if(payload.type === 'localPaths') {

            created = appendImagesToSmartNode(await importSmartLocalImages(payload.localPaths), targetId, opts);

        } else if(payload.type === 'url') {

            created = appendImagesToSmartNode([{url:payload.url, name:smartImageNameFromUrl(payload.url), kind:'image'}], targetId, opts);

        }

        return created;

    } catch(e) {

        toast(e.message || tr('smart.toastUploadFail'));

        return null;

    }

}

    return {
        smartDropDataTypes,
        smartImageNameFromUrl,
        resolveSmartImageDropPayload,
        hasSmartImageDropData,
        hasSmartAssetDrag,
        setSmartDropCopyEffect,
        uploadFiles,
        appendImagesToSmartNode,
        handleFiles,
        importSmartLocalImages,
        handleSmartImageDropPayload
    };

}
