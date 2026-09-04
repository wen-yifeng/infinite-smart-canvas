"""Pure domain primitives for the Infinite Smart Canvas.

This module intentionally has no FastAPI, filesystem, or provider dependency.
It is the first seam for migrating the legacy dictionary-shaped canvas into a
stable document model without changing the existing HTTP contract.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional

from app.domain.smart_canvas_node_registry import can_connect, normalize_agent_node
import time
import uuid

CANVAS_SCHEMA_VERSION = 2
DEFAULT_VIEWPORT = {"x": 0, "y": 0, "scale": 1}


class CanvasValidationError(ValueError):
    """Raised when a canvas document cannot be normalized safely."""


def now_ms() -> int:
    return int(time.time() * 1000)


def _text(value: Any, fallback: str, limit: int) -> str:
    text = str(value or "").strip()
    return (text or fallback)[:limit]


def normalize_canvas_document(raw: Mapping[str, Any] | None, *, default_kind: str = "smart") -> Dict[str, Any]:
    """Return a defensive, schema-versioned canvas dictionary.

    Unknown fields are retained for backward compatibility. The function is
    deliberately conservative: malformed node/connection entries are dropped
    rather than allowed to poison the whole document.
    """
    source = deepcopy(dict(raw or {}))
    canvas_id = _text(source.get("id"), uuid.uuid4().hex, 128)
    kind = "smart" if str(source.get("kind") or default_kind).lower() != "smart" else "smart"

    nodes: List[Dict[str, Any]] = []
    seen_ids = set()
    for node in source.get("nodes") or []:
        if not isinstance(node, Mapping):
            continue
        item = dict(node)
        node_id = str(item.get("id") or "").strip()
        if not node_id or node_id in seen_ids:
            continue
        item["id"] = node_id
        seen_ids.add(node_id)
        nodes.append(item)

    connections: List[Dict[str, Any]] = []
    for connection in source.get("connections") or []:
        if isinstance(connection, Mapping):
            connections.append(dict(connection))

    viewport = source.get("viewport")
    if not isinstance(viewport, Mapping):
        viewport = {}
    normalized_viewport = dict(DEFAULT_VIEWPORT)
    normalized_viewport.update({k: viewport[k] for k in ("x", "y", "scale") if k in viewport})
    try:
        normalized_viewport["x"] = float(normalized_viewport["x"])
        normalized_viewport["y"] = float(normalized_viewport["y"])
        normalized_viewport["scale"] = max(0.05, min(8.0, float(normalized_viewport["scale"])))
    except (TypeError, ValueError):
        normalized_viewport = dict(DEFAULT_VIEWPORT)

    settings = source.get("settings") if isinstance(source.get("settings"), Mapping) else {}
    source.update({
        "id": canvas_id,
        "title": _text(source.get("title"), "未命名画布", 80),
        "icon": _text(source.get("icon"), "layers", 32),
        "kind": kind,
        "nodes": nodes,
        "connections": connections,
        "viewport": normalized_viewport,
        "settings": deepcopy(dict(settings)),
        "schema_version": CANVAS_SCHEMA_VERSION,
        "created_at": int(source.get("created_at") or now_ms()),
        "updated_at": int(source.get("updated_at") or now_ms()),
        "revision": max(0, int(source.get("revision") or 0)),
    })
    return source


def validate_canvas_document(canvas: Mapping[str, Any]) -> List[str]:
    """Return validation errors without mutating the supplied document."""
    errors: List[str] = []
    if not isinstance(canvas, Mapping):
        return ["canvas must be an object"]
    if not str(canvas.get("id") or "").strip():
        errors.append("id is required")
    if not isinstance(canvas.get("nodes"), list):
        errors.append("nodes must be a list")
    if not isinstance(canvas.get("connections"), list):
        errors.append("connections must be a list")
    if not isinstance(canvas.get("viewport"), Mapping):
        errors.append("viewport must be an object")
    if int(canvas.get("revision") or 0) < 0:
        errors.append("revision cannot be negative")
    return errors


@dataclass(frozen=True)
class CanvasCommand:
    """A serializable user intent. Commands are the future undo/sync seam."""

    type: str
    payload: Dict[str, Any] = field(default_factory=dict)
    command_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created_at: int = field(default_factory=now_ms)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "command_id": self.command_id,
            "type": self.type,
            "payload": deepcopy(self.payload),
            "created_at": self.created_at,
        }


def _node_map(canvas: Mapping[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {
        str(node.get("id")): dict(node)
        for node in canvas.get("nodes", [])
        if isinstance(node, Mapping) and node.get("id")
    }


def apply_canvas_command(canvas: Mapping[str, Any], command: CanvasCommand) -> Dict[str, Any]:
    """Apply a small, deterministic command set to a canvas snapshot.

    This is intentionally not wired to every legacy UI action yet. It gives
    the migration a tested reducer while the old endpoints remain compatible.
    """
    result = normalize_canvas_document(canvas)
    payload = command.payload or {}
    nodes = _node_map(result)
    order = [str(node.get("id")) for node in result["nodes"] if node.get("id")]

    if command.type == "add_node":
        node = payload.get("node")
        if not isinstance(node, Mapping) or not str(node.get("id") or "").strip():
            raise CanvasValidationError("add_node requires payload.node.id")
        node_id = str(node["id"])
        if node_id in nodes:
            raise CanvasValidationError(f"node already exists: {node_id}")
        try:
            nodes[node_id] = normalize_agent_node(node)
        except ValueError as exc:
            raise CanvasValidationError(str(exc)) from exc
        order.append(node_id)
    elif command.type == "add_nodes":
        additions = payload.get("nodes")
        if not isinstance(additions, list) or not additions:
            raise CanvasValidationError("add_nodes requires a non-empty nodes list")
        placement = str(payload.get("placement") or "below_existing").strip().lower()
        if placement not in {"below_existing", "at_origin"}:
            raise CanvasValidationError("unsupported add_nodes placement")
        columns = max(1, min(12, int(payload.get("columns") or min(8, len(additions)))))
        gap_x = float(payload.get("gap_x") or 240)
        gap_y = float(payload.get("gap_y") or 40)
        edge_gap = float(payload.get("edge_gap") or 240)
        existing = list(nodes.values())
        base_x = min((float(node.get("x") or 0) for node in existing), default=0.0)
        lowest_edge = max(
            (float(node.get("y") or 0) + float(node.get("h") or 440) for node in existing),
            default=-edge_gap if placement == "below_existing" else 0.0,
        )
        base_y = lowest_edge + edge_gap if placement == "below_existing" else 0.0
        for index, raw_node in enumerate(additions):
            if not isinstance(raw_node, Mapping) or not str(raw_node.get("id") or "").strip():
                raise CanvasValidationError("add_nodes requires every node to have an id")
            candidate = dict(raw_node)
            node_id = str(candidate["id"])
            if node_id in nodes:
                raise CanvasValidationError(f"node already exists: {node_id}")
            width = float(candidate.get("w") or 440)
            height = float(candidate.get("h") or 440)
            if candidate.get("x") is None:
                candidate["x"] = base_x + (index % columns) * (width + gap_x)
            if candidate.get("y") is None:
                candidate["y"] = base_y + (index // columns) * (height + gap_y)
            try:
                nodes[node_id] = normalize_agent_node(candidate)
            except ValueError as exc:
                raise CanvasValidationError(str(exc)) from exc
            order.append(node_id)
    elif command.type == "update_node":
        node_id = str(payload.get("node_id") or "")
        patch = payload.get("patch")
        if node_id not in nodes or not isinstance(patch, Mapping):
            raise CanvasValidationError("update_node requires an existing node and patch")
        next_patch = deepcopy(dict(patch))
        if "id" in next_patch and str(next_patch["id"]) != node_id:
            raise CanvasValidationError("update_node cannot change node id")
        candidate = dict(nodes[node_id])
        candidate.update(next_patch)
        try:
            nodes[node_id] = normalize_agent_node(candidate)
        except ValueError as exc:
            raise CanvasValidationError(str(exc)) from exc
    elif command.type == "delete_nodes":
        deleted = {str(item) for item in payload.get("node_ids", []) if str(item).strip()}
        nodes = {node_id: node for node_id, node in nodes.items() if node_id not in deleted}
        order = [node_id for node_id in order if node_id in nodes]
        result["connections"] = [
            edge for edge in result["connections"]
            if str(edge.get("from") or edge.get("source") or edge.get("source_id") or "") not in deleted
            and str(edge.get("to") or edge.get("target") or edge.get("target_id") or "") not in deleted
        ]
    elif command.type == "move_nodes":
        items = payload.get("items")
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, Mapping):
                    continue
                node = nodes.get(str(item.get("id") or ""))
                if node is None:
                    continue
                if item.get("x") is not None:
                    node["x"] = float(item["x"])
                else:
                    node["x"] = float(node.get("x") or 0) + float(item.get("dx") or 0)
                if item.get("y") is not None:
                    node["y"] = float(item["y"])
                else:
                    node["y"] = float(node.get("y") or 0) + float(item.get("dy") or 0)
        else:
            dx = float(payload.get("dx") or 0)
            dy = float(payload.get("dy") or 0)
            for node_id in payload.get("node_ids", []):
                node = nodes.get(str(node_id))
                if node is not None:
                    node["x"] = float(node.get("x") or 0) + dx
                    node["y"] = float(node.get("y") or 0) + dy
    elif command.type == "connect_nodes":
        additions = payload.get("connections") or [payload]
        if not isinstance(additions, list):
            raise CanvasValidationError("connect_nodes requires connections")
        connections = [dict(edge) for edge in result["connections"] if isinstance(edge, Mapping)]
        signatures = {
            (str(edge.get("from") or edge.get("source") or edge.get("source_id") or ""),
             str(edge.get("to") or edge.get("target") or edge.get("target_id") or ""),
             str(edge.get("kind") or "flow"))
            for edge in connections
        }
        for edge in additions:
            if not isinstance(edge, Mapping):
                raise CanvasValidationError("connection must be an object")
            source_id = str(edge.get("fromNodeId") or edge.get("from") or edge.get("source") or edge.get("source_id") or "")
            target_id = str(edge.get("toNodeId") or edge.get("to") or edge.get("target") or edge.get("target_id") or "")
            kind = str(edge.get("kind") or "flow")
            if not source_id or not target_id or source_id == target_id or source_id not in nodes or target_id not in nodes:
                raise CanvasValidationError("connect_nodes requires two existing distinct nodes")
            try:
                allowed = can_connect(nodes[source_id], nodes[target_id])
            except ValueError as exc:
                raise CanvasValidationError(str(exc)) from exc
            if not allowed:
                raise CanvasValidationError(f"connection is not allowed: {source_id} -> {target_id}")
            signature = (source_id, target_id, kind)
            if signature not in signatures:
                connections.append({"from": source_id, "to": target_id, "kind": kind})
                signatures.add(signature)
        result["connections"] = connections
    elif command.type == "delete_connections":
        if bool(payload.get("all")):
            result["connections"] = []
        else:
            ids = {str(value) for value in payload.get("ids", []) if str(value)}
            source_id = str(payload.get("fromNodeId") or payload.get("from") or "")
            target_id = str(payload.get("toNodeId") or payload.get("to") or "")
            result["connections"] = [
                edge for edge in result["connections"]
                if not (
                    (ids and str(edge.get("id") or "") in ids)
                    or (source_id and target_id
                        and str(edge.get("from") or edge.get("source") or edge.get("source_id") or "") == source_id
                        and str(edge.get("to") or edge.get("target") or edge.get("target_id") or "") == target_id)
                )
            ]
    elif command.type == "set_viewport":
        viewport = payload.get("viewport")
        if not isinstance(viewport, Mapping):
            raise CanvasValidationError("set_viewport requires payload.viewport")
        result["viewport"] = dict(viewport)
    elif command.type == "set_connections":
        connections = payload.get("connections")
        if not isinstance(connections, list):
            raise CanvasValidationError("set_connections requires a list")
        result["connections"] = [dict(edge) for edge in connections if isinstance(edge, Mapping)]
    else:
        raise CanvasValidationError(f"unsupported canvas command: {command.type}")

    result["nodes"] = [nodes[node_id] for node_id in order if node_id in nodes]
    return normalize_canvas_document(result)


@dataclass(frozen=True)
class AssetRef:
    asset_id: str
    kind: str = "image"
    url: str = ""
    sha256: str = ""
    width: int = 0
    height: int = 0
    mime_type: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {key: value for key, value in {
            "asset_id": self.asset_id,
            "kind": self.kind,
            "url": self.url,
            "sha256": self.sha256,
            "width": self.width,
            "height": self.height,
            "mime_type": self.mime_type,
        }.items() if value not in ("", 0)}


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    canvas_id: str
    node_id: str
    status: str = "queued"
    provider_id: str = ""
    model: str = ""
    input_hash: str = ""
    progress: float = 0.0
    error: str = ""
    outputs: List[Dict[str, Any]] = field(default_factory=list)
    created_at: int = field(default_factory=now_ms)
    started_at: int = 0
    finished_at: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "canvas_id": self.canvas_id,
            "node_id": self.node_id,
            "status": self.status,
            "provider_id": self.provider_id,
            "model": self.model,
            "input_hash": self.input_hash,
            "progress": self.progress,
            "error": self.error,
            "outputs": deepcopy(self.outputs),
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }
