"""画布记录/列表与画布素材抽取辅助（Phase 1.2 自 main.py 机械搬移，未做语义改动）。"""

import hashlib
import re
from app.domain.canvas_repository import CanvasRepositoryError
from app.application import runtime
from app.application.local_assets import asset_library_media_kind, sanitize_asset_name
from app.application.output_storage import filename_from_media_url, output_file_from_url
from app.application.common import now_ms


CANVAS_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
def is_smart_canvas(canvas):
    return str((canvas or {}).get("kind") or "").strip().lower() == "smart"
def normalize_canvas_kind(kind="smart"):
    # This distribution is intentionally smart-canvas-only.
    return "smart"
DEFAULT_PROJECT_ID = "default"
CANVAS_COLORS = {"", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink", "slate"}
def normalize_canvas_color(value):
    color = str(value or "").strip().lower()
    return color if color in CANVAS_COLORS else ""
def canvas_cover_url(data):
    """Return a lightweight cover URL without exposing canvas nodes in list responses."""
    nodes = data.get("nodes") if isinstance(data, dict) and isinstance(data.get("nodes"), list) else []
    candidates = []
    for node in reversed(nodes):
        if not isinstance(node, dict):
            continue
        for key in ("images", "outputs", "results", "media", "url", "src"):
            value = node.get(key)
            values = value if isinstance(value, list) else [value]
            for item in reversed(values):
                if isinstance(item, dict):
                    raw = item.get("url") or item.get("path") or item.get("src") or item.get("uri") or ""
                else:
                    raw = str(item or "")
                text = str(raw).strip()
                if text.startswith("@{"):
                    match = re.search(r"(?:^|[;{])\s*url=([^;}]+)", text)
                    text = match.group(1).strip() if match else ""
                if text.startswith(("/assets/", "/output/")):
                    if output_file_from_url(text):
                        candidates.append(text)
                elif text.startswith(("http://", "https://")):
                    candidates.append(text)
    # Generated results are more useful than source references when both exist.
    for prefix in ("/assets/output/", "/output/"):
        for value in candidates:
            if value.startswith(prefix):
                return value
    return candidates[0] if candidates else ""
def canvas_record(data):
    return {
        "id": data.get("id"),
        "title": data.get("title", "未命名画布"),
        "icon": data.get("icon", "🧩"),
        "kind": normalize_canvas_kind(data.get("kind")),
        "owner": str(data.get("owner") or "")[:40],
        "color": normalize_canvas_color(data.get("color")),
        "pinned": bool(data.get("pinned") or False),
        "project": str(data.get("project") or "").strip() or DEFAULT_PROJECT_ID,
        "board_x": data.get("board_x"),
        "board_y": data.get("board_y"),
        "created_at": data.get("created_at", 0),
        "updated_at": data.get("updated_at", 0),
        "deleted_at": data.get("deleted_at", 0),
        "sort_order": data.get("sort_order"),
        "node_count": len(data.get("nodes", [])),
        "cover_url": canvas_cover_url(data),
    }
def _canvas_summary(data):
    if not is_smart_canvas(data):
        return None
    return canvas_record(data)
def cleanup_expired_canvas_trash():
    cutoff = now_ms() - CANVAS_TRASH_RETENTION_MS
    for data in runtime.CANVAS_REPOSITORY.iter_documents(deleted=True):
        try:
            deleted_at = int(data.get("deleted_at") or 0)
        except (TypeError, ValueError):
            continue
        if deleted_at and deleted_at < cutoff:
            try:
                runtime.CANVAS_REPOSITORY.delete_file(data.get("id") or "")
            except CanvasRepositoryError:
                continue
def iter_canvas_records(include_deleted=False):
    cleanup_expired_canvas_trash()
    return runtime.CANVAS_REPOSITORY.list_summaries(deleted=include_deleted)
def _canvas_list_sort_key(item):
    """Keep the launcher order independent from editing, saving, or pin state."""
    try:
        order = int(item.get("sort_order"))
    except (TypeError, ValueError):
        order = None
    if order is not None and order >= 0:
        return (0, order, str(item.get("id") or ""))
    try:
        created_at = int(item.get("created_at") or 0)
    except (TypeError, ValueError):
        created_at = 0
    # Existing documents receive a deterministic, creation-time order until the
    # user first drags a card. Never use updated_at here.
    return (1, created_at, str(item.get("id") or ""))
def list_canvases():
    return sorted(iter_canvas_records(include_deleted=False), key=_canvas_list_sort_key)
def list_deleted_canvases():
    records = iter_canvas_records(include_deleted=True)
    return sorted(records, key=lambda item: item["deleted_at"], reverse=True)
def canvas_asset_url_value(value):
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("url", "path", "src", "uri", "output", "output_url", "outputUrl", "video", "video_url", "videoUrl"):
            text = str(value.get(key) or "").strip()
            if text:
                return text
    return ""
def canvas_asset_downloadable_url(url):
    text = str(url or "").strip()
    return text if text.startswith(("/output/", "/assets/", "http://", "https://")) else ""
def canvas_asset_kind(value, url=""):
    explicit = ""
    if isinstance(value, dict):
        explicit = str(value.get("kind") or value.get("mediaKind") or value.get("type") or "").lower()
    if "video" in explicit:
        return "video"
    if "audio" in explicit:
        return "audio"
    if "text" in explicit:
        return "text"
    return asset_library_media_kind(url or canvas_asset_url_value(value))
def canvas_asset_name(value, url="", fallback="asset"):
    if isinstance(value, dict):
        for key in ("name", "filename", "file", "title"):
            name = str(value.get(key) or "").strip()
            if name:
                return sanitize_asset_name(name, fallback)
    return sanitize_asset_name(filename_from_media_url(url, fallback), fallback)
def iter_canvas_asset_values(value, path=""):
    if isinstance(value, dict):
        url = canvas_asset_downloadable_url(canvas_asset_url_value(value))
        if url:
            yield path, value, url
        for key, child in value.items():
            if key in {"run", "runs", "settings", "params", "metadata", "meta", "prompt", "text", "caption", "logs"}:
                continue
            yield from iter_canvas_asset_values(child, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_canvas_asset_values(child, f"{path}[{index}]")
    elif isinstance(value, str):
        url = canvas_asset_downloadable_url(value)
        if url:
            yield path, value, url
def canvas_node_title(node):
    if not isinstance(node, dict):
        return ""
    return str(node.get("title") or node.get("name") or node.get("label") or node.get("type") or "节点")[:120]
def extract_canvas_assets(canvas):
    record = canvas_record(canvas)
    canvas_id = str(record.get("id") or "")
    items = []
    seen = set()
    nodes = canvas.get("nodes") if isinstance(canvas.get("nodes"), list) else []
    for node_index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or f"node_{node_index}")
        node_title = canvas_node_title(node)
        for field_path, raw, url in iter_canvas_asset_values(node):
            dedupe_key = url
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            kind = canvas_asset_kind(raw, url)
            if kind not in {"image", "video", "audio", "text"}:
                continue
            fallback = f"{record.get('title') or 'canvas'}-{len(items) + 1}"
            item = {
                "id": hashlib.sha1(f"{canvas_id}:{url}".encode("utf-8")).hexdigest()[:24],
                "url": url,
                "name": canvas_asset_name(raw, url, fallback),
                "kind": kind,
                "canvas_id": canvas_id,
                "canvas_title": record.get("title") or "未命名画布",
                "canvas_kind": record.get("kind") or "classic",
                "canvas_icon": record.get("icon") or "layers",
                "canvas_owner": record.get("owner") or "",
                "canvas_color": record.get("color") or "",
                "canvas_created_at": record.get("created_at") or 0,
                "canvas_updated_at": record.get("updated_at") or 0,
                "node_id": node_id,
                "node_title": node_title,
                "node_type": str(node.get("type") or ""),
                "source_path": field_path,
                "created_at": node.get("created_at") or record.get("updated_at") or record.get("created_at") or 0,
            }
            if isinstance(raw, dict):
                for key in ("natural_w", "natural_h", "width", "height", "size", "duration", "runMs"):
                    if raw.get(key) is not None:
                        item[key] = raw.get(key)
            items.append(item)
    return items
def canvas_assets_index():
    canvases = []
    items = []
    canvas_counts = {"all": 0, "smart": 0, "classic": 0}
    item_counts = {"all": 0, "smart": 0, "classic": 0}
    cleanup_expired_canvas_trash()
    for canvas in runtime.CANVAS_REPOSITORY.iter_documents(deleted=False):
        if not is_smart_canvas(canvas):
            continue
        record = canvas_record(canvas)
        canvas_items = extract_canvas_assets(canvas)
        record["asset_count"] = len(canvas_items)
        canvases.append(record)
        items.extend(canvas_items)
        kind = record.get("kind") or "classic"
        canvas_counts["all"] += 1
        canvas_counts[kind] = canvas_counts.get(kind, 0) + 1
        item_counts["all"] += len(canvas_items)
        item_counts[kind] = item_counts.get(kind, 0) + len(canvas_items)
    canvases.sort(key=lambda item: (0 if item.get("pinned") else 1, -int(item.get("updated_at") or item.get("created_at") or 0)))
    items.sort(key=lambda item: int(item.get("canvas_updated_at") or item.get("created_at") or 0), reverse=True)
    categories = [
        {"id": "all", "name": "全部画布", "count": item_counts.get("all", 0), "canvas_count": canvas_counts.get("all", 0)},
        {"id": "smart", "name": "智能画布", "count": item_counts.get("smart", 0), "canvas_count": canvas_counts.get("smart", 0)},
    ]
    return {"categories": categories, "canvases": canvases, "items": items}
