"""Atomic JSON sidecar repository for canvas generation logs.

P0-A keeps the per-canvas JSON document lean by moving the ``logs`` list into
a sidecar file under ``data/canvas_logs``.  This module mirrors the atomic-write
and per-canvas locking behaviour of ``CanvasJsonRepository`` without importing
FastAPI or any storage internals.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from threading import Lock, RLock
from typing import Any, Dict, Iterable, List, Optional

LOG_CAP = 500


class CanvasLogRepositoryError(RuntimeError):
    pass


class CanvasLogRepository:
    """One sidecar JSON file per canvas id, holding ``{"canvas_id": id, "logs": [...]}``."""

    _ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

    def __init__(self, root_dir: str, *, global_lock: Optional[Lock] = None):
        self.root_dir = os.path.abspath(root_dir)
        os.makedirs(self.root_dir, exist_ok=True)
        self._global_lock = global_lock or RLock()
        self._locks: Dict[str, RLock] = {}
        self._locks_guard = RLock()

    def _validate_id(self, canvas_id: str) -> str:
        value = str(canvas_id or "").strip()
        if not self._ID_RE.fullmatch(value):
            raise CanvasLogRepositoryError("无效的画布 ID")
        return value

    def path_for(self, canvas_id: str) -> str:
        return os.path.join(self.root_dir, f"{self._validate_id(canvas_id)}.json")

    def _lock_for(self, canvas_id: str) -> RLock:
        value = self._validate_id(canvas_id)
        with self._locks_guard:
            return self._locks.setdefault(value, RLock())

    def _canvas_lock(self, canvas_id: str):
        return _NestedLock(self._global_lock, self._lock_for(canvas_id))

    def exists(self, canvas_id: str) -> bool:
        return os.path.isfile(self.path_for(canvas_id))

    def load(self, canvas_id: str) -> List[Dict[str, Any]]:
        path = self.path_for(canvas_id)
        if not os.path.isfile(path):
            return []
        with self._canvas_lock(canvas_id):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
            except (OSError, ValueError) as exc:
                raise CanvasLogRepositoryError(f"读取日志失败: {exc}") from exc
        logs = payload.get("logs") if isinstance(payload, dict) else None
        return [entry for entry in logs if isinstance(entry, dict)] if isinstance(logs, list) else []

    def replace(self, canvas_id: str, logs: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        value = self._validate_id(canvas_id)
        entries = [entry for entry in logs if isinstance(entry, dict)][-LOG_CAP:]
        payload = {"canvas_id": value, "logs": entries}
        with self._canvas_lock(value):
            self._atomic_write(self.path_for(value), payload)
        return entries

    def append(self, canvas_id: str, entry: Dict[str, Any]) -> List[Dict[str, Any]]:
        value = self._validate_id(canvas_id)
        if not isinstance(entry, dict):
            raise CanvasLogRepositoryError("日志条目必须是对象")
        with self._canvas_lock(value):
            current = self.load_unlocked(value)
            entries = [entry, *current][:LOG_CAP]
            self._atomic_write(self.path_for(value), {"canvas_id": value, "logs": entries})
        return entries

    def delete_file(self, canvas_id: str) -> bool:
        path = self.path_for(canvas_id)
        with self._canvas_lock(canvas_id):
            if not os.path.exists(path):
                return False
            os.remove(path)
            return True

    def load_unlocked(self, canvas_id: str) -> List[Dict[str, Any]]:
        path = self.path_for(canvas_id)
        if not os.path.isfile(path):
            return []
        try:
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, ValueError) as exc:
            raise CanvasLogRepositoryError(f"读取日志失败: {exc}") from exc
        logs = payload.get("logs") if isinstance(payload, dict) else None
        return [entry for entry in logs if isinstance(entry, dict)] if isinstance(logs, list) else []

    def _atomic_write(self, target: str, payload: Dict[str, Any]) -> None:
        fd, temp_path = tempfile.mkstemp(prefix=".canvas-log-", suffix=".tmp", dir=self.root_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, target)
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass


class _NestedLock:
    """Enter two re-entrant locks in deterministic order."""

    __slots__ = ("_outer", "_inner")

    def __init__(self, outer, inner):
        self._outer = outer
        self._inner = inner

    def __enter__(self):
        self._outer.__enter__()
        try:
            self._inner.__enter__()
        except BaseException:
            self._outer.__exit__(None, None, None)
            raise
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            self._inner.__exit__(exc_type, exc, tb)
        finally:
            self._outer.__exit__(exc_type, exc, tb)