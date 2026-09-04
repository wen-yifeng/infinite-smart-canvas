"""Application service for project grouping and canvas reassignment."""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from dataclasses import dataclass
from threading import RLock
from typing import Any, Callable, Dict, List, Optional

from app.domain.canvas_repository import CanvasJsonRepository, CanvasRepositoryError


class ProjectApplicationError(Exception):
    """Base error for project use cases."""


class ProjectNotFound(ProjectApplicationError):
    pass


class ProjectStorageError(ProjectApplicationError):
    pass


class ProjectValidationError(ProjectApplicationError):
    pass


@dataclass(frozen=True)
class ProjectPolicy:
    default_project_id: str = "default"
    default_project_name: str = "默认项目"
    default_new_name: str = "新项目"
    max_name_length: int = 60


class ProjectApplicationService:
    """Own project persistence and project-level canvas migration.

    The service receives the canvas repository and a lightweight record reader
    instead of importing the FastAPI module. This keeps project behavior
    testable and prevents project deletion from opening canvas JSON directly.
    """

    def __init__(
        self,
        projects_path: str,
        canvas_repository: CanvasJsonRepository,
        iter_canvas_records: Callable[[], List[Dict[str, Any]]],
        now_ms: Callable[[], int],
        *,
        lock: Optional[RLock] = None,
        policy: ProjectPolicy = ProjectPolicy(),
    ) -> None:
        self.projects_path = projects_path
        self.canvas_repository = canvas_repository
        self.iter_canvas_records = iter_canvas_records
        self.now_ms = now_ms
        self.lock = lock or RLock()
        self.policy = policy

    def _load(self) -> List[Dict[str, Any]]:
        try:
            with open(self.projects_path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            projects = data.get("projects") if isinstance(data, dict) else data
            if isinstance(projects, list):
                return [p for p in projects if isinstance(p, dict) and p.get("id")]
        except (OSError, ValueError, TypeError):
            pass
        return []

    def _save(self, projects: List[Dict[str, Any]]) -> None:
        directory = os.path.dirname(os.path.abspath(self.projects_path)) or "."
        os.makedirs(directory, exist_ok=True)
        fd, temp_path = tempfile.mkstemp(prefix=".projects-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump({"projects": projects}, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, self.projects_path)
        except OSError as exc:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise ProjectStorageError(str(exc)) from exc

    def _ensure_default(self, projects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if any(p.get("id") == self.policy.default_project_id for p in projects):
            return projects
        timestamp = self.now_ms()
        projects.insert(0, {
            "id": self.policy.default_project_id,
            "name": self.policy.default_project_name,
            "order": 0,
            "created_at": timestamp,
            "updated_at": timestamp,
        })
        self._save(projects)
        return projects

    def ensure_default(self) -> List[Dict[str, Any]]:
        with self.lock:
            return self._ensure_default(self._load())

    def record(self, project: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": project.get("id"),
            "name": (project.get("name") or "未命名项目")[: self.policy.max_name_length],
            "order": int(project.get("order") or 0),
            "created_at": project.get("created_at", 0),
            "updated_at": project.get("updated_at", 0),
        }

    def list(self) -> List[Dict[str, Any]]:
        projects = self.ensure_default()
        counts: Dict[str, int] = {}
        for record in self.iter_canvas_records():
            project_id = record.get("project") or self.policy.default_project_id
            counts[project_id] = counts.get(project_id, 0) + 1
        result = []
        for project in sorted(projects, key=lambda item: (int(item.get("order") or 0), item.get("created_at") or 0)):
            item = self.record(project)
            item["canvas_count"] = counts.get(item["id"], 0)
            result.append(item)
        return result

    def create(self, name: str = "新项目") -> Dict[str, Any]:
        with self.lock:
            projects = self._ensure_default(self._load())
            timestamp = self.now_ms()
            clean_name = (str(name or "").strip() or self.policy.default_new_name)[: self.policy.max_name_length]
            order = max([int(p.get("order") or 0) for p in projects], default=0) + 1
            project = {
                "id": uuid.uuid4().hex,
                "name": clean_name,
                "order": order,
                "created_at": timestamp,
                "updated_at": timestamp,
            }
            projects.append(project)
            self._save(projects)
            return project

    def update(self, project_id: str, *, name: Optional[str] = None, order: Optional[int] = None) -> Dict[str, Any]:
        with self.lock:
            projects = self._ensure_default(self._load())
            target = next((project for project in projects if project.get("id") == project_id), None)
            if target is None:
                raise ProjectNotFound("项目不存在")
            if name is not None:
                target["name"] = (str(name).strip() or target.get("name") or "未命名项目")[: self.policy.max_name_length]
            if order is not None:
                target["order"] = int(order)
            target["updated_at"] = self.now_ms()
            self._save(projects)
            return target

    def delete(self, project_id: str) -> Dict[str, Any]:
        if project_id == self.policy.default_project_id:
            raise ProjectValidationError("默认项目不可删除")
        with self.lock:
            projects = self._ensure_default(self._load())
            if not any(project.get("id") == project_id for project in projects):
                raise ProjectNotFound("项目不存在")
            self._save([project for project in projects if project.get("id") != project_id])
            moved = 0
            for canvas in self.canvas_repository.iter_documents(deleted=None):
                if str(canvas.get("project") or "") != project_id:
                    continue
                canvas["project"] = self.policy.default_project_id
                try:
                    self.canvas_repository.save(canvas, bump_revision=False, touch_updated=False)
                except CanvasRepositoryError:
                    continue
                moved += 1
            return {"ok": True, "moved": moved}
