"""画布迁移与压缩包导入实现（Phase 1.2 自 main.py 机械搬移，未做语义改动）。"""

import json
import uuid
import hashlib
import urllib.request
import os
import zipfile
from pathlib import Path
from typing import List, Dict, Any
from io import BytesIO
from fastapi import HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
from app.domain.canvas_repository import CanvasRepositoryError
from app.application import runtime
from app.application.runtime import manager
from app.application.paths import OUTPUT_INPUT_DIR, OUTPUT_OUTPUT_DIR, ASSET_LIBRARY_DIR, LOCAL_UPLOAD_DIR, CANVAS_LOCK
from app.application.local_assets import _sha256_file
from app.application.output_storage import output_url_for
from app.application.common import now_ms


class CanvasMigrationRequest(BaseModel):
    source_canvas_id: str
    target_canvas_id: str
    selected_node_ids: List[str] = Field(default_factory=list)
def _connected_canvas_node_ids(canvas: Dict[str, Any], seed_ids: List[str]) -> set[str]:
    node_ids = {str(node.get("id")) for node in canvas.get("nodes", []) if isinstance(node, dict) and node.get("id")}
    pending = [str(node_id) for node_id in seed_ids if str(node_id) in node_ids]
    if not pending:
        raise HTTPException(status_code=400, detail="请选择至少一个有效节点")
    neighbors = {node_id: set() for node_id in node_ids}
    for connection in canvas.get("connections", []):
        if not isinstance(connection, dict):
            continue
        source = str(connection.get("from") or "")
        target = str(connection.get("to") or "")
        if source in neighbors and target in neighbors:
            neighbors[source].add(target)
            neighbors[target].add(source)
    result = set()
    while pending:
        node_id = pending.pop()
        if node_id in result:
            continue
        result.add(node_id)
        pending.extend(neighbors[node_id] - result)
    return result
def _node_bottom(node: Dict[str, Any]) -> float:
    try:
        top = float(node.get("y") or 0)
    except (TypeError, ValueError):
        top = 0
    try:
        height = float(node.get("h") or node.get("height") or 260)
    except (TypeError, ValueError):
        height = 260
    return top + max(80, height)
async def migrate_canvas_nodes_impl(payload: CanvasMigrationRequest):
    source_id = str(payload.source_canvas_id or "").strip()
    target_id = str(payload.target_canvas_id or "").strip()
    if not source_id or not target_id or source_id == target_id:
        raise HTTPException(status_code=400, detail="请选择不同的目标画布")
    with CANVAS_LOCK:
        try:
            source = runtime.CANVAS_APPLICATION_SERVICE.get(source_id)
            target = runtime.CANVAS_APPLICATION_SERVICE.get(target_id)
        except Exception as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        moved_ids = _connected_canvas_node_ids(source, payload.selected_node_ids)
        moved_nodes = [dict(node) for node in source.get("nodes", []) if str(node.get("id") or "") in moved_ids]
        moved_connections = [dict(connection) for connection in source.get("connections", []) if str(connection.get("from") or "") in moved_ids and str(connection.get("to") or "") in moved_ids]
        if not moved_nodes:
            raise HTTPException(status_code=400, detail="没有可迁移的节点")

        existing_ids = {str(node.get("id") or "") for node in target.get("nodes", [])}
        remapped_ids = {}
        for node in moved_nodes:
            node_id = str(node.get("id") or "")
            if node_id in existing_ids:
                new_id = uuid.uuid4().hex
                while new_id in existing_ids:
                    new_id = uuid.uuid4().hex
                remapped_ids[node_id] = new_id
                node["id"] = new_id
                existing_ids.add(new_id)
        for connection in moved_connections:
            connection["from"] = remapped_ids.get(str(connection.get("from") or ""), connection.get("from"))
            connection["to"] = remapped_ids.get(str(connection.get("to") or ""), connection.get("to"))

        min_x = min(float(node.get("x") or 0) for node in moved_nodes)
        min_y = min(float(node.get("y") or 0) for node in moved_nodes)
        target_bottom = max((_node_bottom(node) for node in target.get("nodes", []) if isinstance(node, dict)), default=-220)
        dx, dy = 160 - min_x, target_bottom + 220 - min_y
        for node in moved_nodes:
            node["x"] = round(float(node.get("x") or 0) + dx)
            node["y"] = round(float(node.get("y") or 0) + dy)

        original_source = json.loads(json.dumps(source))
        original_target = json.loads(json.dumps(target))
        source["nodes"] = [node for node in source.get("nodes", []) if str(node.get("id") or "") not in moved_ids]
        source["connections"] = [connection for connection in source.get("connections", []) if str(connection.get("from") or "") not in moved_ids and str(connection.get("to") or "") not in moved_ids]
        target["nodes"] = [*target.get("nodes", []), *moved_nodes]
        target["connections"] = [*target.get("connections", []), *moved_connections]
        try:
            runtime.CANVAS_APPLICATION_SERVICE.save(target)
            runtime.CANVAS_APPLICATION_SERVICE.save(source)
        except Exception as exc:
            try:
                runtime.CANVAS_REPOSITORY.save(original_target, bump_revision=False, touch_updated=False)
                runtime.CANVAS_REPOSITORY.save(original_source, bump_revision=False, touch_updated=False)
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="节点迁移未完成，已恢复原画布") from exc

    await manager.broadcast_canvas_updated(target_id, int(target.get("updated_at") or now_ms()), "canvas-migration")
    await manager.broadcast_canvas_updated(source_id, int(source.get("updated_at") or now_ms()), "canvas-migration")
    return {"ok": True, "target_canvas_id": target_id, "moved_node_ids": [str(node.get("id") or "") for node in moved_nodes]}
CANVAS_IMPORT_MAX_BYTES = 1024 * 1024 * 1024
CANVAS_IMPORT_MAX_FILES = 1002
def _canvas_import_asset_category(url: str) -> str:
    path = urllib.parse.urlparse(str(url or "")).path
    if path.startswith("/assets/input/"):
        return "input"
    if path.startswith(("/assets/output/", "/output/")):
        return "output"
    if path.startswith("/assets/library/"):
        return "library"
    if path.startswith("/assets/uploads/"):
        return "uploads"
    return ""
def _canvas_import_filename_for_hash(content_hash: str, extension: str, category: str) -> str:
    prefix = {"input": "ai_ref", "output": "canvas_output", "library": "canvas_library", "uploads": "canvas_upload"}[category]
    return f"{prefix}_{content_hash}{extension.lower()}"
def _existing_canvas_import_file(directory: str, content_hash: str) -> str:
    try:
        for candidate in Path(directory).iterdir():
            if candidate.is_file() and _sha256_file(candidate) == content_hash:
                return candidate.name
    except OSError:
        return ""
    return ""
def _materialize_canvas_import_asset(content: bytes, source_url: str, archive_name: str) -> tuple[str, bool, str]:
    category = _canvas_import_asset_category(source_url)
    if not category:
        return source_url, True, ""
    extension = os.path.splitext(archive_name)[1].lower() or os.path.splitext(urllib.parse.urlparse(source_url).path)[1].lower() or ".bin"
    content_hash = hashlib.sha256(content).hexdigest()
    directory = {
        "input": OUTPUT_INPUT_DIR,
        "output": OUTPUT_OUTPUT_DIR,
        "library": ASSET_LIBRARY_DIR,
        "uploads": LOCAL_UPLOAD_DIR,
    }[category]
    filename = _canvas_import_filename_for_hash(content_hash, extension, category)
    destination = os.path.join(directory, filename)
    def public_url(name: str) -> str:
        return output_url_for(name, category) if category in {"input", "output"} else f"/assets/{category}/{urllib.parse.quote(name)}"
    if os.path.isfile(destination):
        if _sha256_file(destination) != content_hash:
            raise HTTPException(status_code=500, detail="导入资源哈希冲突")
        return public_url(filename), True, ""
    existing = _existing_canvas_import_file(directory, content_hash)
    if existing:
        return public_url(existing), True, ""
    try:
        with open(destination, "xb") as handle:
            handle.write(content)
    except FileExistsError:
        if _sha256_file(destination) != content_hash:
            raise HTTPException(status_code=500, detail="导入资源哈希冲突")
        return public_url(filename), True, ""
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"写入导入资源失败: {exc}") from exc
    return public_url(filename), False, destination
def _rewrite_canvas_import_urls(value: Any, replacements: Dict[str, str]) -> Any:
    if isinstance(value, str):
        return replacements.get(value, replacements.get(value.split("?", 1)[0], value))
    if isinstance(value, list):
        return [_rewrite_canvas_import_urls(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: _rewrite_canvas_import_urls(item, replacements) for key, item in value.items()}
    return value
async def import_canvas_archive_impl(archive: UploadFile = File(...), project: str = Form("default")):
    filename = str(archive.filename or "").lower()
    if not filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="请选择画布资源 ZIP 包")
    payload = await archive.read(CANVAS_IMPORT_MAX_BYTES + 1)
    if len(payload) > CANVAS_IMPORT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="导入包超过 1GB 限制")
    created_files: List[str] = []
    created_canvas_id = ""
    created: Dict[str, Any] = {}
    completed = False
    try:
        with zipfile.ZipFile(BytesIO(payload)) as zf:
            infos = zf.infolist()
            if not infos or len(infos) > CANVAS_IMPORT_MAX_FILES:
                raise HTTPException(status_code=400, detail="导入包文件数量异常")
            if any(info.is_dir() or info.filename.startswith(("/", "\\")) or ".." in Path(info.filename).parts for info in infos):
                raise HTTPException(status_code=400, detail="导入包包含不安全路径")
            if sum(info.file_size for info in infos) > CANVAS_IMPORT_MAX_BYTES:
                raise HTTPException(status_code=413, detail="导入包解压后超过 1GB 限制")
            if "canvas.json" not in zf.namelist() or "resources-manifest.json" not in zf.namelist():
                raise HTTPException(status_code=400, detail="导入包缺少 canvas.json 或 resources-manifest.json")
            try:
                imported_canvas = json.loads(zf.read("canvas.json").decode("utf-8"))
                manifest = json.loads(zf.read("resources-manifest.json").decode("utf-8"))
            except (UnicodeDecodeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail="导入包中的画布数据无效") from exc
            if not isinstance(imported_canvas, dict) or not isinstance(manifest, dict):
                raise HTTPException(status_code=400, detail="导入包结构无效")
            replacements: Dict[str, str] = {}
            for item in manifest.get("resources", []):
                if not isinstance(item, dict):
                    continue
                source_url = str(item.get("url") or "").strip()
                category = _canvas_import_asset_category(source_url)
                if not category:
                    continue
                resource_name = str(item.get("file") or "").replace("\\", "/")
                if not resource_name.startswith("resources/") or resource_name not in zf.namelist():
                    raise HTTPException(status_code=400, detail=f"导入包缺少资源：{source_url}")
                target_url, reused, created_file = _materialize_canvas_import_asset(zf.read(resource_name), source_url, resource_name)
                replacements[source_url] = target_url
                if created_file:
                    created_files.append(created_file)
            imported_canvas = _rewrite_canvas_import_urls(imported_canvas, replacements)
            title = str(imported_canvas.get("title") or "智能画布").strip()[:76] or "智能画布"
            with CANVAS_LOCK:
                created = runtime.CANVAS_APPLICATION_SERVICE.create(f"{title}（导入）", str(imported_canvas.get("icon") or "sparkles"), "smart", project)
                created_canvas_id = str(created["id"])
                created.update({
                    "nodes": imported_canvas.get("nodes") if isinstance(imported_canvas.get("nodes"), list) else [],
                    "connections": imported_canvas.get("connections") if isinstance(imported_canvas.get("connections"), list) else [],
                    "viewport": imported_canvas.get("viewport") if isinstance(imported_canvas.get("viewport"), dict) else {"x": 0, "y": 0, "scale": 1},
                    "logs": imported_canvas.get("logs") if isinstance(imported_canvas.get("logs"), list) else [],
                    "settings": imported_canvas.get("settings") if isinstance(imported_canvas.get("settings"), dict) else {},
                })
                created = runtime.CANVAS_APPLICATION_SERVICE.save(created)
                completed = True
    except HTTPException:
        raise
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="导入包不是有效 ZIP 文件") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"导入画布失败: {exc}") from exc
    finally:
        if not completed:
            if created_canvas_id:
                try:
                    runtime.CANVAS_REPOSITORY.delete_file(created_canvas_id)
                except CanvasRepositoryError:
                    pass
            for path in created_files:
                try:
                    os.remove(path)
                except OSError:
                    pass
    await manager.broadcast_canvas_updated(created_canvas_id, int(created.get("updated_at") or now_ms()), "canvas-import")
    return {"ok": True, "canvas": created}
