"""Headless-first control service for the local Smart Canvas Agent."""
from __future__ import annotations

from collections import deque
from copy import deepcopy
from threading import RLock
from typing import Any, Callable, Dict, List, Optional, Sequence
import html
import json
import time
import uuid

from app.application.canvas_service import CanvasApplicationError, CanvasApplicationService
from app.application.smart_canvas_image_staging import (
    SmartCanvasImageStageError,
    build_stage_commands,
    imported_reference_map,
    local_paths,
    prepare_stage_nodes,
)


class SmartCanvasAgentError(Exception):
    """Raised when an Agent request cannot be safely applied."""


class SmartCanvasAgentService:
    SESSION_TTL_MS = 12_000
    REQUEST_TTL_MS = 120_000
    MAX_CHECKPOINTS_PER_CANVAS = 20
    MAX_OPERATION_LOG = 200

    def __init__(
        self,
        canvas_service: CanvasApplicationService,
        import_local_images: Optional[Callable[[List[str]], List[Dict[str, Any]]]] = None,
    ) -> None:
        self.canvas_service = canvas_service
        self.import_local_images = import_local_images
        self._lock = RLock()
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._requests: Dict[str, Dict[str, Any]] = {}
        self._checkpoints: Dict[str, List[Dict[str, Any]]] = {}
        self._operations: List[Dict[str, Any]] = []
        self._idempotency: Dict[str, Dict[str, Any]] = {}

    @staticmethod
    def now_ms() -> int:
        return int(time.time() * 1000)

    @staticmethod
    def _operation_key(operation_id: Optional[str]) -> str:
        return str(operation_id or "").strip()

    def _effective_revision(self, canvas_id: str, base_revision: Optional[int]) -> int:
        """Use the caller revision when supplied; otherwise lock to latest persisted state."""
        if base_revision is not None:
            return int(base_revision)
        return int(self.canvas_service.get(canvas_id).get("revision") or 0)

    def _cleanup(self) -> None:
        now = self.now_ms()
        stale_sessions = [
            key for key, value in self._sessions.items()
            if now - int(value.get("heartbeat_at") or 0) > self.SESSION_TTL_MS * 4
        ]
        for key in stale_sessions:
            self._sessions.pop(key, None)
        for value in self._requests.values():
            if (
                now - int(value.get("created_at") or 0) > self.REQUEST_TTL_MS
                and value.get("status") in {"pending", "approved"}
            ):
                value["status"] = "expired"
                value["finished_at"] = now
                value["error"] = "页面处理超时"

    def heartbeat(
        self,
        client_id: str,
        canvas_id: str,
        selection: Dict[str, Any],
        page_url: str,
        visible: bool,
    ) -> Dict[str, Any]:
        client_id = str(client_id or "").strip()
        canvas_id = str(canvas_id or "").strip()
        if not client_id or not canvas_id:
            raise SmartCanvasAgentError("client_id and canvas_id are required")
        canvas = self.canvas_service.get(canvas_id)
        with self._lock:
            self._cleanup()
            session = {
                "client_id": client_id,
                "canvas_id": canvas_id,
                "selection": deepcopy(selection if isinstance(selection, dict) else {}),
                "page_url": str(page_url or "")[:1000],
                "visible": bool(visible),
                "heartbeat_at": self.now_ms(),
                "revision": int(canvas.get("revision") or 0),
                "updated_at": int(canvas.get("updated_at") or 0),
                "mode": "page",
            }
            self._sessions[client_id] = session
            return deepcopy(session)

    def close_session(self, client_id: str) -> None:
        with self._lock:
            self._sessions.pop(str(client_id or ""), None)

    def active_session(self) -> Dict[str, Any]:
        with self._lock:
            self._cleanup()
            now = self.now_ms()
            candidates = [
                value for value in self._sessions.values()
                if value.get("visible")
                and now - int(value.get("heartbeat_at") or 0) <= self.SESSION_TTL_MS
            ]
            if not candidates:
                raise SmartCanvasAgentError("没有可用的前台智能画布页面，请先打开当前画布")
            return deepcopy(max(candidates, key=lambda value: int(value.get("heartbeat_at") or 0)))

    def _target_page_session(
        self,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Resolve a live visible page session for UI-only actions."""
        requested_canvas = str(canvas_id or "").strip()
        requested_client = str(client_id or "").strip()
        with self._lock:
            self._cleanup()
            now = self.now_ms()
            if requested_client:
                session = self._sessions.get(requested_client)
                if (
                    not session
                    or not session.get("visible")
                    or now - int(session.get("heartbeat_at") or 0) > self.SESSION_TTL_MS
                ):
                    raise SmartCanvasAgentError("指定的画布页面会话已失效；定位、选区等页面动作仍需打开画布")
                session = deepcopy(session)
            elif requested_canvas:
                candidates = [
                    value for value in self._sessions.values()
                    if value.get("visible")
                    and str(value.get("canvas_id") or "") == requested_canvas
                    and now - int(value.get("heartbeat_at") or 0) <= self.SESSION_TTL_MS
                ]
                if not candidates:
                    raise SmartCanvasAgentError("指定画布没有可用的前台页面会话；该动作属于页面交互")
                session = deepcopy(max(candidates, key=lambda value: int(value.get("heartbeat_at") or 0)))
            else:
                return self.active_session()
        if requested_canvas and str(session.get("canvas_id") or "") != requested_canvas:
            raise SmartCanvasAgentError("client_id 与 canvas_id 不匹配")
        return session

    def _headless_session(self, canvas_id: str) -> Dict[str, Any]:
        canvas = self.canvas_service.get(canvas_id)
        return {
            "client_id": "",
            "canvas_id": str(canvas.get("id") or canvas_id),
            "selection": {},
            "page_url": "",
            "visible": False,
            "heartbeat_at": 0,
            "revision": int(canvas.get("revision") or 0),
            "updated_at": int(canvas.get("updated_at") or 0),
            "mode": "headless",
        }

    def _target_session(
        self,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Resolve persistent canvas access without requiring a visible page."""
        requested_canvas = str(canvas_id or "").strip()
        requested_client = str(client_id or "").strip()
        if not requested_canvas:
            return self._target_page_session(None, requested_client or None)

        # An explicit canvas_id is sufficient for persistent reads and writes.
        # Without an explicit client_id, always use a deterministic headless target
        # even when the same canvas happens to be open in a visible page.
        if not requested_client:
            return self._headless_session(requested_canvas)

        # A caller may explicitly bind persistent access to a live page session to
        # reuse its selection metadata. Hidden, stale, or missing sessions never
        # block backend access; a known mismatched client still fails safely.
        with self._lock:
            self._cleanup()
            now = self.now_ms()
            session = self._sessions.get(requested_client)
            if session and str(session.get("canvas_id") or "") != requested_canvas:
                raise SmartCanvasAgentError("client_id 与 canvas_id 不匹配")
            if (
                session
                and session.get("visible")
                and now - int(session.get("heartbeat_at") or 0) <= self.SESSION_TTL_MS
            ):
                page_session = deepcopy(session)
                page_session["mode"] = "page"
                return page_session

        return self._headless_session(requested_canvas)

    @staticmethod
    def _edge_ids(edge: Dict[str, Any]) -> tuple[str, str]:
        return (
            str(edge.get("from") or edge.get("source") or edge.get("source_id") or edge.get("fromNodeId") or ""),
            str(edge.get("to") or edge.get("target") or edge.get("target_id") or edge.get("toNodeId") or ""),
        )

    @staticmethod
    def _edge_signature(edge: Dict[str, Any]) -> tuple[str, str, str, str]:
        source, target = SmartCanvasAgentService._edge_ids(edge)
        return (source, target, str(edge.get("kind") or "flow"), str(edge.get("id") or ""))

    @staticmethod
    def _node_status(node: Dict[str, Any]) -> str:
        pending = node.get("pendingTasks") if isinstance(node.get("pendingTasks"), list) else []
        if node.get("running"):
            return "running"
        if node.get("queued") or node.get("pending"):
            return "queued"
        if any(item.get("failed") for item in pending if isinstance(item, dict)):
            return "failed"
        if node.get("runFinishedAt"):
            return "completed"
        return "idle"

    @classmethod
    def _node_summary(cls, node: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(node.get("id") or ""),
            "type": str(node.get("type") or "smart-image"),
            "title": str(node.get("title") or ""),
            "x": node.get("x", 0),
            "y": node.get("y", 0),
            "w": node.get("w"),
            "h": node.get("h"),
            "status": cls._node_status(node),
            "image_count": len(node.get("images") or []),
            "prompt_preview": str(node.get("promptDraftText") or node.get("runPrompt") or "")[:240],
        }

    @staticmethod
    def _selection_ids(selection: Dict[str, Any]) -> List[str]:
        selected_ids: List[str] = []
        primary_id = str(selection.get("primary_node_id") or selection.get("primary_id") or "")
        if primary_id:
            selected_ids.append(primary_id)
        values = selection.get("node_ids")
        if not isinstance(values, list):
            values = selection.get("ids") or []
        for value in values:
            node_id = str(value or "")
            if node_id and node_id not in selected_ids:
                selected_ids.append(node_id)
        return selected_ids

    @staticmethod
    def _canvas_bounds(canvas: Dict[str, Any]) -> Dict[str, float]:
        nodes = [node for node in canvas.get("nodes", []) if isinstance(node, dict)]
        if not nodes:
            return {"left": 0.0, "top": 0.0, "right": 0.0, "bottom": 0.0, "width": 0.0, "height": 0.0}
        left = min(float(node.get("x") or 0) for node in nodes)
        top = min(float(node.get("y") or 0) for node in nodes)
        right = max(float(node.get("x") or 0) + float(node.get("w") or 440) for node in nodes)
        bottom = max(float(node.get("y") or 0) + float(node.get("h") or 440) for node in nodes)
        return {"left": left, "top": top, "right": right, "bottom": bottom, "width": right - left, "height": bottom - top}

    @staticmethod
    def _public_checkpoint(checkpoint: Dict[str, Any]) -> Dict[str, Any]:
        return {key: deepcopy(value) for key, value in checkpoint.items() if key != "snapshot"}

    def _checkpoint_before_write(
        self,
        canvas: Dict[str, Any],
        *,
        operation_id: str = "",
        label: str = "Agent 操作前",
        purpose: str = "before_write",
    ) -> Dict[str, Any]:
        item = {
            "id": f"cp_{uuid.uuid4().hex}",
            "canvas_id": str(canvas.get("id") or ""),
            "revision": int(canvas.get("revision") or 0),
            "created_at": self.now_ms(),
            "label": str(label or "Agent 操作前")[:120],
            "purpose": str(purpose or "before_write"),
            "operation_id": str(operation_id or ""),
            "snapshot": deepcopy(canvas),
        }
        with self._lock:
            values = self._checkpoints.setdefault(item["canvas_id"], [])
            values.append(item)
            del values[:-self.MAX_CHECKPOINTS_PER_CANVAS]
        return self._public_checkpoint(item)

    def _idempotent_result(
        self,
        operation_id: Optional[str],
        *,
        kind: str,
        canvas_id: str,
    ) -> Optional[Dict[str, Any]]:
        key = self._operation_key(operation_id)
        if not key:
            return None
        with self._lock:
            record = deepcopy(self._idempotency.get(key))
        if not record:
            return None
        if record.get("kind") != kind or record.get("canvas_id") != canvas_id:
            raise SmartCanvasAgentError("operation_id 已被其他画布操作使用")
        if record.get("status") != "completed":
            raise SmartCanvasAgentError(str(record.get("error") or "该 operation_id 的先前操作未成功"))
        result = deepcopy(record.get("result") or {})
        if isinstance(result, dict):
            result["operation_id"] = key
            result["idempotent_replay"] = True
        return result

    def _record_operation(
        self,
        *,
        operation_id: str,
        kind: str,
        session: Dict[str, Any],
        status: str,
        result: Any = None,
        error: str = "",
        checkpoint: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        key = self._operation_key(operation_id) or f"op_{uuid.uuid4().hex}"
        record = {
            "operation_id": key,
            "kind": str(kind),
            "canvas_id": str(session.get("canvas_id") or ""),
            "client_id": str(session.get("client_id") or ""),
            "status": str(status),
            "created_at": self.now_ms(),
            "finished_at": self.now_ms(),
            "result": deepcopy(result),
            "error": str(error or ""),
            "checkpoint_id": str((checkpoint or {}).get("id") or ""),
        }
        with self._lock:
            self._operations.append(record)
            del self._operations[:-self.MAX_OPERATION_LOG]
            self._idempotency[key] = deepcopy(record)
        return deepcopy(record)

    def list_canvases(self, query: str = "", limit: int = 100) -> Dict[str, Any]:
        """List persistent smart canvases so Agents can resolve a target headlessly."""
        needle = str(query or "").strip().casefold()
        limit = max(1, min(200, int(limit or 100)))
        values = []
        for canvas in self.canvas_service.list():
            if not isinstance(canvas, dict):
                continue
            searchable = " ".join(
                str(canvas.get(key) or "")
                for key in ("id", "title", "project", "owner")
            ).casefold()
            if needle and needle not in searchable:
                continue
            values.append(deepcopy(canvas))
            if len(values) >= limit:
                break
        return {
            "query": str(query or ""),
            "count": len(values),
            "canvases": values,
            "execution_mode": "headless",
        }

    def state(
        self,
        detail: str = "summary",
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        canvas = self.canvas_service.get(session["canvas_id"])
        if str(detail).lower() == "full":
            canvas_payload: Dict[str, Any] = deepcopy(canvas)
        else:
            canvas_payload = {
                "id": canvas.get("id"),
                "title": canvas.get("title"),
                "revision": int(canvas.get("revision") or 0),
                "updated_at": int(canvas.get("updated_at") or 0),
                "viewport": deepcopy(canvas.get("viewport") or {}),
                "nodes": [self._node_summary(node) for node in canvas.get("nodes", []) if isinstance(node, dict)],
                "connections": deepcopy(canvas.get("connections") or []),
            }
        return {"session": session, "canvas": canvas_payload}

    def context(
        self,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        canvas = self.canvas_service.get(session["canvas_id"])
        bounds = self._canvas_bounds(canvas)
        selection = deepcopy(session.get("selection") or {})
        return {
            "canvas_id": session["canvas_id"],
            "client_id": session["client_id"],
            "title": str(canvas.get("title") or ""),
            "revision": int(canvas.get("revision") or 0),
            "updated_at": int(canvas.get("updated_at") or 0),
            "node_count": len(canvas.get("nodes") or []),
            "connection_count": len(canvas.get("connections") or []),
            "viewport": deepcopy(canvas.get("viewport") or {}),
            "selection": selection,
            "selected_node_ids": self._selection_ids(selection),
            "selection_available": str(session.get("mode") or "") == "page",
            "execution_mode": str(session.get("mode") or "headless"),
            "bounds": bounds,
            "lowest_edge": bounds["bottom"],
            "suggested_placement": {
                "mode": "below_existing",
                "x": bounds["left"],
                "y": bounds["bottom"] + 240 if canvas.get("nodes") else 0.0,
                "gap": 240,
            },
        }

    def selection(
        self,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_page_session(canvas_id, client_id)
        canvas = self.canvas_service.get(session["canvas_id"])
        selection = session.get("selection") or {}
        selected_ids = self._selection_ids(selection)
        by_id = {
            str(node.get("id")): node
            for node in canvas.get("nodes", [])
            if isinstance(node, dict) and node.get("id")
        }
        return {
            "canvas_id": session["canvas_id"],
            "client_id": session["client_id"],
            "revision": int(canvas.get("revision") or 0),
            "selection": deepcopy(selection),
            "nodes": [self._node_summary(by_id[node_id]) for node_id in selected_ids if node_id in by_id],
        }

    def upstream(
        self,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        selected = self.selection(canvas_id, client_id)
        canvas = self.canvas_service.get(selected["canvas_id"])
        selected_ids = {node["id"] for node in selected["nodes"]}
        upstream_ids = set()
        for edge in canvas.get("connections", []):
            if not isinstance(edge, dict):
                continue
            source, target = self._edge_ids(edge)
            if target in selected_ids and source:
                upstream_ids.add(source)
        by_id = {str(node.get("id")): node for node in canvas.get("nodes", []) if isinstance(node, dict) and node.get("id")}
        return {
            "canvas_id": selected["canvas_id"],
            "client_id": selected["client_id"],
            "revision": selected["revision"],
            "selected_node_ids": sorted(selected_ids),
            "upstream_node_ids": sorted(upstream_ids),
            "nodes": [self._node_summary(by_id[node_id]) for node_id in sorted(upstream_ids) if node_id in by_id],
        }

    def downstream(
        self,
        node_ids: Optional[Sequence[str]] = None,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        explicit_ids = [str(value) for value in (node_ids or []) if str(value)]
        session = (
            self._target_session(canvas_id, client_id)
            if explicit_ids
            else self._target_page_session(canvas_id, client_id)
        )
        canvas = self.canvas_service.get(session["canvas_id"])
        seeds = set(explicit_ids or self._selection_ids(session.get("selection") or {}))
        downstream_ids = set()
        for edge in canvas.get("connections", []):
            if isinstance(edge, dict):
                source, target = self._edge_ids(edge)
                if source in seeds and target:
                    downstream_ids.add(target)
        by_id = {str(node.get("id")): node for node in canvas.get("nodes", []) if isinstance(node, dict) and node.get("id")}
        return {
            "canvas_id": session["canvas_id"],
            "client_id": session["client_id"],
            "revision": int(canvas.get("revision") or 0),
            "source_node_ids": sorted(seeds),
            "downstream_node_ids": sorted(downstream_ids),
            "nodes": [self._node_summary(by_id[node_id]) for node_id in sorted(downstream_ids) if node_id in by_id],
        }

    def neighborhood(
        self,
        node_ids: Sequence[str],
        depth: int = 1,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        explicit_ids = [str(value) for value in node_ids if str(value)]
        session = (
            self._target_session(canvas_id, client_id)
            if explicit_ids
            else self._target_page_session(canvas_id, client_id)
        )
        canvas = self.canvas_service.get(session["canvas_id"])
        seeds = set(explicit_ids or self._selection_ids(session.get("selection") or {}))
        depth = max(0, min(10, int(depth)))
        adjacency: Dict[str, set[str]] = {}
        for edge in canvas.get("connections", []):
            if isinstance(edge, dict):
                source, target = self._edge_ids(edge)
                if source and target:
                    adjacency.setdefault(source, set()).add(target)
                    adjacency.setdefault(target, set()).add(source)
        visited = set(seeds)
        frontier = set(seeds)
        for _ in range(depth):
            frontier = {neighbor for node_id in frontier for neighbor in adjacency.get(node_id, set()) if neighbor not in visited}
            visited.update(frontier)
            if not frontier:
                break
        by_id = {str(node.get("id")): node for node in canvas.get("nodes", []) if isinstance(node, dict) and node.get("id")}
        found = sorted(node_id for node_id in visited if node_id in by_id)
        return {
            "canvas_id": session["canvas_id"],
            "client_id": session["client_id"],
            "revision": int(canvas.get("revision") or 0),
            "seed_node_ids": sorted(seeds),
            "depth": depth,
            "node_ids": found,
            "nodes": [self._node_summary(by_id[node_id]) for node_id in found],
        }

    def path(
        self,
        source_id: str,
        target_id: str,
        directed: bool = True,
        max_depth: int = 20,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        canvas = self.canvas_service.get(session["canvas_id"])
        source_id = str(source_id or "")
        target_id = str(target_id or "")
        by_id = {str(node.get("id")): node for node in canvas.get("nodes", []) if isinstance(node, dict) and node.get("id")}
        if source_id not in by_id or target_id not in by_id:
            raise SmartCanvasAgentError("source_id and target_id must identify existing nodes")
        adjacency: Dict[str, set[str]] = {}
        for edge in canvas.get("connections", []):
            if isinstance(edge, dict):
                source, target = self._edge_ids(edge)
                if source and target:
                    adjacency.setdefault(source, set()).add(target)
                    if not directed:
                        adjacency.setdefault(target, set()).add(source)
        max_depth = max(1, min(100, int(max_depth)))
        queue = deque([(source_id, [source_id])])
        visited = {source_id}
        found_path: List[str] = []
        while queue:
            current, current_path = queue.popleft()
            if current == target_id:
                found_path = current_path
                break
            if len(current_path) - 1 >= max_depth:
                continue
            for neighbor in sorted(adjacency.get(current, set())):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, current_path + [neighbor]))
        return {
            "canvas_id": session["canvas_id"],
            "client_id": session["client_id"],
            "revision": int(canvas.get("revision") or 0),
            "source_id": source_id,
            "target_id": target_id,
            "directed": bool(directed),
            "found": bool(found_path),
            "path_node_ids": found_path,
            "nodes": [self._node_summary(by_id[node_id]) for node_id in found_path],
        }

    @staticmethod
    def _node_payload(node: Dict[str, Any], include: str) -> Dict[str, Any]:
        include = str(include or "summary").lower()
        if include == "raw" or include == "all":
            return deepcopy(node)
        payload = SmartCanvasAgentService._node_summary(node)
        if include in {"prompt", "all"}:
            payload["prompt"] = str(node.get("promptDraftText") or node.get("runPrompt") or "")
        if include in {"images", "all"}:
            payload["images"] = deepcopy(node.get("images") or [])
        return payload

    def query_nodes(
        self,
        *,
        node_ids: Optional[Sequence[str]] = None,
        titles: Optional[Sequence[str]] = None,
        query: str = "",
        include: str = "summary",
        limit: int = 50,
        region: Optional[Dict[str, float]] = None,
        conditions: Optional[Dict[str, Any]] = None,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        canvas = self.canvas_service.get(session["canvas_id"])
        include = str(include or "summary").lower()
        if include not in {"summary", "prompt", "images", "raw", "all"}:
            raise SmartCanvasAgentError("include must be summary, prompt, images, raw or all")
        wanted_ids = {str(value) for value in (node_ids or []) if str(value)}
        wanted_titles = {str(value).casefold() for value in (titles or []) if str(value)}
        query_text = str(query or "").casefold().strip()
        conditions = conditions if isinstance(conditions, dict) else {}
        status_filter = str(conditions.get("status") or "").lower()
        has_images = conditions.get("has_images")
        has_upstream = conditions.get("has_upstream")
        has_downstream = conditions.get("has_downstream")
        upstream_ids: set[str] = set()
        downstream_ids: set[str] = set()
        for edge in canvas.get("connections", []):
            if isinstance(edge, dict):
                source, target = self._edge_ids(edge)
                if source and target:
                    downstream_ids.add(source)
                    upstream_ids.add(target)
        found: List[Dict[str, Any]] = []
        for node in canvas.get("nodes", []):
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("id") or "")
            title = str(node.get("title") or "")
            prompt = str(node.get("promptDraftText") or node.get("runPrompt") or "")
            if wanted_ids and node_id not in wanted_ids:
                continue
            if wanted_titles and title.casefold() not in wanted_titles:
                continue
            if query_text and query_text not in " ".join((node_id, title, prompt)).casefold():
                continue
            if region:
                x = float(node.get("x") or 0)
                y = float(node.get("y") or 0)
                w = float(node.get("w") or 440)
                h = float(node.get("h") or 440)
                rx = float(region.get("x") or 0)
                ry = float(region.get("y") or 0)
                rw = float(region.get("w") or 0)
                rh = float(region.get("h") or 0)
                if x + w < rx or y + h < ry or x > rx + rw or y > ry + rh:
                    continue
            if status_filter and self._node_status(node) != status_filter:
                continue
            if has_images is not None and bool(node.get("images")) != bool(has_images):
                continue
            if has_upstream is not None and (node_id in upstream_ids) != bool(has_upstream):
                continue
            if has_downstream is not None and (node_id in downstream_ids) != bool(has_downstream):
                continue
            found.append(self._node_payload(node, include))
        limit = max(1, min(500, int(limit)))
        total = len(found)
        found = found[:limit]
        return {
            "canvas_id": session["canvas_id"],
            "client_id": session["client_id"],
            "revision": int(canvas.get("revision") or 0),
            "matched_count": total,
            "returned_count": len(found),
            "node_ids": [str(node.get("id") or "") for node in found],
            "nodes": found,
        }

    def validate_ops(
        self,
        base_revision: Optional[int],
        operations: Any,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        before = self.canvas_service.get(session["canvas_id"])
        effective_revision = int(base_revision) if base_revision is not None else int(before.get("revision") or 0)
        after = self.canvas_service.preview_commands(session["canvas_id"], operations, effective_revision)
        before_nodes = {str(node.get("id")): node for node in before.get("nodes", []) if isinstance(node, dict) and node.get("id")}
        after_nodes = {str(node.get("id")): node for node in after.get("nodes", []) if isinstance(node, dict) and node.get("id")}
        before_edges = {self._edge_signature(edge) for edge in before.get("connections", []) if isinstance(edge, dict)}
        after_edges = {self._edge_signature(edge) for edge in after.get("connections", []) if isinstance(edge, dict)}
        common_ids = before_nodes.keys() & after_nodes.keys()
        updated_ids = sorted(
            node_id for node_id in common_ids
            if json.dumps(before_nodes[node_id], ensure_ascii=False, sort_keys=True, default=str)
            != json.dumps(after_nodes[node_id], ensure_ascii=False, sort_keys=True, default=str)
        )
        return {
            "valid": True,
            "canvas_id": session["canvas_id"],
            "client_id": session["client_id"],
            "execution_mode": str(session.get("mode") or "headless"),
            "base_revision": effective_revision,
            "estimated_revision": int(before.get("revision") or 0) + 1,
            "summary": {
                "before_node_count": len(before_nodes),
                "after_node_count": len(after_nodes),
                "added_node_ids": sorted(after_nodes.keys() - before_nodes.keys()),
                "deleted_node_ids": sorted(before_nodes.keys() - after_nodes.keys()),
                "updated_node_ids": updated_ids,
                "before_connection_count": len(before_edges),
                "after_connection_count": len(after_edges),
                "added_connection_count": len(after_edges - before_edges),
                "deleted_connection_count": len(before_edges - after_edges),
            },
        }

    def add_nodes_fast(
        self,
        base_revision: Optional[int],
        items: Any,
        placement: str = "below_existing",
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
        operation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        replay = self._idempotent_result(operation_id, kind="add_nodes_fast", canvas_id=session["canvas_id"])
        if replay is not None:
            replay["client_id"] = session["client_id"]
            replay.setdefault("execution_mode", "direct")
            return replay
        if not isinstance(items, list) or not items:
            raise SmartCanvasAgentError("nodes must be a non-empty list")
        if len(items) > 100:
            raise SmartCanvasAgentError("一次最多快速新增 100 个节点")
        placement = str(placement or "below_existing").strip().lower()
        if placement not in {"below_existing", "at_origin"}:
            raise SmartCanvasAgentError("placement must be below_existing or at_origin")
        created_nodes: List[Dict[str, Any]] = []
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise SmartCanvasAgentError(f"nodes[{index}] must be an object")
            raw_images = item.get("images") if isinstance(item.get("images"), list) else []
            images = [
                ({"url": image} if isinstance(image, str) else deepcopy(image))
                for image in raw_images if isinstance(image, (str, dict))
            ]
            prompt = str(item.get("prompt") or "")
            node: Dict[str, Any] = {
                "id": f"smart_agent_{uuid.uuid4().hex}",
                "type": "smart-image",
                "title": str(item.get("title") or item.get("node_title") or f"图片节点 {index + 1}")[:120],
                "promptDraftHtml": html.escape(prompt, quote=True),
                "promptDraftText": prompt,
                "images": images,
            }
            for key in ("x", "y", "w", "h"):
                if item.get(key) is not None:
                    node[key] = item[key]
            created_nodes.append(node)
        before = self.canvas_service.get(session["canvas_id"])
        effective_revision = int(base_revision) if base_revision is not None else int(before.get("revision") or 0)
        checkpoint = self._checkpoint_before_write(
            before,
            operation_id=self._operation_key(operation_id),
            label=f"快速新增 {len(created_nodes)} 个节点前",
        )
        try:
            canvas = self.canvas_service.apply_commands(
                session["canvas_id"],
                [{"type": "add_nodes", "payload": {"nodes": created_nodes, "placement": placement}}],
                effective_revision,
            )
            result = {
                "canvas_id": canvas.get("id"),
                "revision": int(canvas.get("revision") or 0),
                "updated_at": int(canvas.get("updated_at") or 0),
                "node_count": len(canvas.get("nodes") or []),
                "created_node_ids": [node["id"] for node in created_nodes],
                "created_node_count": len(created_nodes),
                "generation_started": False,
                "operation_id": self._operation_key(operation_id) or "",
                "checkpoint": checkpoint,
                "client_id": session["client_id"],
                "execution_mode": "direct",
            }
            record = self._record_operation(
                operation_id=self._operation_key(operation_id),
                kind="add_nodes_fast",
                session=session,
                status="completed",
                result=result,
                checkpoint=checkpoint,
            )
            result["operation_id"] = record["operation_id"]
            return result
        except Exception as exc:
            self._record_operation(
                operation_id=self._operation_key(operation_id),
                kind="add_nodes_fast",
                session=session,
                status="failed",
                error=str(exc),
                checkpoint=checkpoint,
            )
            raise

    def apply_ops_direct(
        self,
        base_revision: Optional[int],
        operations: Any,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
        operation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Apply a trusted operation batch directly, without a browser relay."""
        session = self._target_session(canvas_id, client_id)
        replay = self._idempotent_result(operation_id, kind="apply_ops", canvas_id=session["canvas_id"])
        if replay is not None:
            replay["client_id"] = session["client_id"]
            replay.setdefault("execution_mode", "direct")
            return replay
        if not isinstance(operations, list) or not operations:
            raise SmartCanvasAgentError("apply_ops requires a non-empty ops list")
        before = self.canvas_service.get(session["canvas_id"])
        effective_revision = int(base_revision) if base_revision is not None else int(before.get("revision") or 0)
        checkpoint = self._checkpoint_before_write(
            before,
            operation_id=self._operation_key(operation_id),
            label="通用原子操作前",
        )
        try:
            canvas = self.canvas_service.apply_commands(
                session["canvas_id"], operations, effective_revision
            )
            result = {
                "canvas_id": canvas.get("id"),
                "revision": int(canvas.get("revision") or 0),
                "updated_at": int(canvas.get("updated_at") or 0),
                "node_count": len(canvas.get("nodes") or []),
                "generation_started": False,
                "checkpoint": checkpoint,
                "client_id": session["client_id"],
                "execution_mode": "direct",
            }
            record = self._record_operation(
                operation_id=self._operation_key(operation_id),
                kind="apply_ops",
                session=session,
                status="completed",
                result=result,
                checkpoint=checkpoint,
            )
            result["operation_id"] = record["operation_id"]
            return result
        except Exception as exc:
            self._record_operation(
                operation_id=self._operation_key(operation_id),
                kind="apply_ops",
                session=session,
                status="failed",
                error=str(exc),
                checkpoint=checkpoint,
            )
            raise

    def stage_image_prompt_direct(
        self,
        base_revision: Optional[int],
        items: Any,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
        operation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Import references and stage smart-image nodes without a page relay."""
        session = self._target_session(canvas_id, client_id)
        replay = self._idempotent_result(operation_id, kind="stage_image_prompt", canvas_id=session["canvas_id"])
        if replay is not None:
            replay["client_id"] = session["client_id"]
            replay.setdefault("execution_mode", "direct")
            return replay
        if self.import_local_images is None:
            raise SmartCanvasAgentError("本地素材导入服务未配置")
        try:
            prepared = prepare_stage_nodes(items)
        except SmartCanvasImageStageError as exc:
            raise SmartCanvasAgentError(str(exc)) from exc
        current = self.canvas_service.get(session["canvas_id"])
        current_revision = int(current.get("revision") or 0)
        effective_revision = int(base_revision) if base_revision is not None else current_revision
        if current_revision != effective_revision:
            raise CanvasApplicationError({
                "message": "画布已发生变化，请重新读取后再暂存图生图节点",
                "expected_revision": effective_revision,
                "actual_revision": current_revision,
            })
        checkpoint = self._checkpoint_before_write(
            current,
            operation_id=self._operation_key(operation_id),
            label="暂存图生图节点前",
        )
        try:
            paths = local_paths(prepared)
            imported = self.import_local_images(paths) if paths else []
            imported_by_path = imported_reference_map(paths, imported)
            commands, staged_nodes = build_stage_commands(current, prepared, imported_by_path)
            canvas = self.canvas_service.apply_commands(
                session["canvas_id"], commands, effective_revision
            )
            result = {
                "canvas_id": canvas.get("id"),
                "revision": int(canvas.get("revision") or 0),
                "updated_at": int(canvas.get("updated_at") or 0),
                "node_count": len(canvas.get("nodes") or []),
                "staged_node_ids": [node.get("id") for node in staged_nodes],
                "staged_node_count": len(staged_nodes),
                "reference_count": sum(len(node.get("images") or []) for node in staged_nodes),
                "local_import_count": len(paths),
                "reused_import_count": sum(1 for image in imported if image.get("reused")),
                "generation_started": False,
                "checkpoint": checkpoint,
                "client_id": session["client_id"],
                "execution_mode": "direct",
            }
            record = self._record_operation(
                operation_id=self._operation_key(operation_id),
                kind="stage_image_prompt",
                session=session,
                status="completed",
                result=result,
                checkpoint=checkpoint,
            )
            result["operation_id"] = record["operation_id"]
            return result
        except Exception as exc:
            self._record_operation(
                operation_id=self._operation_key(operation_id),
                kind="stage_image_prompt",
                session=session,
                status="failed",
                error=str(exc),
                checkpoint=checkpoint,
            )
            raise

    def create_request(
        self,
        kind: str,
        payload: Dict[str, Any],
        base_revision: Optional[int] = None,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
        operation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        kind = str(kind or "").strip()
        if kind not in {"apply_ops", "focus_nodes", "stage_image_prompt"}:
            raise SmartCanvasAgentError(f"unsupported request kind: {kind}")
        session = self._target_page_session(canvas_id, client_id)
        operation_key = self._operation_key(operation_id)
        if operation_key:
            with self._lock:
                existing = next((deepcopy(value) for value in self._requests.values() if value.get("operation_id") == operation_key), None)
            if existing:
                if existing.get("kind") != kind or existing.get("canvas_id") != session["canvas_id"]:
                    raise SmartCanvasAgentError("operation_id 已被其他请求使用")
                existing["idempotent_replay"] = True
                return existing
            replay = self._idempotent_result(operation_key, kind=kind, canvas_id=session["canvas_id"])
            if replay is not None:
                return {
                    "id": f"replay_{operation_key}",
                    "kind": kind,
                    "operation_id": operation_key,
                    "client_id": session["client_id"],
                    "canvas_id": session["canvas_id"],
                    "base_revision": int(base_revision or 0),
                    "payload": {},
                    "status": "completed",
                    "created_at": self.now_ms(),
                    "finished_at": self.now_ms(),
                    "result": replay,
                    "error": "",
                    "idempotent_replay": True,
                }
        if kind == "apply_ops":
            operations = payload.get("ops") if isinstance(payload, dict) else None
            if not isinstance(operations, list) or not operations:
                raise SmartCanvasAgentError("apply_ops requires a non-empty ops list")
            if base_revision is None or int(base_revision) < 0:
                raise SmartCanvasAgentError("apply_ops requires base_revision")
        elif kind == "stage_image_prompt":
            if base_revision is None or int(base_revision) < 0:
                raise SmartCanvasAgentError("stage_image_prompt requires base_revision")
            if self.import_local_images is None:
                raise SmartCanvasAgentError("本地素材导入服务未配置")
            try:
                payload = {"nodes": prepare_stage_nodes(payload.get("nodes") if isinstance(payload, dict) else None)}
            except SmartCanvasImageStageError as exc:
                raise SmartCanvasAgentError(str(exc)) from exc
        request_id = uuid.uuid4().hex
        request = {
            "id": request_id,
            "kind": kind,
            "operation_id": operation_key,
            "client_id": session["client_id"],
            "canvas_id": session["canvas_id"],
            "base_revision": int(base_revision or 0),
            "payload": deepcopy(payload if isinstance(payload, dict) else {}),
            "status": "pending",
            "created_at": self.now_ms(),
            "finished_at": 0,
            "result": None,
            "error": "",
        }
        with self._lock:
            self._cleanup()
            self._requests[request_id] = request
        return deepcopy(request)

    def pending_requests(self, client_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            self._cleanup()
            return [
                deepcopy(value) for value in self._requests.values()
                if value.get("client_id") == client_id and value.get("status") == "pending"
            ]

    def get_request(self, request_id: str) -> Dict[str, Any]:
        with self._lock:
            self._cleanup()
            request = self._requests.get(str(request_id or ""))
            if not request:
                raise SmartCanvasAgentError("Agent 请求不存在")
            return deepcopy(request)

    def resolve(self, client_id: str, request_id: str, approved: bool) -> Dict[str, Any]:
        with self._lock:
            self._cleanup()
            request = self._requests.get(str(request_id or ""))
            if not request or request.get("client_id") != str(client_id or ""):
                raise SmartCanvasAgentError("Agent 请求与当前页面不匹配")
            if request.get("status") != "pending":
                return deepcopy(request)
            if not approved:
                request["status"] = "rejected"
                request["finished_at"] = self.now_ms()
                request["error"] = "页面拒绝写入"
                return deepcopy(request)
            request["status"] = "approved"
            request = deepcopy(request)

        session = {"client_id": request["client_id"], "canvas_id": request["canvas_id"]}
        checkpoint: Optional[Dict[str, Any]] = None
        try:
            if request["kind"] == "apply_ops":
                before = self.canvas_service.get(request["canvas_id"])
                checkpoint = self._checkpoint_before_write(
                    before,
                    operation_id=request.get("operation_id") or "",
                    label="通用原子操作前",
                )
                canvas = self.canvas_service.apply_commands(
                    request["canvas_id"],
                    request["payload"]["ops"],
                    request["base_revision"],
                )
                result = {
                    "canvas_id": canvas.get("id"),
                    "revision": int(canvas.get("revision") or 0),
                    "updated_at": int(canvas.get("updated_at") or 0),
                    "node_count": len(canvas.get("nodes") or []),
                    "generation_started": False,
                    "checkpoint": checkpoint,
                }
            elif request["kind"] == "stage_image_prompt":
                current = self.canvas_service.get(request["canvas_id"])
                current_revision = int(current.get("revision") or 0)
                if current_revision != int(request["base_revision"]):
                    raise CanvasApplicationError({
                        "message": "画布已发生变化，请重新读取后再暂存图生图节点",
                        "expected_revision": int(request["base_revision"]),
                        "actual_revision": current_revision,
                    })
                checkpoint = self._checkpoint_before_write(
                    current,
                    operation_id=request.get("operation_id") or "",
                    label="暂存图生图节点前",
                )
                items = request["payload"]["nodes"]
                paths = local_paths(items)
                imported = self.import_local_images(paths) if paths else []
                imported_by_path = imported_reference_map(paths, imported)
                commands, staged_nodes = build_stage_commands(current, items, imported_by_path)
                canvas = self.canvas_service.apply_commands(
                    request["canvas_id"], commands, request["base_revision"]
                )
                result = {
                    "canvas_id": canvas.get("id"),
                    "revision": int(canvas.get("revision") or 0),
                    "updated_at": int(canvas.get("updated_at") or 0),
                    "node_count": len(canvas.get("nodes") or []),
                    "staged_node_ids": [node.get("id") for node in staged_nodes],
                    "staged_node_count": len(staged_nodes),
                    "reference_count": sum(len(node.get("images") or []) for node in staged_nodes),
                    "local_import_count": len(paths),
                    "reused_import_count": sum(1 for image in imported if image.get("reused")),
                    "generation_started": False,
                    "checkpoint": checkpoint,
                }
            else:
                result = {
                    "canvas_id": request["canvas_id"],
                    "focused_node_ids": list(request["payload"].get("node_ids") or []),
                    "generation_started": False,
                }
            status = "completed"
            error = ""
        except Exception as exc:
            detail = exc.args[0] if exc.args else str(exc)
            if hasattr(exc, "detail"):
                detail = getattr(exc, "detail")
            result = None
            status = "failed"
            error = detail if isinstance(detail, str) else str(detail.get("message") or detail)

        operation_id = request.get("operation_id") or ""
        if request["kind"] != "focus_nodes":
            record = self._record_operation(
                operation_id=operation_id,
                kind=request["kind"],
                session=session,
                status=status,
                result=result,
                error=error,
                checkpoint=checkpoint,
            )
            if isinstance(result, dict):
                result["operation_id"] = record["operation_id"]

        with self._lock:
            stored = self._requests[request["id"]]
            stored["status"] = status
            stored["finished_at"] = self.now_ms()
            stored["result"] = result
            stored["error"] = error
            if not stored.get("operation_id") and request["kind"] != "focus_nodes":
                stored["operation_id"] = record["operation_id"]
            return deepcopy(stored)

    def list_checkpoints(
        self,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
        limit: int = 20,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        with self._lock:
            values = list(self._checkpoints.get(session["canvas_id"], []))
        values = values[-max(1, min(100, int(limit))):]
        values.reverse()
        return {
            "canvas_id": session["canvas_id"],
            "client_id": session["client_id"],
            "checkpoints": [self._public_checkpoint(value) for value in values],
        }

    def create_checkpoint(
        self,
        label: str = "手动检查点",
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        canvas = self.canvas_service.get(session["canvas_id"])
        checkpoint = self._checkpoint_before_write(canvas, label=label, purpose="manual")
        return {"canvas_id": session["canvas_id"], "client_id": session["client_id"], "checkpoint": checkpoint}

    def restore_checkpoint(
        self,
        checkpoint_id: str,
        base_revision: Optional[int],
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
        operation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        replay = self._idempotent_result(operation_id, kind="restore_checkpoint", canvas_id=session["canvas_id"])
        if replay is not None:
            replay["client_id"] = session["client_id"]
            replay.setdefault("execution_mode", "direct")
            return replay
        with self._lock:
            checkpoint = next(
                (deepcopy(value) for value in self._checkpoints.get(session["canvas_id"], []) if value.get("id") == checkpoint_id),
                None,
            )
        if not checkpoint:
            raise SmartCanvasAgentError("checkpoint 不存在或不属于当前画布")
        current = self.canvas_service.get(session["canvas_id"])
        effective_revision = int(base_revision) if base_revision is not None else int(current.get("revision") or 0)
        safety = self._checkpoint_before_write(
            current,
            operation_id=self._operation_key(operation_id),
            label="恢复检查点前安全备份",
            purpose="before_restore",
        )
        canvas = self.canvas_service.restore_snapshot(session["canvas_id"], checkpoint["snapshot"], effective_revision)
        result = {
            "canvas_id": canvas.get("id"),
            "revision": int(canvas.get("revision") or 0),
            "updated_at": int(canvas.get("updated_at") or 0),
            "restored_checkpoint_id": checkpoint_id,
            "safety_checkpoint": safety,
            "generation_started": False,
            "client_id": session["client_id"],
            "execution_mode": "direct",
        }
        record = self._record_operation(
            operation_id=self._operation_key(operation_id),
            kind="restore_checkpoint",
            session=session,
            status="completed",
            result=result,
            checkpoint=safety,
        )
        result["operation_id"] = record["operation_id"]
        return result

    def undo(
        self,
        base_revision: Optional[int],
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
        operation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        replay = self._idempotent_result(operation_id, kind="undo", canvas_id=session["canvas_id"])
        if replay is not None:
            replay["client_id"] = session["client_id"]
            replay.setdefault("execution_mode", "direct")
            return replay
        with self._lock:
            values = self._checkpoints.get(session["canvas_id"], [])
            index = next((index for index in range(len(values) - 1, -1, -1) if values[index].get("purpose") == "before_write"), -1)
            checkpoint = deepcopy(values[index]) if index >= 0 else None
        if not checkpoint:
            raise SmartCanvasAgentError("没有可撤销的 Agent 写入检查点")
        current = self.canvas_service.get(session["canvas_id"])
        effective_revision = int(base_revision) if base_revision is not None else int(current.get("revision") or 0)
        safety = self._checkpoint_before_write(
            current,
            operation_id=self._operation_key(operation_id),
            label="撤销前安全备份",
            purpose="before_restore",
        )
        canvas = self.canvas_service.restore_snapshot(session["canvas_id"], checkpoint["snapshot"], effective_revision)
        with self._lock:
            values = self._checkpoints.get(session["canvas_id"], [])
            self._checkpoints[session["canvas_id"]] = [value for value in values if value.get("id") != checkpoint.get("id")]
        result = {
            "canvas_id": canvas.get("id"),
            "revision": int(canvas.get("revision") or 0),
            "updated_at": int(canvas.get("updated_at") or 0),
            "undone_checkpoint_id": checkpoint["id"],
            "safety_checkpoint": safety,
            "generation_started": False,
            "client_id": session["client_id"],
            "execution_mode": "direct",
        }
        record = self._record_operation(
            operation_id=self._operation_key(operation_id),
            kind="undo",
            session=session,
            status="completed",
            result=result,
            checkpoint=safety,
        )
        result["operation_id"] = record["operation_id"]
        return result

    def operation_log(
        self,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
        limit: int = 50,
        kind: str = "",
        status: str = "",
    ) -> Dict[str, Any]:
        session = self._target_session(canvas_id, client_id)
        with self._lock:
            values = [deepcopy(value) for value in self._operations if value.get("canvas_id") == session["canvas_id"]]
        if kind:
            values = [value for value in values if value.get("kind") == kind]
        if status:
            values = [value for value in values if value.get("status") == status]
        values = values[-max(1, min(200, int(limit))):]
        values.reverse()
        return {"canvas_id": session["canvas_id"], "client_id": session["client_id"], "operations": values}
