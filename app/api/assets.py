"""素材库路由（Phase 1 自 main.py 拆出）。

路由处理器逐字搬移；Phase 1.2 已溶解 deps 间接层，引擎函数直接
import 自 app.application（见 DATA_CONTRACT.md §5）。
"""

import asyncio
import base64
import json
import math
import os
import re
import shutil
import uuid
import time
import urllib.parse
import zipfile
from typing import Any, Dict, List, Optional

import httpx
import requests
from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from io import BytesIO
from pydantic import BaseModel, Field
from app.application.avatar_assets import check_apimart_avatar_task, check_volcengine_avatar_task, submit_apimart_avatar_asset, submit_volcengine_avatar_asset, volcengine_public_asset_url
from app.application.canvas_assets import canvas_assets_index
from app.application.common import now_ms
from app.application.local_assets import asset_library_media_kind, classify_asset_image_best_effort, classify_image_with_provider, find_asset_category_in_library, find_asset_category_with_library, find_asset_item_in_library, find_asset_library, load_asset_library, make_asset_library_item, remove_asset_library_file, sanitize_asset_name, save_asset_library, unique_asset_category_dir
from app.application.output_storage import fetch_remote_media_bytes, filename_from_media_url, local_media_file_by_basename, output_file_from_url, sanitize_export_filename
from app.application.paths import ASSET_LIBRARY_DIR, BASE_DIR
from app.application.prompt_library import builtin_prompt_templates, prompt_template_markdown_path
from app.application.provider_config import AVATAR_SUPPORTED_PLATFORMS, VIDEO_POLL_TIMEOUT, VOLCENGINE_DEFAULT_PROJECT_NAME, avatar_platform_for_provider, get_api_provider
from app.application.video_engine import upload_media_for_apimart, valid_apimart_video_image_input

class CanvasAssetDownloadRequest(BaseModel):
    urls: List[str] = []
    items: List[Dict[str, Any]] = []
    filename: str = "canvas-output-images.zip"
class AssetLibraryCategoryRequest(BaseModel):
    name: str = "新文件夹"
    type: str = "image"
    library_id: str = ""
class AssetLibraryRequest(BaseModel):
    name: str = "资产库"
class AssetLibraryAddRequest(BaseModel):
    category_id: str = ""
    url: str = ""
    name: str = ""
    library_id: str = ""
class AssetLibraryBatchAddRequest(BaseModel):
    category_id: str = ""
    library_id: str = ""
    items: List[AssetLibraryAddRequest] = []
class AssetLibraryRenameRequest(BaseModel):
    name: str = ""
    library_id: str = ""
class AssetLibraryBatchDeleteRequest(BaseModel):
    ids: List[str] = []
    library_id: str = ""
class AssetLibraryBatchMoveRequest(BaseModel):
    ids: List[str] = []
    library_id: str = ""
    target_library_id: str = ""
    target_category_id: str = ""
class AssetAvatarRegisterRequest(BaseModel):
    library_id: str = ""
    provider_id: str = ""
    project_name: str = "default"
    group_name: str = ""
class AssetLibraryClassifyRequest(BaseModel):
    library_id: str = ""
    ids: List[str] = []
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = ""



def create_assets_router():
    router = APIRouter()

    @router.get("/api/canvas-assets")
    async def list_canvas_assets():
        # canvas_assets_index 会同步遍历并解析所有画布 JSON，放进线程池避免阻塞事件循环
        # （否则画布多时一次请求就会卡住整个 asyncio loop，连 WebSocket 一起掉线）。
        return await asyncio.to_thread(canvas_assets_index)
    @router.get("/api/smart-canvas/prompt-templates")
    async def smart_canvas_prompt_templates():
        try:
            template_path = prompt_template_markdown_path()
            source = os.path.relpath(template_path, BASE_DIR).replace("\\", "/") if template_path else ""
            return {"templates": builtin_prompt_templates(), "source": source}
        except Exception as e:
            print(f"读取提示词模板失败: {e}")
            return {"templates": []}
    @router.post("/api/canvas-assets/download")
    async def download_canvas_assets(payload: CanvasAssetDownloadRequest):
        buffer = BytesIO()
        used_names = set()
        count = 0
        raw_items = payload.items or [{"url": url} for url in payload.urls]
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for raw in raw_items[:1000]:
                if isinstance(raw, dict):
                    text = str(raw.get("url") or "").strip()
                    requested_name = str(raw.get("name") or "").strip()
                else:
                    text = str(raw or "").strip()
                    requested_name = ""
                if not text:
                    continue
                path = output_file_from_url(text)
                content = None
                content_type = ""
                if path and os.path.isfile(path):
                    base = sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
                else:
                    local_by_name = local_media_file_by_basename(filename_from_media_url(text, ""))
                    if local_by_name and os.path.isfile(local_by_name):
                        path = local_by_name
                        base = sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
                    else:
                        try:
                            remote = fetch_remote_media_bytes(text)
                        except Exception:
                            remote = None
                        if not remote:
                            continue
                        content, content_type = remote
                        base = sanitize_export_filename(requested_name or filename_from_media_url(text, f"image-{count + 1}.bin"), f"image-{count + 1}.bin")
                name, ext = os.path.splitext(base)
                archive_name = base
                suffix = 2
                while archive_name in used_names:
                    archive_name = f"{name}-{suffix}{ext}"
                    suffix += 1
                used_names.add(archive_name)
                if path and os.path.isfile(path):
                    zf.write(path, archive_name)
                else:
                    zf.writestr(archive_name, content)
                count += 1
        if count <= 0:
            raise HTTPException(status_code=404, detail="没有可下载的本地图片")
        buffer.seek(0)
        filename = re.sub(r'[\\/:*?"<>|]+', "_", payload.filename or "canvas-output-images.zip")
        if not filename.lower().endswith(".zip"):
            filename += ".zip"
        encoded = urllib.parse.quote(filename)
        headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
        return Response(buffer.getvalue(), media_type="application/zip", headers=headers)
    @router.get("/api/asset-library")
    async def get_asset_library():
        return {"library": load_asset_library()}
    @router.post("/api/asset-library/libraries")
    async def create_asset_library(payload: AssetLibraryRequest):
        lib = load_asset_library()
        library = {"id": f"lib_{uuid.uuid4().hex[:12]}", "name": sanitize_asset_name(payload.name, "资产库"), "type": "asset", "categories": []}
        library["categories"].append({"id": f"cat_{uuid.uuid4().hex[:12]}", "name": "默认分组", "type": "image", "items": []})
        lib.setdefault("libraries", []).append(library)
        lib["active_library_id"] = library["id"]
        save_asset_library(lib)
        return {"library": lib, "asset_library": library}
    @router.patch("/api/asset-library/libraries/{library_id}")
    async def rename_asset_library(library_id: str, payload: AssetLibraryRenameRequest):
        lib = load_asset_library()
        library = find_asset_library(lib, library_id)
        if not library or library.get("id") != library_id:
            raise HTTPException(status_code=404, detail="资产库不存在")
        library["name"] = sanitize_asset_name(payload.name, library.get("name") or "资产库")
        save_asset_library(lib)
        return {"library": lib, "asset_library": library}
    @router.delete("/api/asset-library/libraries/{library_id}")
    async def delete_asset_library(library_id: str):
        lib = load_asset_library()
        libraries = lib.get("libraries") or []
        if len(libraries) <= 1:
            raise HTTPException(status_code=400, detail="至少保留一个资产库")
        if not any(item.get("id") == library_id for item in libraries):
            raise HTTPException(status_code=404, detail="资产库不存在")
        lib["libraries"] = [item for item in libraries if item.get("id") != library_id]
        if lib.get("active_library_id") == library_id:
            lib["active_library_id"] = lib["libraries"][0].get("id")
        save_asset_library(lib)
        return {"library": lib}
    @router.post("/api/asset-library/categories")
    async def create_asset_library_category(payload: AssetLibraryCategoryRequest):
        lib = load_asset_library()
        library = find_asset_library(lib, payload.library_id)
        if not library:
            raise HTTPException(status_code=404, detail="资产库不存在")
        category = {"id": f"cat_{uuid.uuid4().hex[:12]}", "name": sanitize_asset_name(payload.name, "新文件夹"), "type": "image", "items": []}
        category["dir"] = unique_asset_category_dir(library, payload.name)
        try:
            os.makedirs(os.path.join(ASSET_LIBRARY_DIR, category["dir"]), exist_ok=True)
        except Exception as exc:
            print(f"创建分组文件夹失败: {exc}")
        library.setdefault("categories", []).append(category)
        lib["active_library_id"] = library.get("id") or lib.get("active_library_id")
        save_asset_library(lib)
        return {"library": lib, "category": category}
    @router.patch("/api/asset-library/categories/{category_id}")
    async def rename_asset_library_category(category_id: str, payload: AssetLibraryRenameRequest):
        lib = load_asset_library()
        _, cat = find_asset_category_with_library(lib, category_id, payload.library_id)
        if not cat:
            raise HTTPException(status_code=404, detail="分类不存在")
        cat["name"] = sanitize_asset_name(payload.name, cat.get("name") or "新文件夹")
        save_asset_library(lib)
        return {"library": lib, "category": cat}
    @router.delete("/api/asset-library/categories/{category_id}")
    async def delete_asset_library_category(category_id: str, library_id: str = ""):
        lib = load_asset_library()
        library, cat = find_asset_category_with_library(lib, category_id, library_id)
        if not cat:
            raise HTTPException(status_code=404, detail="分类不存在")
        # 删除分组时一并清理该分组下的本地文件 + 分组文件夹，避免磁盘残留。
        for item in (cat.get("items") or []):
            remove_asset_library_file(item)
        cat_dir = str(cat.get("dir") or "").strip("/").strip()
        if cat_dir:
            try:
                target = os.path.join(ASSET_LIBRARY_DIR, cat_dir)
                if os.path.isdir(target) and os.path.abspath(target).startswith(os.path.abspath(ASSET_LIBRARY_DIR) + os.sep):
                    shutil.rmtree(target, ignore_errors=True)
            except Exception as exc:
                print(f"删除分组文件夹失败: {exc}")
        library["categories"] = [c for c in library.get("categories", []) if c.get("id") != category_id]
        save_asset_library(lib)
        return {"library": lib}
    @router.post("/api/asset-library/items")
    async def add_asset_library_item(payload: AssetLibraryAddRequest):
        lib = load_asset_library()
        cat = find_asset_category_in_library(lib, payload.category_id, payload.library_id)
        if not cat:
            raise HTTPException(status_code=404, detail="分类不存在")
        if cat.get("type") != "image":
            raise HTTPException(status_code=400, detail="该分类暂不支持添加媒体")
        src = output_file_from_url(payload.url)
        if not src:
            raise HTTPException(status_code=400, detail="只支持保存本地 /assets 或 /output 媒体")
        _, item = make_asset_library_item(src, payload.name or os.path.basename(src), subdir=cat.get("dir") or "")
        if item.get("kind") == "image":
            classification = await classify_asset_image_best_effort(output_file_from_url(item.get("url") or "") or src)
            if classification:
                item["classification"] = classification
        cat.setdefault("items", []).append(item)
        save_asset_library(lib)
        return {"library": lib, "item": item}
    @router.post("/api/asset-library/items/batch")
    async def batch_add_asset_library_items(payload: AssetLibraryBatchAddRequest):
        added = []
        lib = load_asset_library()
        cat = find_asset_category_in_library(lib, payload.category_id, payload.library_id)
        if not cat:
            raise HTTPException(status_code=404, detail="分类不存在")
        if cat.get("type") != "image":
            raise HTTPException(status_code=400, detail="该分类暂不支持添加媒体")
        for entry in (payload.items or [])[:200]:
            entry.category_id = payload.category_id
            entry.library_id = payload.library_id
            src = output_file_from_url(entry.url)
            if not src:
                continue
            _, item = make_asset_library_item(src, entry.name or os.path.basename(src), subdir=cat.get("dir") or "")
            if item.get("kind") == "image":
                classification = await classify_asset_image_best_effort(output_file_from_url(item.get("url") or "") or src)
                if classification:
                    item["classification"] = classification
            cat.setdefault("items", []).append(item)
            added.append(item)
        save_asset_library(lib)
        return {"library": lib, "items": added}
    @router.patch("/api/asset-library/items/{item_id}")
    async def rename_asset_library_item(item_id: str, payload: AssetLibraryRenameRequest):
        lib = load_asset_library()
        for library in lib.get("libraries", []):
            for cat in library.get("categories", []):
                for item in cat.get("items", []):
                    if item.get("id") == item_id:
                        item["name"] = sanitize_asset_name(payload.name, item.get("name") or "asset")
                        save_asset_library(lib)
                        return {"library": lib, "item": item}
        raise HTTPException(status_code=404, detail="资产不存在")
    @router.post("/api/asset-library/items/classify")
    async def classify_asset_library_items(payload: AssetLibraryClassifyRequest):
        lib = load_asset_library()
        results = []
        changed = False
        for item_id in (payload.ids or [])[:80]:
            item = find_asset_item_in_library(lib, item_id, payload.library_id)
            result = {"id": item_id, "ok": False, "classification": None, "error": ""}
            if not item:
                result["error"] = "资产不存在"
                results.append(result)
                continue
            if asset_library_media_kind(item.get("url") or "") != "image" and item.get("kind") != "image":
                result["error"] = "仅支持图片素材智能分类"
                results.append(result)
                continue
            path = output_file_from_url(item.get("url") or "")
            if not path or not os.path.isfile(path):
                result["error"] = "文件不存在"
                results.append(result)
                continue
            try:
                classification = await classify_image_with_provider(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
                item["classification"] = classification
                changed = True
                result.update({"ok": True, "classification": classification})
            except Exception as exc:
                result["error"] = str(getattr(exc, "detail", "") or exc)
            results.append(result)
        if changed:
            save_asset_library(lib)
        return {"library": lib, "count": sum(1 for item in results if item.get("ok")), "items": results}
    @router.post("/api/asset-library/items/{item_id}/register-avatar")
    async def register_asset_library_avatar(item_id: str, payload: AssetAvatarRegisterRequest):
        lib = load_asset_library()
        target_item = find_asset_item_in_library(lib, item_id, payload.library_id)
        if not target_item:
            raise HTTPException(status_code=404, detail="资产不存在")
        provider = get_api_provider(payload.provider_id)
        platform = avatar_platform_for_provider(provider)
        if platform not in AVATAR_SUPPORTED_PLATFORMS:
            name = (provider or {}).get("name") or (provider or {}).get("id") or "该平台"
            raise HTTPException(status_code=400, detail=f"「{name}」暂不支持数字人/真人认证（目前仅 APIMart 可用，火山等平台待接入官方资产 API）。")
        kind = str(target_item.get("kind") or "image").lower()
        if kind not in ("image", "video", "audio"):
            kind = "image"
        if platform == "apimart":
            project_name = str(payload.project_name or "default").strip() or "default"
            async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as client:
                public_url = await upload_media_for_apimart(client, provider, target_item.get("url") or "", kind)
            if not valid_apimart_video_image_input(public_url):
                reason = public_url[4:] if isinstance(public_url, str) and public_url.startswith("ERR:") else "无法获取公网可访问地址"
                raise HTTPException(status_code=400, detail=f"素材无法提交到 APIMart：{reason}\n请配置 PUBLIC_BASE_URL，或确认本地文件存在。")
            task_id = await submit_apimart_avatar_asset(
                provider, public_url, target_item.get("name") or "asset", kind,
                project_name=project_name, group_name=payload.group_name,
            )
        elif platform == "volcengine":
            # 火山以 API 设置里配置的 ProjectName 为准（必须与视频生成 key 的项目一致）
            project_name = str(provider.get("volcengine_project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME).strip() or VOLCENGINE_DEFAULT_PROJECT_NAME
            public_url = volcengine_public_asset_url(target_item.get("url") or "")
            if public_url.startswith("ERR:"):
                raise HTTPException(status_code=400, detail=public_url[4:])
            task_id = await submit_volcengine_avatar_asset(
                public_url, target_item.get("name") or "asset", kind,
                project_name=project_name, group_name=payload.group_name or "",
            )
        else:
            raise HTTPException(status_code=400, detail="该平台的认证后端尚未接入。")
        regs = target_item.get("registrations")
        if not isinstance(regs, dict):
            regs = {}
        regs[platform] = {
            "provider_id": provider["id"],
            "project_name": project_name,
            "task_id": task_id,
            "status": "Processing",
            "detail": "已提交，审核中",
            "asset_uri": "",
            "asset_id": "",
            "registered_at": now_ms(),
        }
        target_item["registrations"] = regs
        save_asset_library(lib)
        return {"library": lib, "item": target_item}
    @router.post("/api/asset-library/items/{item_id}/avatar-status")
    async def check_asset_library_avatar(item_id: str, payload: AssetAvatarRegisterRequest):
        lib = load_asset_library()
        target_item = find_asset_item_in_library(lib, item_id, payload.library_id)
        if not target_item:
            raise HTTPException(status_code=404, detail="资产不存在")
        regs = target_item.get("registrations") if isinstance(target_item.get("registrations"), dict) else {}
        provider = get_api_provider(payload.provider_id or "")
        platform = avatar_platform_for_provider(provider)
        if platform not in AVATAR_SUPPORTED_PLATFORMS:
            raise HTTPException(status_code=400, detail="该平台暂不支持数字人/真人认证审核。")
        reg = regs.get(platform) if isinstance(regs.get(platform), dict) else {}
        task_id = str(reg.get("task_id") or "").strip()
        if not task_id:
            raise HTTPException(status_code=400, detail="该素材还没有提交到这个平台的认证审核。")
        if platform == "apimart":
            result = await check_apimart_avatar_task(provider, task_id)
        elif platform == "volcengine":
            result = await check_volcengine_avatar_task(
                task_id, str(reg.get("project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME).strip() or VOLCENGINE_DEFAULT_PROJECT_NAME,
            )
        else:
            raise HTTPException(status_code=400, detail="该平台的认证后端尚未接入。")
        reg["status"] = result["status"]
        reg["detail"] = result.get("detail") or ""
        if result["status"] == "Active" and result.get("asset_uri"):
            reg["asset_uri"] = result["asset_uri"]
            reg["asset_id"] = result["asset_uri"].replace("asset://", "")
        regs[platform] = reg
        target_item["registrations"] = regs
        save_asset_library(lib)
        return {"library": lib, "item": target_item}
    @router.delete("/api/asset-library/items/{item_id}")
    async def delete_asset_library_item(item_id: str):
        lib = load_asset_library()
        removed = None
        for library in lib.get("libraries", []):
            for cat in library.get("categories", []):
                keep = []
                for item in cat.get("items", []):
                    if item.get("id") == item_id:
                        removed = item
                    else:
                        keep.append(item)
                cat["items"] = keep
        if not removed:
            raise HTTPException(status_code=404, detail="资产不存在")
        remove_asset_library_file(removed)  # 同时删除本地文件，避免磁盘上堆积
        save_asset_library(lib)
        return {"library": lib}
    @router.post("/api/asset-library/items/delete")
    async def batch_delete_asset_library_items(payload: AssetLibraryBatchDeleteRequest):
        ids = {str(item) for item in (payload.ids or []) if str(item)}
        if not ids:
            raise HTTPException(status_code=400, detail="没有选择资产")
        lib = load_asset_library()
        removed = 0
        removed_items = []
        for library in lib.get("libraries", []):
            if payload.library_id and library.get("id") != payload.library_id:
                continue
            for cat in library.get("categories", []):
                keep = []
                for item in cat.get("items", []):
                    if item.get("id") in ids:
                        removed += 1
                        removed_items.append(item)
                    else:
                        keep.append(item)
                cat["items"] = keep
        for item in removed_items:  # 批量删除同时清理本地文件
            remove_asset_library_file(item)
        save_asset_library(lib)
        return {"library": lib, "removed": removed}
    @router.post("/api/asset-library/items/move")
    async def batch_move_asset_library_items(payload: AssetLibraryBatchMoveRequest):
        ids = {str(item) for item in (payload.ids or []) if str(item)}
        if not ids:
            raise HTTPException(status_code=400, detail="没有选择资产")
        lib = load_asset_library()
        target_cat = find_asset_category_in_library(lib, payload.target_category_id, payload.target_library_id)
        if not target_cat:
            raise HTTPException(status_code=404, detail="目标分组不存在")
        target_type = target_cat.get("type") or "image"
        moved = []
        for library in lib.get("libraries", []):
            if payload.library_id and library.get("id") != payload.library_id:
                continue
            for cat in library.get("categories", []):
                if (cat.get("type") or "image") != target_type:
                    continue
                keep = []
                for item in cat.get("items", []):
                    if item.get("id") in ids:
                        moved.append(item)
                    else:
                        keep.append(item)
                cat["items"] = keep
        existing_ids = {item.get("id") for item in target_cat.get("items", [])}
        for item in moved:
            if item.get("id") not in existing_ids:
                target_cat.setdefault("items", []).append(item)
                existing_ids.add(item.get("id"))
        save_asset_library(lib)
        return {"library": lib, "moved": len(moved)}

    return router
