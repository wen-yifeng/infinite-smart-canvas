"""Application boundary for durable asynchronous canvas tasks.

The FastAPI layer is responsible for invoking providers.  This service owns the
small, provider-agnostic state machine around those calls: durable creation,
lookups, idempotency and legal status transitions.  It deliberately never
replays a provider request during recovery.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import time
from threading import RLock
from typing import Any, Callable, Dict, Optional, Tuple

from app.domain.canvas_task_service import load_task, persist_task, recover_tasks


TASK_STATUSES = {
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "stale",
    "interrupted",
}

# A task can only move forward through this state machine.  ``interrupted`` is
# a durable recovery result, not an invitation to submit the upstream request
# again.  Same-status updates are always allowed for compatibility.
_ALLOWED_TRANSITIONS = {
    "queued": {"running", "failed", "cancelled", "stale", "interrupted"},
    "running": {"succeeded", "failed", "cancelled", "stale", "interrupted"},
    "interrupted": {"failed", "cancelled", "stale"},
    "stale": set(),
    "succeeded": set(),
    "failed": set(),
    "cancelled": set(),
}

_TASK_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,180}$")


class CanvasTaskError(RuntimeError):
    """Base class for task application errors."""


class CanvasTaskNotFound(CanvasTaskError):
    """Raised when a task id is not present."""


class CanvasTaskInvalidTransition(CanvasTaskError):
    """Raised when a task status would move backwards or skip its boundary."""


class CanvasTaskValidationError(CanvasTaskError):
    """Raised when a task record or idempotency key is malformed."""


class CanvasTaskApplicationService:
    """Durable task store with an explicit state machine and idempotency index."""

    def __init__(
        self,
        task_dir: str,
        *,
        clock: Callable[[], float] = time.time,
        task_id_factory: Optional[Callable[[str], str]] = None,
        recover: bool = True,
    ) -> None:
        self.task_dir = os.path.abspath(task_dir)
        self.clock = clock
        self.task_id_factory = task_id_factory or self._default_task_id
        self.lock = RLock()
        self.tasks: Dict[str, Dict[str, Any]] = {}
        self._idempotency_index: Dict[Tuple[str, str], str] = {}
        os.makedirs(self.task_dir, exist_ok=True)
        if recover:
            recover_tasks(self.task_dir, now=self.clock())
        self._load_existing()

    @staticmethod
    def _default_task_id(task_type: str) -> str:
        prefix = "canvas_img" if task_type == "online-image" else "canvas_task"
        return f"{prefix}_{hashlib.sha256(f'{time.time_ns()}'.encode()).hexdigest()[:32]}"

    @staticmethod
    def normalize_idempotency_key(value: Any) -> str:
        key = str(value or "").strip()
        if not key:
            return ""
        if len(key) > 200:
            raise CanvasTaskValidationError("幂等键长度不能超过 200 个字符")
        if any(ord(char) < 32 or ord(char) == 127 for char in key):
            raise CanvasTaskValidationError("幂等键不能包含控制字符")
        return key

    @staticmethod
    def _key_hash(task_type: str, key: str) -> str:
        scope = f"{str(task_type or '').strip()}:{key}"
        return hashlib.sha256(scope.encode("utf-8")).hexdigest()

    @staticmethod
    def _validate_id(task_id: Any) -> str:
        value = str(task_id or "").strip()
        if not _TASK_ID_RE.fullmatch(value):
            raise CanvasTaskValidationError("任务 ID 格式无效")
        return value

    def _load_existing(self) -> None:
        with self.lock:
            self.tasks.clear()
            self._idempotency_index.clear()
            for name in os.listdir(self.task_dir):
                if not name.endswith(".json"):
                    continue
                task_id = name[:-5]
                try:
                    task_id = self._validate_id(task_id)
                    task = load_task(self.task_dir, task_id)
                except (CanvasTaskError, OSError, ValueError, TypeError):
                    continue
                if not isinstance(task, dict) or str(task.get("id") or "") != task_id:
                    continue
                self.tasks[task_id] = copy.deepcopy(task)
                self._index_task(task)

    @staticmethod
    def _task_matches_key(task: Dict[str, Any], task_type: str, key_hash: str) -> bool:
        return (
            isinstance(task, dict)
            and str(task.get("type") or "") == task_type
            and str(task.get("idempotency_key_hash") or "") == key_hash
        )

    def _task_file_exists_locked(self, task_id: str) -> bool:
        return os.path.isfile(os.path.join(self.task_dir, f"{task_id}.json"))

    def _index_task(self, task: Dict[str, Any]) -> None:
        task_id = str(task.get("id") or "")
        task_type = str(task.get("type") or "")
        key_hash = str(task.get("idempotency_key_hash") or "")
        if task_id and task_type and key_hash:
            self._idempotency_index[(task_type, key_hash)] = task_id

    def _find_existing_locked(self, task_type: str, key: str) -> Optional[Dict[str, Any]]:
        if not key:
            return None
        key_hash = self._key_hash(task_type, key)
        index_key = (task_type, key_hash)
        task_id = self._idempotency_index.get(index_key)
        if task_id:
            task = self.tasks.get(task_id) or load_task(self.task_dir, task_id)
            if task and self._task_matches_key(task, task_type, key_hash):
                self.tasks[task_id] = copy.deepcopy(task)
                return copy.deepcopy(task)
            # The index may point to a deleted, malformed, or replaced record.
            self._idempotency_index.pop(index_key, None)

        # A second process may have written a task after this service started.
        # Scan the durable directory so a retry cannot create a duplicate just
        # because the in-memory index is stale.
        try:
            names = os.listdir(self.task_dir)
        except OSError:
            names = []
        for name in names:
            if not name.endswith(".json"):
                continue
            candidate_id = name[:-5]
            try:
                candidate_id = self._validate_id(candidate_id)
            except CanvasTaskValidationError:
                continue
            task = load_task(self.task_dir, candidate_id)
            if not task or not self._task_matches_key(task, task_type, key_hash):
                continue
            self.tasks[candidate_id] = copy.deepcopy(task)
            self._idempotency_index[index_key] = candidate_id
            return copy.deepcopy(task)
        return None

    def _allocate_task_id_locked(self, task_type: str) -> str:
        for _ in range(16):
            candidate = self._validate_id(self.task_id_factory(task_type))
            if not self._task_file_exists_locked(candidate) and candidate not in self.tasks:
                return candidate
        raise CanvasTaskValidationError("无法分配唯一任务 ID")

    def _index_and_store_locked(self, task: Dict[str, Any], *, replace: bool = False) -> Dict[str, Any]:
        task_id = self._validate_id(task.get("id"))
        if not replace and (task_id in self.tasks or self._task_file_exists_locked(task_id)):
            raise CanvasTaskValidationError(f"任务 ID 已存在：{task_id}")
        snapshot = persist_task(self.task_dir, task)
        task_id = self._validate_id(snapshot.get("id"))
        self.tasks[task_id] = copy.deepcopy(snapshot)
        self._index_task(snapshot)
        return copy.deepcopy(snapshot)

    def create(
        self,
        record: Dict[str, Any],
        *,
        idempotency_key: Any = None,
    ) -> Tuple[Dict[str, Any], bool]:
        """Create or replay a task.

        Returns ``(snapshot, created)``.  A replay has ``created=False`` and
        must not schedule the provider coroutine a second time.
        """
        if not isinstance(record, dict):
            raise CanvasTaskValidationError("任务记录必须是对象")
        task_type = str(record.get("type") or "").strip()
        if not task_type:
            raise CanvasTaskValidationError("任务类型不能为空")
        key = self.normalize_idempotency_key(idempotency_key)
        with self.lock:
            existing = self._find_existing_locked(task_type, key)
            if existing:
                return existing, False
            task = copy.deepcopy(record)
            if task.get("id"):
                task["id"] = self._validate_id(task.get("id"))
                if task["id"] in self.tasks or self._task_file_exists_locked(task["id"]):
                    raise CanvasTaskValidationError(f"任务 ID 已存在：{task['id']}")
            else:
                task["id"] = self._allocate_task_id_locked(task_type)
            status = str(task.get("status") or "queued")
            if status not in TASK_STATUSES:
                raise CanvasTaskValidationError(f"未知任务状态：{status}")
            timestamp = float(task.get("created_at") or self.clock())
            task["created_at"] = timestamp
            task["updated_at"] = float(task.get("updated_at") or timestamp)
            if key:
                task["idempotency_key_hash"] = self._key_hash(task_type, key)
                task["idempotency_scope"] = task_type
            return self._index_and_store_locked(task), True

    def get(self, task_id: str) -> Dict[str, Any]:
        task_id = self._validate_id(task_id)
        with self.lock:
            task = self.tasks.get(task_id) or load_task(self.task_dir, task_id)
            if not task:
                raise CanvasTaskNotFound(task_id)
            snapshot = copy.deepcopy(task)
            self.tasks[task_id] = copy.deepcopy(snapshot)
            self._index_task(snapshot)
            return snapshot

    def find_by_idempotency_key(self, task_type: str, idempotency_key: Any) -> Dict[str, Any]:
        task_type = str(task_type or "").strip()
        key = self.normalize_idempotency_key(idempotency_key)
        with self.lock:
            return self._find_existing_locked(task_type, key) or {}

    def update(self, task_id: str, **changes: Any) -> Dict[str, Any]:
        task_id = self._validate_id(task_id)
        with self.lock:
            current = self.tasks.get(task_id) or load_task(self.task_dir, task_id)
            if not current:
                raise CanvasTaskNotFound(task_id)
            previous_status = str(current.get("status") or "queued")
            next_status = changes.get("status", previous_status)
            next_status = str(next_status or previous_status)
            if next_status not in TASK_STATUSES:
                raise CanvasTaskInvalidTransition(f"未知任务状态：{next_status}")
            if next_status != previous_status and next_status not in _ALLOWED_TRANSITIONS.get(previous_status, set()):
                raise CanvasTaskInvalidTransition(f"任务不能从 {previous_status} 转为 {next_status}")
            updated = copy.deepcopy(current)
            updated.update(copy.deepcopy(changes))
            updated["status"] = next_status
            updated["updated_at"] = self.clock()
            return self._index_and_store_locked(updated, replace=True)

    def transition(self, task_id: str, status: str, **changes: Any) -> Dict[str, Any]:
        changes["status"] = status
        return self.update(task_id, **changes)


__all__ = [
    "TASK_STATUSES",
    "CanvasTaskApplicationService",
    "CanvasTaskError",
    "CanvasTaskNotFound",
    "CanvasTaskInvalidTransition",
    "CanvasTaskValidationError",
]
