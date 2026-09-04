"""Canvas mutation rules shared by the smart-canvas HTTP surface.

This module deliberately has no FastAPI or filesystem dependency.  Routing,
authorization and persistence remain in ``main.py`` while version checks and
pure canvas mutations are testable in isolation.
"""
from typing import Any, Callable, Dict, Optional


def canvas_conflict_detail(canvas: Dict[str, Any], base_revision: int = 0, base_updated_at: int = 0) -> Optional[Dict[str, Any]]:
    """Return a 409 payload when a client snapshot is no longer current."""
    current_updated_at = int(canvas.get("updated_at") or 0)
    current_revision = int(canvas.get("revision") or 0)
    revision_conflict = bool(base_revision and current_revision and int(base_revision) != current_revision)
    legacy_conflict = bool(
        not base_revision and base_updated_at and current_updated_at
        and int(base_updated_at) < current_updated_at
    )
    if not (revision_conflict or legacy_conflict):
        return None
    return {
        "message": "画布已被其他页面更新，已拒绝旧版本覆盖。",
        "canvas": canvas,
        "updated_at": current_updated_at,
        "revision": current_revision,
    }


def apply_canvas_snapshot(canvas: Dict[str, Any], payload: Any, normalize_kind: Callable[[str], str]) -> Dict[str, Any]:
    """Apply the legacy full-save payload while retaining smart-only invariants."""
    canvas["title"] = (payload.title or canvas.get("title") or "未命名画布")[:80]
    canvas["icon"] = (payload.icon or canvas.get("icon") or "layers")[:32]
    canvas["kind"] = normalize_kind(canvas.get("kind"))
    canvas["nodes"] = payload.nodes
    canvas["connections"] = payload.connections
    canvas["viewport"] = payload.viewport if canvas["kind"] == "smart" else canvas.get("viewport") or {"x": 0, "y": 0, "scale": 1}
    canvas["settings"] = payload.settings or {}
    if payload.ui_state is not None:
        canvas["ui_state"] = payload.ui_state
    return canvas


def apply_canvas_patch(canvas: Dict[str, Any], payload: Any, normalize_kind: Callable[[str], str]) -> Dict[str, Any]:
    """Merge an incremental node patch without changing stable node order."""
    current_nodes = [node for node in (canvas.get("nodes") or []) if isinstance(node, dict) and node.get("id")]
    by_id = {str(node["id"]): node for node in current_nodes}
    order = [str(node["id"]) for node in current_nodes]
    deleted = {str(node_id) for node_id in payload.nodes_delete if str(node_id)}
    for node_id in deleted:
        by_id.pop(node_id, None)
    for node in payload.nodes_upsert:
        node_id = str(node.get("id") or "")
        if not node_id or node_id in deleted:
            continue
        if node_id not in by_id:
            order.append(node_id)
        by_id[node_id] = node
    canvas["nodes"] = [by_id[node_id] for node_id in order if node_id in by_id]

    for key in ("connections", "viewport", "settings", "ui_state"):
        value = getattr(payload, key)
        if value is not None:
            canvas[key] = value
    if payload.title is not None:
        canvas["title"] = (payload.title or canvas.get("title") or "未命名画布")[:80]
    if payload.icon is not None:
        canvas["icon"] = (payload.icon or canvas.get("icon") or "layers")[:32]
    canvas["kind"] = normalize_kind(canvas.get("kind"))
    return canvas
