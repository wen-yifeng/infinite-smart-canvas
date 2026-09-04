/*
 * Smart Canvas asset/library transport adapter.
 *
 * UI state, active folders/categories, node mutation and rendering remain in
 * smart-canvas.js. This client owns only asset-related HTTP/FormData protocols.
 */
(function attachSmartCanvasAssetClient(root){
    const defaultFetch = root.SmartCanvasHttp.defaultFetch;

    const requireId = root.SmartCanvasHttp.requireId;

    const responseErrorMessage = root.SmartCanvasHttp.responseErrorMessage;

    class SmartCanvasAssetClient {
        constructor(options={}){
            this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : defaultFetch;
            this.FormDataCtor = options.FormDataCtor || root.FormData;
            this.libraryPath = options.libraryPath || '/api/asset-library';
            this.localPath = options.localPath || '/api/local-assets';
            this.canvasDownloadPath = options.canvasDownloadPath || '/api/canvas-assets/download';
            this.importLocalImagePath = options.importLocalImagePath || '/api/ai/import-local-image';
            this.cloudVideoUploadPath = options.cloudVideoUploadPath || '/api/cloud-video/upload';
        }

        async requestJson(url, options={}, fallback='请求失败'){
            const response = await this.fetchImpl(url, options);
            if(!response.ok) throw new Error(await responseErrorMessage(response, fallback));
            return response.json();
        }

        json(url, method, body, fallback){
            return this.requestJson(url, {
                method,
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(body),
            }, fallback);
        }

        uploadCloudVideo(url, service='auto'){
            const source = String(url ?? '').trim();
            if(!source) throw new Error('media url is required');
            return this.json(this.cloudVideoUploadPath, 'POST', {url:source, service:String(service || 'auto')}, '云端上传失败');
        }
        listLibrary(){
            return this.requestJson(this.libraryPath, {}, '素材库加载失败');
        }

        listLocalAssets(){
            return this.requestJson(this.localPath, {}, '本地素材加载失败');
        }

        renameLocalItem(path, name){
            return this.json(`${this.localPath}/items`, 'PATCH', {path, name}, '重命名失败');
        }

        renameLibraryItem(assetId, name){
            return this.json(`${this.libraryPath}/items/${requireId(assetId, 'asset id')}`, 'PATCH', {name}, '重命名失败');
        }

        deleteLibraryItem(assetId){
            return this.requestJson(`${this.libraryPath}/items/${requireId(assetId, 'asset id')}`, {method:'DELETE'}, '删除素材失败');
        }

        createLibraryItem(payload){
            return this.json(`${this.libraryPath}/items`, 'POST', payload, '保存素材失败');
        }

        uploadLocalFiles(folder, files, fallback='保存本地素材失败'){
            if(typeof this.FormDataCtor !== 'function') throw new Error('FormData is not available');
            const form = new this.FormDataCtor();
            form.append('folder', folder || '');
            (files || []).forEach(file => form.append('files', file, file?.name || 'media'));
            return this.requestJson(`${this.localPath}/upload`, {method:'POST', body:form}, fallback);
        }

        importLocalUrls(folder, items, fallback='保存本地素材失败'){
            return this.json(`${this.localPath}/import-urls`, 'POST', {folder:folder || '', items:items || []}, fallback);
        }

        deleteLocalItems(names, fallback='删除失败'){
            return this.json(`${this.localPath}/delete`, 'POST', {names:names || []}, fallback);
        }

        createLocalFolder(parent, name){
            return this.json(`${this.localPath}/folders`, 'POST', {parent:parent || '', name}, '新建文件夹失败');
        }

        renameLocalFolder(path, name){
            return this.json(`${this.localPath}/folders`, 'PATCH', {path:path || '', name}, '重命名文件夹失败');
        }

        createCategory(payload){
            return this.json(`${this.libraryPath}/categories`, 'POST', payload, '新建分类失败');
        }

        renameCategory(categoryId, name){
            return this.json(`${this.libraryPath}/categories/${requireId(categoryId, 'category id')}`, 'PATCH', {name}, '重命名分类失败');
        }

        importLocalImages(paths, fallback='导入本地图片失败'){
            return this.json(this.importLocalImagePath, 'POST', {paths:paths || []}, fallback);
        }

    }

    root.SmartCanvasAssetClient = SmartCanvasAssetClient;
    root.SmartCanvasAssetClientInternals = Object.freeze({requireId, responseErrorMessage});
})(typeof window !== 'undefined' ? window : globalThis);