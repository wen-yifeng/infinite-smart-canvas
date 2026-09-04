"""Application service for canvas lifecycle and persistence.

The service owns use-case semantics while the legacy ``main.py`` remains the
composition root.  It deliberately knows nothing about FastAPI so the same
rules can be exercised by HTTP handlers, background jobs, and tests.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from app.domain.canvas_domain import CanvasCommand, CanvasValidationError, apply_canvas_command

from app.domain.canvas_repository import CanvasJsonRepository, CanvasNotFoundError, CanvasRepositoryError
from app.domain.canvas_service import apply_canvas_patch, apply_canvas_snapshot, canvas_conflict_detail
from app.domain.canvas_log_repository import CanvasLogRepository, CanvasLogRepositoryError


class CanvasApplicationError(Exception):
    """Base error raised by the application service."""


class CanvasApplicationNotFound(CanvasApplicationError):
    """The requested canvas does not exist or is not available."""


class CanvasApplicationStorageError(CanvasApplicationError):
    """The canvas storage could not be read or written."""


@dataclass(frozen=True)
class CanvasServicePolicy:
    default_project_id: str = "default"
    default_title: str = "智能画布"
    default_icon: str = "sparkles"
    supported_kind: str = "smart"


class CanvasApplicationService:
    """Canvas lifecycle use cases backed by the repository boundary."""

    def __init__(
        self,
        repository: CanvasJsonRepository,
        now_ms: Callable[[], int],
        normalize_kind: Callable[[Optional[str]], str],
        normalize_color: Callable[[Any], str],
        canvas_record: Callable[[Dict[str, Any]], Dict[str, Any]],
        list_canvases: Callable[[], List[Dict[str, Any]]],
        list_deleted_canvases: Callable[[], List[Dict[str, Any]]],
        log_repository: Optional[CanvasLogRepository] = None,
        policy: CanvasServicePolicy | None = None,
    ) -> None:
        self.repository = repository
        self.now_ms = now_ms
        self.normalize_kind = normalize_kind
        self.normalize_color = normalize_color
        self.canvas_record = canvas_record
        self._list_canvases = list_canvases
        self._list_deleted_canvases = list_deleted_canvases
        self.log_repository = log_repository
        self.policy = policy or CanvasServicePolicy()

    def list(self) -> List[Dict[str, Any]]:
        return self._list_canvases()

    def list_deleted(self) -> List[Dict[str, Any]]:
        return self._list_deleted_canvases()

    def get(self, canvas_id: str, *, include_deleted: bool = False) -> Dict[str, Any]:
        try:
            canvas = self.repository.load(canvas_id, include_deleted=include_deleted)
        except CanvasNotFoundError as exc:
            raise CanvasApplicationNotFound(str(exc)) from exc
        except CanvasRepositoryError as exc:
            raise CanvasApplicationStorageError(str(exc)) from exc
        if self.normalize_kind(canvas.get("kind")) != self.policy.supported_kind:
            raise CanvasApplicationNotFound("该版本仅支持智能画布")
        return canvas

    def list_logs(self, canvas_id: str, offset: int = 0, limit: int = 40) -> Dict[str, Any]:
        self.get(canvas_id)
        logs = self.log_repository.load(canvas_id) if self.log_repository else []
        total = len(logs)
        start = max(0, min(int(offset or 0), total))
        end = max(start, min(total, start + max(1, int(limit or 40))))
        page = logs[start:end]
        summary = {"success": 0, "running": 0, "failed": 0}
        for entry in logs:
            status = str(entry.get("status") or "").lower()
            if status == "failed":
                summary["failed"] += 1
            elif status in ("running", "pending", "queued"):
                summary["running"] += 1
            elif status == "success":
                summary["success"] += 1
        return {"logs": page, "total": total, "summary": summary}

    def append_log(self, canvas_id: str, entry: Dict[str, Any]) -> Dict[str, Any]:
        self.get(canvas_id)
        if self.log_repository is None:
            raise CanvasApplicationStorageError("日志存储不可用")
        logs = self.log_repository.append(canvas_id, entry)
        return {"log": entry, "total": len(logs)}


    def _active_smart_canvases(self) -> List[Dict[str, Any]]:
        return [
            canvas for canvas in self.repository.iter_documents(deleted=False)
            if self.normalize_kind(canvas.get("kind")) == self.policy.supported_kind
        ]

    @staticmethod
    def _launcher_sort_key(canvas: Dict[str, Any]) -> tuple[int, int, str]:
        try:
            order = int(canvas.get("sort_order"))
        except (TypeError, ValueError):
            order = -1
        if order >= 0:
            return (0, order, str(canvas.get("id") or ""))
        try:
            created_at = int(canvas.get("created_at") or 0)
        except (TypeError, ValueError):
            created_at = 0
        return (1, created_at, str(canvas.get("id") or ""))

    def _ensure_active_sort_orders(self) -> List[Dict[str, Any]]:
        """Give legacy canvases one deterministic initial launcher order.

        Older documents have no ``sort_order``.  Materializing their existing
        creation-time order before appending a new card prevents the new card
        from jumping in front of those legacy entries.  This is launcher-only
        metadata, so it must not bump a canvas revision or updated timestamp.
        """
        active = sorted(self._active_smart_canvases(), key=self._launcher_sort_key)
        if all(self._launcher_sort_key(canvas)[0] == 0 for canvas in active):
            return active
        try:
            for index, canvas in enumerate(active):
                canvas["sort_order"] = index
            self.repository.save_many(active, bump_revision=False, touch_updated=False)
        except CanvasRepositoryError as exc:
            raise CanvasApplicationStorageError(str(exc)) from exc
        return active

    def _next_sort_order(self) -> int:
        # The first creation after an upgrade pins legacy creation-time order;
        # all later creations append after the user's current manual order.
        # Use max + 1 rather than count so deleting a middle card never lets a
        # later create/restore collide with an existing persistent position.
        active = self._ensure_active_sort_orders()
        orders = [self._launcher_sort_key(canvas)[1] for canvas in active]
        return max(orders, default=-1) + 1

    def create(
        self,
        title: str = "智能画布",
        icon: str = "sparkles",
        kind: str = "smart",
        project: Optional[str] = None,
        board_x: Optional[float] = None,
        board_y: Optional[float] = None,
    ) -> Dict[str, Any]:
        timestamp = self.now_ms()
        canvas_kind = self.normalize_kind(kind)
        canvas: Dict[str, Any] = {
            "id": __import__("uuid").uuid4().hex,
            "title": (title or (self.policy.default_title if canvas_kind == "smart" else "未命名画布"))[:80],
            "icon": (icon or (self.policy.default_icon if canvas_kind == "smart" else "🧩"))[:32],
            "kind": canvas_kind,
            "owner": "",
            "color": "",
            "pinned": False,
            "project": str(project or "").strip() or self.policy.default_project_id,
            "created_at": timestamp,
            "updated_at": timestamp,
            "revision": 0,
            "sort_order": self._next_sort_order(),
            "nodes": [],
            "connections": [],
            "viewport": {"x": 0, "y": 0, "scale": 1},
        }
        if board_x is not None:
            canvas["board_x"] = float(board_x)
        if board_y is not None:
            canvas["board_y"] = float(board_y)
        return self.save(canvas)

    def save(self, canvas: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return self.repository.save(canvas, bump_revision=True, touch_updated=True)
        except CanvasRepositoryError as exc:
            raise CanvasApplicationStorageError(str(exc)) from exc

    def update_snapshot(self, canvas_id: str, payload: Any) -> Dict[str, Any]:
        canvas = self.get(canvas_id)
        conflict = canvas_conflict_detail(canvas, payload.base_revision, payload.base_updated_at)
        if conflict:
            raise CanvasApplicationError(conflict)
        apply_canvas_snapshot(canvas, payload, self.normalize_kind)
        return self.save(canvas)

    def patch(self, canvas_id: str, payload: Any) -> Dict[str, Any]:
        canvas = self.get(canvas_id)
        conflict = canvas_conflict_detail(canvas, payload.base_revision, payload.base_updated_at)
        if conflict:
            raise CanvasApplicationError(conflict)
        apply_canvas_patch(canvas, payload, self.normalize_kind)
        return self.save(canvas)

    def preview_commands(self, canvas_id: str, commands: List[Dict[str, Any]], base_revision: int) -> Dict[str, Any]:
        """Validate and apply an Agent batch in memory without persisting it."""
        canvas = self.get(canvas_id)
        conflict = canvas_conflict_detail(canvas, base_revision, 0)
        if conflict:
            raise CanvasApplicationError(conflict)
        if not isinstance(commands, list) or not commands:
            raise CanvasApplicationError("操作列表不能为空")
        result = deepcopy(canvas)
        try:
            for raw in commands:
                if not isinstance(raw, dict):
                    raise CanvasValidationError("operation must be an object")
                command_type = str(raw.get("type") or "").strip()
                payload = raw.get("payload")
                if not command_type:
                    raise CanvasValidationError("operation type is required")
                if payload is None:
                    payload = {key: value for key, value in raw.items() if key != "type"}
                if not isinstance(payload, dict):
                    raise CanvasValidationError("operation payload must be an object")
                result = apply_canvas_command(result, CanvasCommand(type=command_type, payload=payload))
        except (CanvasValidationError, TypeError, ValueError) as exc:
            raise CanvasApplicationError(str(exc)) from exc
        return result

    def apply_commands(self, canvas_id: str, commands: List[Dict[str, Any]], base_revision: int) -> Dict[str, Any]:
        """Validate a complete Agent operation batch, then persist it once."""
        return self.save(self.preview_commands(canvas_id, commands, base_revision))

    def restore_snapshot(self, canvas_id: str, snapshot: Dict[str, Any], base_revision: int) -> Dict[str, Any]:
        """Restore a trusted local checkpoint while keeping revision monotonic."""
        current = self.get(canvas_id)
        conflict = canvas_conflict_detail(current, base_revision, 0)
        if conflict:
            raise CanvasApplicationError(conflict)
        if not isinstance(snapshot, dict) or str(snapshot.get("id") or "") != str(canvas_id or ""):
            raise CanvasApplicationError("checkpoint does not belong to the target canvas")
        restored = deepcopy(snapshot)
        restored["id"] = current["id"]
        restored["revision"] = int(current.get("revision") or 0)
        restored["updated_at"] = int(current.get("updated_at") or 0)
        restored.pop("deleted_at", None)
        return self.save(restored)

    def update_meta(self, canvas_id: str, payload: Any) -> Dict[str, Any]:
        canvas = self.get(canvas_id)
        if payload.title is not None:
            canvas["title"] = (payload.title or canvas.get("title") or "未命名画布")[:80]
        if payload.icon is not None:
            canvas["icon"] = (payload.icon or "layers")[:32]
        if payload.owner is not None:
            canvas["owner"] = str(payload.owner).strip()[:40]
        if payload.color is not None:
            canvas["color"] = self.normalize_color(payload.color)
        if payload.pinned is not None:
            canvas["pinned"] = bool(payload.pinned)
        if payload.project is not None:
            next_project = str(payload.project).strip() or self.policy.default_project_id
            current_project = str(canvas.get("project") or self.policy.default_project_id)
            if next_project != current_project:
                canvas["project"] = next_project
                # Moving between launcher projects appends the card to the target project.
                canvas["sort_order"] = self._next_sort_order()
        if payload.board_x is not None:
            canvas["board_x"] = float(payload.board_x)
        if payload.board_y is not None:
            canvas["board_y"] = float(payload.board_y)
        try:
            return self.repository.save(canvas, bump_revision=False, touch_updated=False)
        except CanvasRepositoryError as exc:
            raise CanvasApplicationStorageError(str(exc)) from exc

    def reorder(self, canvas_ids: List[str]) -> List[Dict[str, Any]]:
        normalized_ids = [str(canvas_id or "").strip() for canvas_id in canvas_ids]
        if not normalized_ids or any(not canvas_id for canvas_id in normalized_ids):
            raise CanvasApplicationError("排序列表不能为空")
        if len(normalized_ids) != len(set(normalized_ids)):
            raise CanvasApplicationError("排序列表包含重复画布")
        try:
            active = self._active_smart_canvases()
        except CanvasRepositoryError as exc:
            raise CanvasApplicationStorageError(str(exc)) from exc
        active_ids = {str(canvas.get("id") or "") for canvas in active}
        if set(normalized_ids) != active_ids:
            raise CanvasApplicationError("排序列表与当前画布不一致，请刷新后重试")
        by_id = {str(canvas.get("id")): canvas for canvas in active}
        try:
            for index, canvas_id in enumerate(normalized_ids):
                by_id[canvas_id]["sort_order"] = index
            # A drag is a launcher preference, not a canvas content edit.
            self.repository.save_many(
                (by_id[canvas_id] for canvas_id in normalized_ids),
                bump_revision=False,
                touch_updated=False,
            )
        except CanvasRepositoryError as exc:
            raise CanvasApplicationStorageError(str(exc)) from exc
        return self.list()

    def touch(self, canvas_id: str) -> Dict[str, Any]:
        return self.save(self.get(canvas_id))

    def delete(self, canvas_id: str) -> Dict[str, Any]:
        canvas = self.get(canvas_id, include_deleted=True)
        if not canvas.get("deleted_at"):
            canvas["deleted_at"] = self.now_ms()
            self.save(canvas)
        return canvas

    def restore(self, canvas_id: str) -> Dict[str, Any]:
        canvas = self.get(canvas_id, include_deleted=True)
        if canvas.get("deleted_at"):
            canvas.pop("deleted_at", None)
            # A restored canvas is a new launcher entry and therefore belongs at
            # the end; this also prevents collisions with compacted old orders.
            canvas["sort_order"] = self._next_sort_order()
            self.save(canvas)
        return canvas

    def purge(self, canvas_id: str) -> None:
        try:
            self.repository.delete_file(canvas_id)
        except CanvasRepositoryError as exc:
            raise CanvasApplicationStorageError(str(exc)) from exc



