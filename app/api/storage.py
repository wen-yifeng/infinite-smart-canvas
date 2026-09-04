"""存储/媒体/本地素材路由（Phase 1 自 main.py 拆出）。

路由处理器逐字搬移；Phase 1.2 已溶解 deps 间接层，引擎函数直接
import 自 app.application（见 DATA_CONTRACT.md §5）。
"""

import asyncio
import base64
import httpx
import mimetypes
import os
import re
import requests
import urllib
import uuid
from typing import List, Dict, Any
from PIL import Image, ImageOps
from fastapi import HTTPException, UploadFile, File, Form, Request
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from fastapi import APIRouter
from app.application.chat_engine import caption_image_with_provider
from app.application.local_assets import _local_upload_abs, _local_upload_caption_path, _local_upload_classification_path, _local_upload_item, _local_upload_kind_ext, _local_upload_safe_file_stem, _local_upload_safe_folder, _local_upload_safe_folder_name, _local_upload_safe_path, _local_upload_tree_and_items, _sniff_image_ext_bytes, _write_local_upload_classification, classify_asset_image_best_effort, classify_image_with_provider, import_local_image_file, normalize_local_image_path
from app.application.output_storage import MEDIA_PREVIEW_RESPONSE_HEADERS, STORAGE_IMAGE_EXTS, content_type_for_path, ensure_same_origin_request, filename_from_media_url, generate_video_preview_image, image_has_alpha, is_video_preview_file, local_media_file_by_basename, media_preview_cache_paths, output_file_from_url, output_path_for, output_url_for, sanitize_export_filename, storage_file_item, storage_file_path, storage_kind_dir, upload_local_video_to_cloud
from app.application.paths import MEDIA_PREVIEW_DIR

class CloudVideoUploadRequest(BaseModel):
    url: str = ""
    service: str = "auto"
class LocalImageImportRequest(BaseModel):
    path: str = ""
    paths: List[str] = Field(default_factory=list)
class LocalAssetCaptionRequest(BaseModel):
    names: List[str] = []
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = "描述图片"
class LocalAssetCaptionSaveRequest(BaseModel):
    name: str = ""
    caption: str = ""
class LocalAssetClassifyRequest(BaseModel):
    names: List[str] = []
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = ""
class LocalAssetUrlImportItem(BaseModel):
    url: str = ""
    name: str = ""
    data: str = ""          # 可选：base64 / dataURL，由插件在网页上下文里读取（blob: 等无法服务端下载的素材）
    content_type: str = ""  # 配合 data 使用，用于推断扩展名
class LocalAssetUrlImportRequest(BaseModel):
    items: List[LocalAssetUrlImportItem] = []
    folder: str = ""
    classify: bool = False
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = ""
class LocalAssetFolderRequest(BaseModel):
    parent: str = ""
    path: str = ""
    name: str = ""
class LocalAssetRenameRequest(BaseModel):
    path: str = ""
    name: str = ""



def create_storage_router():
    router = APIRouter()

    @router.get("/api/storage-files")
    async def list_storage_files(kind: str = "generated", offset: int = 0, limit: int = 80):
        root = storage_kind_dir(kind)
        os.makedirs(root, exist_ok=True)
        offset = max(0, int(offset or 0))
        limit = max(20, min(200, int(limit or 80)))
        items = []
        for current, dirs, files in os.walk(root):
            dirs[:] = sorted([d for d in dirs if not d.startswith(".") and not d.startswith("._")], key=str.lower)
            for name in sorted(files, key=str.lower):
                if name.startswith(".") or name.startswith("._"):
                    continue
                if os.path.splitext(name)[1].lower() not in STORAGE_IMAGE_EXTS:
                    continue
                item = storage_file_item(kind, root, os.path.join(current, name))
                if item:
                    items.append(item)
        items.sort(key=lambda item: item.get("created_at") or 0, reverse=True)
        total = len(items)
        page_items = items[offset:offset + limit]
        return {
            "kind": kind,
            "root": root,
            "items": page_items,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + len(page_items) < total,
        }
    @router.get("/api/storage-files/{kind}/{rel_path:path}")
    async def get_storage_file(kind: str, rel_path: str):
        path = storage_file_path(kind, rel_path)
        if not path or not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="文件不存在")
        return FileResponse(path, media_type=content_type_for_path(path))
    @router.post("/api/storage-files/delete")
    async def delete_storage_files(payload: Dict[str, Any]):
        kind = str((payload or {}).get("kind") or "").strip()
        rels = [str(item or "").strip() for item in ((payload or {}).get("items") or []) if str(item or "").strip()]
        if not rels:
            raise HTTPException(status_code=400, detail="请选择要删除的文件")
        removed = 0
        for rel in rels:
            path = storage_file_path(kind, rel)
            if not path or not os.path.isfile(path):
                continue
            try:
                os.remove(path)
                removed += 1
            except OSError:
                pass
        return {"removed": removed}
    @router.get("/api/media-preview")
    async def media_preview(url: str, w: int = 512):
        path = output_file_from_url(url)
        if not path or not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="媒体文件不存在")

        width = max(64, min(2048, int(w or 512)))
        webp_path, png_path = media_preview_cache_paths(path, width)

        if os.path.exists(webp_path):
            return FileResponse(webp_path, media_type="image/webp", headers=MEDIA_PREVIEW_RESPONSE_HEADERS)
        if os.path.exists(png_path):
            return FileResponse(png_path, media_type="image/png", headers=MEDIA_PREVIEW_RESPONSE_HEADERS)

        def _build_preview():
            # 同步 PIL 处理 + 落盘，放到线程里执行，避免阻塞事件循环（几十张首次生成会卡死整个 loop → 缩略图全空白）
            os.makedirs(MEDIA_PREVIEW_DIR, exist_ok=True)
            if is_video_preview_file(path):
                img = generate_video_preview_image(path, width)
            else:
                with Image.open(path) as source:
                    img = ImageOps.exif_transpose(source)
                    img.thumbnail((width, width), Image.LANCZOS)
                    img = img.convert("RGBA" if image_has_alpha(img) else "RGB")
            try:
                img.save(webp_path, format="WEBP", quality=80, method=1)   # method=1 生成更快（缩略图不追求极致压缩）
                return webp_path, "image/webp"
            except Exception:
                img.save(png_path, format="PNG")
                return png_path, "image/png"

        try:
            out_path, media_type = await asyncio.to_thread(_build_preview)
            return FileResponse(out_path, media_type=media_type, headers=MEDIA_PREVIEW_RESPONSE_HEADERS)
        except Exception as exc:
            raise HTTPException(status_code=415, detail=f"无法生成预览图：{exc}") from exc
    @router.get("/api/media-dimensions")
    async def media_dimensions(url: str):
        path = output_file_from_url(url)
        if not path or not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="媒体文件不存在")

        def _read_dimensions():
            with Image.open(path) as source:
                return ImageOps.exif_transpose(source).size

        try:
            width, height = await asyncio.to_thread(_read_dimensions)
        except Exception as exc:
            raise HTTPException(status_code=415, detail=f"无法读取媒体尺寸：{exc}") from exc
        return JSONResponse(
            {"w": int(width), "h": int(height)},
            headers={"Cache-Control": "public, max-age=86400"}
        )
    @router.get("/api/download-output")
    def download_output(request: Request, url: str, name: str = "", inline: bool = False):
        path = output_file_from_url(url)
        if not path:
            path = local_media_file_by_basename(filename_from_media_url(url, ""))
        if path:
            filename = sanitize_export_filename(os.path.basename(name) if name else os.path.basename(path), os.path.basename(path))
            return FileResponse(path, media_type=content_type_for_path(path), filename=None if inline else filename)
        # 远程文件：流式代理，绝不把整段视频/大文件读进内存（否则多个视频同时代理会撑爆内存、拖垮单进程服务）。
        parsed = urllib.parse.urlparse(str(url or "").strip())
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise HTTPException(status_code=400, detail="无效的下载地址")
        try:
            upstream_headers = {"User-Agent": "Infinite-Canvas/1.0"}
            range_header = request.headers.get("range")
            if range_header:
                upstream_headers["Range"] = range_header
            upstream = requests.get(
                url, stream=True, timeout=(10, 60),
                headers=upstream_headers,
            )
            upstream.raise_for_status()
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"远程文件下载失败：{exc}")
        content_type = upstream.headers.get("content-type") or "application/octet-stream"
        fallback = filename_from_media_url(url, "download.bin")
        filename = sanitize_export_filename(os.path.basename(name) if name else fallback, fallback)
        disposition = "inline" if inline else "attachment"
        headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{urllib.parse.quote(filename)}"}
        for key in ("content-range", "accept-ranges"):
            value = upstream.headers.get(key)
            if value:
                headers["-".join(part.capitalize() for part in key.split("-"))] = value

        def stream_remote():
            try:
                for chunk in upstream.iter_content(chunk_size=256 * 1024):
                    if chunk:
                        yield chunk
            finally:
                upstream.close()

        return StreamingResponse(stream_remote(), media_type=content_type, headers=headers, status_code=upstream.status_code)
    @router.post("/api/ai/upload")
    async def upload_ai_reference(files: List[UploadFile] = File(...)):
        uploaded = []
        image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
        video_exts = {".mp4", ".webm", ".mov", ".m4v", ".flv"}
        audio_exts = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
        doc_exts = {".pdf", ".txt", ".md", ".markdown", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".json", ".zip", ".yaml", ".yml", ".log"}
        max_upload_bytes = 50 * 1024 * 1024
        for file in files:
            content = await file.read()
            if not content:
                continue
            if len(content) > max_upload_bytes:
                raise HTTPException(status_code=413, detail=f"{file.filename or '文件'} 超过 50MB，无法上传")
            ext = os.path.splitext(file.filename or "")[1].lower()
            content_type = (file.content_type or "").lower()
            kind = "image"
            if ext in video_exts or content_type.startswith("video/"):
                kind = "video"
                if ext not in video_exts:
                    ext = ".webm" if "webm" in content_type else ".mov" if "quicktime" in content_type else ".mp4"
            elif ext in audio_exts or content_type.startswith("audio/"):
                kind = "audio"
                if ext not in audio_exts:
                    ext = ".wav" if "wav" in content_type else ".ogg" if "ogg" in content_type else ".m4a" if "mp4" in content_type else ".mp3"
            elif ext in image_exts or content_type.startswith("image/"):
                kind = "image"
                if ext not in image_exts:
                    ext = ".jpg" if "jpeg" in content_type else ".webp" if "webp" in content_type else ".gif" if "gif" in content_type else ".png"
            elif ext in doc_exts or content_type.startswith(("text/", "application/")):
                kind = "file"
                if not ext:
                    ext = mimetypes.guess_extension(content_type) or ".bin"
            else:
                kind = "file"
                if not ext:
                    ext = ".bin"
            filename = f"ai_ref_{uuid.uuid4().hex[:12]}{ext}"
            path = output_path_for(filename, "input")
            with open(path, "wb") as f:
                f.write(content)
            uploaded.append({"url": output_url_for(filename, "input"), "name": file.filename or filename, "kind": kind, "mime": content_type})
        return {"files": uploaded}
    @router.post("/api/ai/import-local-image")
    async def import_local_ai_reference(payload: LocalImageImportRequest, request: Request):
        ensure_same_origin_request(request)
        requested = [payload.path] if payload.path else []
        requested.extend(payload.paths or [])
        requested = [p for p in requested if str(p or "").strip()][:20]
        if not requested:
            raise HTTPException(status_code=400, detail="没有可导入的本地图片")
        return {"files": [import_local_image_file(normalize_local_image_path(path)) for path in requested]}
    @router.post("/api/cloud-video/upload")
    async def cloud_video_upload(payload: CloudVideoUploadRequest, request: Request):
        ensure_same_origin_request(request)
        return await upload_local_video_to_cloud(payload.url, payload.service)
    @router.post("/api/local-assets/upload")
    async def upload_local_assets(files: List[UploadFile] = File(...), folder: str = Form("")):
        uploaded = []
        folder_rel, folder_abs = _local_upload_safe_folder(folder)
        os.makedirs(folder_abs, exist_ok=True)
        for file in files:
            content = await file.read()
            if not content:
                continue
            kind, ext = _local_upload_kind_ext(file.filename, file.content_type)
            if kind is None:
                continue
            base = os.path.splitext(os.path.basename(file.filename or "file"))[0]
            base = re.sub(r"[^0-9A-Za-z一-鿿._-]+", "_", base).strip("_") or "file"
            base = base[:60]
            filename = f"up_{uuid.uuid4().hex[:12]}_{base}{ext}"
            rel_name = f"{folder_rel}/{filename}".lstrip("/")
            path = os.path.join(folder_abs, filename)
            with open(path, "wb") as f:
                f.write(content)
            if kind == "image":
                classification = await classify_asset_image_best_effort(path)
                if classification:
                    _write_local_upload_classification(rel_name, classification)
            uploaded.append(_local_upload_item(rel_name))
        return {"files": uploaded}
    @router.post("/api/local-assets/import-urls")
    async def import_local_assets_from_urls(payload: LocalAssetUrlImportRequest):
        uploaded = []
        results = []
        folder_rel, folder_abs = _local_upload_safe_folder(payload.folder)
        os.makedirs(folder_abs, exist_ok=True)
        timeout = httpx.Timeout(connect=20.0, read=120.0, write=30.0, pool=20.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers={"User-Agent": "Infinite-Canvas-Asset-Importer/1.0"}) as client:
            for entry in (payload.items or [])[:200]:
                src_url = str(entry.url or "").strip()
                inline_data = str(entry.data or "").strip()
                result = {"url": src_url, "ok": False, "file": "", "error": ""}
                if not inline_data and not src_url.startswith(("http://", "https://")):
                    result["error"] = "仅支持 http(s) 素材地址"
                    results.append(result)
                    continue
                try:
                    if inline_data:
                        # 插件已在网页上下文里把字节读成 base64（dataURL 形如 data:<ct>;base64,<payload>）
                        content_type = str(entry.content_type or "").split(";", 1)[0].strip().lower()
                        b64 = inline_data
                        if inline_data.startswith("data:"):
                            header, _, b64 = inline_data.partition(",")
                            if not content_type:
                                content_type = header[5:].split(";", 1)[0].strip().lower()
                        try:
                            content = base64.b64decode(b64, validate=False)
                        except Exception:
                            raise HTTPException(status_code=400, detail="素材数据无法解码")
                        name_path = urllib.parse.urlparse(src_url).path
                    else:
                        response = await client.get(src_url)
                        response.raise_for_status()
                        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                        content = response.content
                        name_path = urllib.parse.urlparse(src_url).path
                    kind, ext = _local_upload_kind_ext(name_path, content_type)
                    if kind == "image":
                        real = _sniff_image_ext_bytes(content[:16])   # 以真实内容为准，避免 webp 被叫成 .png 等
                        if real and not (real == ".jpg" and ext == ".jpeg"):
                            ext = real
                    if kind not in ("image", "video"):
                        raise HTTPException(status_code=400, detail=f"不是图片或视频资源：{content_type or src_url}")
                    if not content:
                        raise HTTPException(status_code=400, detail="素材内容为空")
                    # entry.name 可能自带扩展名（采集器常传完整文件名），先 splitext 去掉，否则会和下面拼接的 ext 叠成 .png.png
                    if entry.name:
                        base = os.path.splitext(entry.name)[0]
                    else:
                        base = os.path.splitext(os.path.basename(urllib.parse.unquote(name_path)))[0]
                    base = base or ("web-video" if kind == "video" else "web-image")
                    base = re.sub(r"[^0-9A-Za-z一-鿿._-]+", "_", base).strip("_") or ("web-video" if kind == "video" else "web-image")
                    base = base[:60]
                    # 兜底：若 base 末尾已是同一扩展名，去掉一层再拼，杜绝重复后缀
                    if ext and base.lower().endswith(ext.lower()):
                        base = base[:-len(ext)].rstrip(".") or ("web-video" if kind == "video" else "web-image")
                    filename = f"up_{uuid.uuid4().hex[:12]}_{base}{ext}"
                    rel_name = f"{folder_rel}/{filename}".lstrip("/")
                    path = os.path.join(folder_abs, filename)
                    with open(path, "wb") as f:
                        f.write(content)
                    if payload.classify and kind == "image":
                        classification = await classify_asset_image_best_effort(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
                        if classification:
                            _write_local_upload_classification(rel_name, classification)
                    item = _local_upload_item(rel_name)
                    uploaded.append(item)
                    result.update({"ok": True, "file": rel_name, "item": item})
                except HTTPException as exc:
                    result["error"] = str(exc.detail or "导入失败")
                except Exception as exc:
                    result["error"] = str(exc) or "导入失败"
                results.append(result)
        return {"ok": True, "count": len(uploaded), "files": uploaded, "items": results}
    @router.get("/api/local-assets")
    async def list_local_assets():
        tree, items = _local_upload_tree_and_items()
        return {"items": items, "tree": tree}
    @router.post("/api/local-assets/folders")
    async def create_local_asset_folder(payload: LocalAssetFolderRequest, request: Request):
        ensure_same_origin_request(request)
        parent_rel, parent_abs = _local_upload_safe_folder(payload.parent)
        if not os.path.isdir(parent_abs):
            raise HTTPException(status_code=404, detail="父文件夹不存在")
        name = _local_upload_safe_folder_name(payload.name)
        rel = f"{parent_rel}/{name}".lstrip("/")
        _, abs_path = _local_upload_safe_folder(rel)
        if os.path.exists(abs_path):
            raise HTTPException(status_code=400, detail="同名文件夹已存在")
        os.makedirs(abs_path, exist_ok=False)
        tree, items = _local_upload_tree_and_items()
        return {"ok": True, "folder": {"path": rel, "name": name}, "tree": tree, "items": items}
    @router.patch("/api/local-assets/folders")
    async def rename_local_asset_folder(payload: LocalAssetFolderRequest, request: Request):
        ensure_same_origin_request(request)
        rel, abs_path = _local_upload_safe_folder(payload.path)
        if not rel:
            raise HTTPException(status_code=400, detail="根目录不能重命名")
        if not os.path.isdir(abs_path):
            raise HTTPException(status_code=404, detail="文件夹不存在")
        name = _local_upload_safe_folder_name(payload.name)
        parent = os.path.dirname(rel).replace("\\", "/")
        new_rel = f"{parent}/{name}".lstrip("/")
        _, new_abs = _local_upload_safe_folder(new_rel)
        if os.path.exists(new_abs):
            raise HTTPException(status_code=400, detail="同名文件夹已存在")
        os.rename(abs_path, new_abs)
        tree, items = _local_upload_tree_and_items()
        return {"ok": True, "folder": {"path": new_rel, "name": name}, "tree": tree, "items": items}
    @router.patch("/api/local-assets/items")
    async def rename_local_asset_item(payload: LocalAssetRenameRequest, request: Request):
        ensure_same_origin_request(request)
        rel, abs_path = _local_upload_safe_path(payload.path)
        if not os.path.isfile(abs_path):
            raise HTTPException(status_code=404, detail="本地素材不存在")
        kind, ext = _local_upload_kind_ext(rel, "")
        if kind is None:
            raise HTTPException(status_code=400, detail="不支持的素材类型")
        new_stem = _local_upload_safe_file_stem(payload.name)
        old_ext = os.path.splitext(rel)[1] or ext
        parent = os.path.dirname(rel).replace("\\", "/")
        new_rel = f"{parent}/{new_stem}{old_ext}".lstrip("/")
        if new_rel == rel:
            tree, items = _local_upload_tree_and_items()
            return {"ok": True, "item": _local_upload_item(rel), "tree": tree, "items": items}
        _, new_abs = _local_upload_abs(new_rel)
        if os.path.exists(new_abs):
            raise HTTPException(status_code=400, detail="同名素材已存在")
        os.rename(abs_path, new_abs)
        old_caption = _local_upload_caption_path(rel)
        new_caption = _local_upload_caption_path(new_rel)
        if os.path.isfile(old_caption) and not os.path.exists(new_caption):
            os.rename(old_caption, new_caption)
        old_classification = _local_upload_classification_path(rel)
        new_classification = _local_upload_classification_path(new_rel)
        if os.path.isfile(old_classification) and not os.path.exists(new_classification):
            os.rename(old_classification, new_classification)
        tree, items = _local_upload_tree_and_items()
        return {"ok": True, "item": _local_upload_item(new_rel), "old_path": rel, "tree": tree, "items": items}
    @router.post("/api/local-assets/delete")
    async def delete_local_assets(payload: dict, request: Request):
        ensure_same_origin_request(request)
        names = payload.get("names") if isinstance(payload, dict) else None
        if not isinstance(names, list):
            names = []
        deleted = []
        for name in names:
            try:
                rel, path = _local_upload_safe_path(name)
            except HTTPException:
                continue
            if os.path.isfile(path):
                try:
                    os.remove(path)
                    txt_path = _local_upload_caption_path(rel)
                    if os.path.isfile(txt_path):
                        os.remove(txt_path)
                    cls_path = _local_upload_classification_path(rel)
                    if os.path.isfile(cls_path):
                        os.remove(cls_path)
                    deleted.append(rel)
                except OSError:
                    pass
        return {"deleted": deleted}
    @router.post("/api/local-assets/move")
    async def move_local_assets(payload: dict, request: Request):
        """把选中的本地素材移动到目标文件夹（folder 为空表示根目录）；连同 .txt / .classification.json 兄弟文件一起搬。"""
        ensure_same_origin_request(request)
        names = payload.get("names") if isinstance(payload, dict) else None
        if not isinstance(names, list) or not names:
            raise HTTPException(status_code=400, detail="没有选择素材")
        folder_value = str(payload.get("folder") or "").strip() if isinstance(payload, dict) else ""
        target_rel, target_abs = _local_upload_safe_folder(folder_value)
        if target_rel and not os.path.isdir(target_abs):
            raise HTTPException(status_code=404, detail="目标文件夹不存在")
        moved = 0
        for name in names:
            try:
                rel, abs_path = _local_upload_safe_path(name)
            except HTTPException:
                continue
            if not os.path.isfile(abs_path):
                continue
            base = os.path.basename(rel)
            new_rel = f"{target_rel}/{base}".lstrip("/") if target_rel else base
            if new_rel == rel:
                continue  # 已在目标文件夹，跳过
            _, new_abs = _local_upload_abs(new_rel)
            if os.path.exists(new_abs):
                # 同名冲突：加短随机后缀，避免覆盖已有文件
                stem, ext = os.path.splitext(base)
                base = f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
                new_rel = f"{target_rel}/{base}".lstrip("/") if target_rel else base
                _, new_abs = _local_upload_abs(new_rel)
            try:
                os.makedirs(os.path.dirname(new_abs), exist_ok=True)
                os.rename(abs_path, new_abs)
                for src_sib, dst_sib in (
                    (_local_upload_caption_path(rel), _local_upload_caption_path(new_rel)),
                    (_local_upload_classification_path(rel), _local_upload_classification_path(new_rel)),
                ):
                    if os.path.isfile(src_sib) and not os.path.exists(dst_sib):
                        os.rename(src_sib, dst_sib)
                moved += 1
            except OSError:
                continue
        tree, items = _local_upload_tree_and_items()
        return {"ok": True, "moved": moved, "items": items, "tree": tree}
    @router.post("/api/local-assets/caption")
    async def caption_local_assets(payload: LocalAssetCaptionRequest):
        prompt = (payload.prompt or "描述图片").strip() or "描述图片"
        items = []
        ok_count = 0
        for name in (payload.names or [])[:100]:
            item = {"name": name, "ok": False, "caption": "", "caption_file": "", "error": ""}
            try:
                filename, path = _local_upload_safe_path(name)
                if not os.path.isfile(path):
                    raise HTTPException(status_code=404, detail="文件不存在")
                kind, _ = _local_upload_kind_ext(filename, "")
                if kind != "image":
                    raise HTTPException(status_code=400, detail="仅支持图片素材反推提示词")
                caption, resolved_model = await caption_image_with_provider(
                    path,
                    prompt,
                    payload.provider,
                    payload.model,
                    payload.ms_model,
                )
                txt_path = _local_upload_caption_path(filename)
                with open(txt_path, "w", encoding="utf-8", newline="") as f:
                    f.write(caption)
                item.update({
                    "ok": True,
                    "name": filename,
                    "caption": caption,
                    "caption_file": os.path.basename(txt_path),
                    "model": resolved_model,
                })
                ok_count += 1
            except HTTPException as exc:
                item["error"] = str(exc.detail or "反推失败")
            except Exception as exc:
                item["error"] = str(exc) or "反推失败"
            items.append(item)
        return {"ok": True, "count": ok_count, "items": items}
    @router.post("/api/local-assets/classify")
    async def classify_local_assets(payload: LocalAssetClassifyRequest):
        items = []
        ok_count = 0
        for name in (payload.names or [])[:80]:
            item = {"name": name, "ok": False, "classification": None, "classification_file": "", "error": ""}
            try:
                filename, path = _local_upload_safe_path(name)
                if not os.path.isfile(path):
                    raise HTTPException(status_code=404, detail="文件不存在")
                kind, _ = _local_upload_kind_ext(filename, "")
                if kind != "image":
                    raise HTTPException(status_code=400, detail="仅支持图片素材智能分类")
                classification = await classify_image_with_provider(
                    path,
                    payload.provider,
                    payload.model,
                    payload.ms_model,
                    payload.prompt,
                )
                _write_local_upload_classification(filename, classification)
                item.update({
                    "ok": True,
                    "name": filename,
                    "classification": classification,
                    "classification_file": os.path.basename(_local_upload_classification_path(filename)),
                    "model": classification.get("model") or "",
                })
                ok_count += 1
            except HTTPException as exc:
                item["error"] = str(exc.detail or "智能分类失败")
            except Exception as exc:
                item["error"] = str(exc) or "智能分类失败"
            items.append(item)
        return {"ok": True, "count": ok_count, "items": items}
    @router.patch("/api/local-assets/caption")
    async def save_local_asset_caption(payload: LocalAssetCaptionSaveRequest):
        filename, path = _local_upload_safe_path(payload.name)
        if not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="文件不存在")
        kind, _ = _local_upload_kind_ext(filename, "")
        if kind != "image":
            raise HTTPException(status_code=400, detail="仅支持图片素材保存提示词")
        caption = str(payload.caption or "")[:100000]
        txt_path = _local_upload_caption_path(filename)
        with open(txt_path, "w", encoding="utf-8", newline="") as f:
            f.write(caption)
        return {"ok": True, "caption": caption, "caption_file": os.path.basename(txt_path)}

    return router
