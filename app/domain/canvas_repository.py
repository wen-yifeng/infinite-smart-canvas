"""Atomic JSON repository used during the canvas storage migration."""
from __future__ import annotations

from collections import OrderedDict
from contextlib import contextmanager
from copy import deepcopy
import json
import os
import re
import tempfile
from threading import Lock, RLock
from typing import Any, Callable, Dict, Iterable, Iterator, List, Mapping, Optional

from app.domain.canvas_domain import normalize_canvas_document


class CanvasRepositoryError(RuntimeError):
    pass


class CanvasNotFoundError(CanvasRepositoryError):
    pass


class CanvasJsonRepository:
    """Small repository boundary around the legacy per-canvas JSON files.

    It keeps the current file format and URLs intact while centralizing the
    invariants that were previously spread across route helpers.

    P0-B adds a bounded LRU read cache plus an in-memory summary index so the
    launcher/agent list endpoints and the foreground meta poll do not re-parse
    every canvas JSON on each request.
    """

    _ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

    def __init__(
        self,
        root_dir: str,
        *,
        global_lock: Optional[Lock] = None,
        cache_size: int = 32,
    ):
        self.root_dir = os.path.abspath(root_dir)
        os.makedirs(self.root_dir, exist_ok=True)
        self._global_lock = global_lock or RLock()
        self._locks: Dict[str, RLock] = {}
        self._locks_guard = RLock()
        self._cache_size = max(1, int(cache_size or 32))
        self._cache: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        self._summaries: Dict[str, Dict[str, Any]] = {}
        self._summaries_built = False
        self._summarizer: Optional[Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]] = None

    def _validate_id(self, canvas_id: str) -> str:
        value = str(canvas_id or "").strip()
        if not self._ID_RE.fullmatch(value):
            raise CanvasRepositoryError("无效的画布 ID")
        return value

    def path_for(self, canvas_id: str) -> str:
        value = self._validate_id(canvas_id)
        return os.path.join(self.root_dir, f"{value}.json")

    def _lock_for(self, canvas_id: str) -> RLock:
        value = self._validate_id(canvas_id)
        with self._locks_guard:
            return self._locks.setdefault(value, RLock())

    @contextmanager
    def _canvas_lock(self, canvas_id: str) -> Iterator[None]:
        with self._global_lock:
            with self._lock_for(canvas_id):
                yield

    def exists(self, canvas_id: str) -> bool:
        return os.path.isfile(self.path_for(canvas_id))

    def set_summarizer(self, fn: Optional[Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]]) -> None:
        with self._global_lock:
            self._summarizer = fn
            self._summaries = {}
            self._summaries_built = False

    def _cache_get(self, canvas_id: str) -> Optional[Dict[str, Any]]:
        doc = self._cache.get(canvas_id)
        if doc is None:
            return None
        self._cache.move_to_end(canvas_id)
        return deepcopy(doc)

    def _cache_put(self, canvas_id: str, doc: Dict[str, Any], *, copy: bool = True) -> None:
        self._cache[canvas_id] = deepcopy(doc) if copy else doc
        self._cache.move_to_end(canvas_id)
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)

    def _cache_discard(self, canvas_id: str) -> None:
        self._cache.pop(canvas_id, None)

    def _update_summary(self, canvas_id: str, canvas: Dict[str, Any]) -> None:
        if self._summarizer is None:
            return
        summary = self._summarizer(canvas)
        if summary is None:
            self._summaries.pop(canvas_id, None)
        else:
            self._summaries[canvas_id] = summary

    def _rebuild_summaries(self) -> None:
        self._summaries = {}
        try:
            filenames = sorted(name for name in os.listdir(self.root_dir) if name.endswith(".json"))
        except OSError:
            self._summaries_built = True
            return
        for filename in filenames:
            canvas_id = filename[:-5]
            try:
                canvas = self.load(canvas_id, include_deleted=True)
            except CanvasRepositoryError:
                continue
            self._update_summary(canvas_id, canvas)
        self._summaries_built = True

    def list_summaries(self, *, deleted: bool = False) -> List[Dict[str, Any]]:
        with self._global_lock:
            if not self._summaries_built:
                self._rebuild_summaries()
            return [
                deepcopy(summary)
                for summary in self._summaries.values()
                if bool(summary.get("deleted_at")) == bool(deleted)
            ]

    def iter_documents(self, *, deleted: Optional[bool] = None) -> Iterator[Dict[str, Any]]:
        """Yield normalized canvas documents without exposing filesystem details.

        ``deleted=None`` returns both active and trashed documents. Invalid or
        partially-written legacy files are skipped so one bad file cannot make
        list endpoints fail for every canvas.
        """
        try:
            filenames = sorted(name for name in os.listdir(self.root_dir) if name.endswith(".json"))
        except OSError as exc:
            raise CanvasRepositoryError(f"遍历画布失败: {exc}") from exc
        for filename in filenames:
            canvas_id = filename[:-5]
            try:
                canvas = self.load(canvas_id, include_deleted=True)
            except CanvasRepositoryError:
                continue
            if deleted is not None and bool(canvas.get("deleted_at")) != deleted:
                continue
            yield canvas

    def load(self, canvas_id: str, *, include_deleted: bool = False) -> Dict[str, Any]:
        path = self.path_for(canvas_id)
        with self._canvas_lock(canvas_id):
            cached = self._cache_get(canvas_id)
            if cached is None:
                if not os.path.isfile(path):
                    raise CanvasNotFoundError("画布不存在")
                try:
                    with open(path, "r", encoding="utf-8") as handle:
                        canvas = json.load(handle)
                except (OSError, ValueError) as exc:
                    raise CanvasRepositoryError(f"读取画布失败: {exc}") from exc
                normalized = normalize_canvas_document(canvas)
                self._cache_put(canvas_id, normalized, copy=False)
                normalized = self._cache_get(canvas_id)
            else:
                normalized = cached
        if not include_deleted and normalized.get("deleted_at"):
            raise CanvasNotFoundError("画布已在回收站")
        return normalized

    def save(
        self,
        canvas: Mapping[str, Any],
        *,
        bump_revision: bool = True,
        touch_updated: bool = True,
    ) -> Dict[str, Any]:
        normalized = normalize_canvas_document(canvas)
        canvas_id = normalized["id"]
        path = self.path_for(canvas_id)
        with self._canvas_lock(canvas_id):
            if bump_revision:
                normalized["revision"] = max(0, int(normalized.get("revision") or 0)) + 1
            if touch_updated:
                from app.domain.canvas_domain import now_ms
                normalized["updated_at"] = now_ms()
            self._atomic_write(path, normalized)
            self._cache_put(canvas_id, normalized)
            self._update_summary(canvas_id, normalized)
        if isinstance(canvas, dict):
            canvas.clear()
            canvas.update(normalized)
        return normalized

    def save_many(
        self,
        canvases: Iterable[Mapping[str, Any]],
        *,
        bump_revision: bool = True,
        touch_updated: bool = True,
    ) -> List[Dict[str, Any]]:
        """Persist a group of canvas documents with staged writes and rollback.

        The on-disk model uses one JSON file per canvas, so a true multi-file
        filesystem transaction is unavailable. Every payload is fully written
        to a temporary file before any live document is replaced; if a replace
        then fails, already replaced documents are restored from snapshots.
        """
        records = []
        seen_ids = set()
        for canvas in canvases:
            normalized = normalize_canvas_document(canvas)
            canvas_id = normalized["id"]
            if canvas_id in seen_ids:
                raise CanvasRepositoryError("批量保存包含重复画布")
            seen_ids.add(canvas_id)
            records.append((canvas, normalized, self.path_for(canvas_id)))
        if not records:
            return []

        with self._global_lock:
            if bump_revision or touch_updated:
                from app.domain.canvas_domain import now_ms
                timestamp = now_ms() if touch_updated else None
                for _, normalized, _ in records:
                    if bump_revision:
                        normalized["revision"] = max(0, int(normalized.get("revision") or 0)) + 1
                    if timestamp is not None:
                        normalized["updated_at"] = timestamp

            staged = []
            snapshots = {}
            replaced = []
            try:
                for _, normalized, target in records:
                    snapshots[target] = None
                    if os.path.exists(target):
                        with open(target, "rb") as handle:
                            snapshots[target] = handle.read()
                    fd, temp_path = tempfile.mkstemp(prefix=".canvas-", suffix=".tmp", dir=self.root_dir)
                    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                        json.dump(normalized, handle, ensure_ascii=False, separators=(",", ":"))
                        handle.flush()
                        os.fsync(handle.fileno())
                    staged.append((target, temp_path))

                for target, temp_path in staged:
                    os.replace(temp_path, target)
                    replaced.append(target)
            except OSError as exc:
                rollback_errors = []
                for target in reversed(replaced):
                    snapshot = snapshots.get(target)
                    try:
                        if snapshot is None:
                            if os.path.exists(target):
                                os.remove(target)
                        else:
                            fd, rollback_path = tempfile.mkstemp(prefix=".canvas-rollback-", suffix=".tmp", dir=self.root_dir)
                            with os.fdopen(fd, "wb") as handle:
                                handle.write(snapshot)
                                handle.flush()
                                os.fsync(handle.fileno())
                            os.replace(rollback_path, target)
                    except OSError as rollback_exc:
                        rollback_errors.append(str(rollback_exc))
                detail = f"批量保存画布失败: {exc}"
                if rollback_errors:
                    detail += f"；回滚失败: {' | '.join(rollback_errors)}"
                raise CanvasRepositoryError(detail) from exc
            finally:
                for _, temp_path in staged:
                    if os.path.exists(temp_path):
                        try:
                            os.remove(temp_path)
                        except OSError:
                            pass

            for _, normalized, _ in records:
                self._cache_put(normalized["id"], normalized)
                self._update_summary(normalized["id"], normalized)

        saved = []
        for source, normalized, _ in records:
            if isinstance(source, dict):
                source.clear()
                source.update(normalized)
            saved.append(normalized)
        return saved

    def delete_file(self, canvas_id: str) -> bool:
        path = self.path_for(canvas_id)
        with self._canvas_lock(canvas_id):
            if not os.path.exists(path):
                return False
            os.remove(path)
            self._cache_discard(canvas_id)
            self._summaries.pop(canvas_id, None)
            return True

    def _atomic_write(self, target: str, payload: Mapping[str, Any]) -> None:
        fd, temp_path = tempfile.mkstemp(prefix=".canvas-", suffix=".tmp", dir=self.root_dir)
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