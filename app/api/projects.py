"""HTTP adapter for project management."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.application.project_service import (
    ProjectApplicationError,
    ProjectApplicationService,
    ProjectNotFound,
    ProjectStorageError,
    ProjectValidationError,
)


class ProjectCreateRequest(BaseModel):
    name: str = "新项目"


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    order: Optional[int] = None


@dataclass(frozen=True)
class ProjectApiDependencies:
    service: ProjectApplicationService


def _raise_http(exc: ProjectApplicationError) -> None:
    if isinstance(exc, ProjectNotFound):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, ProjectStorageError):
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    raise HTTPException(status_code=400, detail=str(exc)) from exc


def create_project_router(dependencies: ProjectApiDependencies) -> APIRouter:
    router = APIRouter()
    service = dependencies.service

    @router.get("/api/projects")
    async def get_projects():
        try:
            return {"projects": service.list()}
        except ProjectApplicationError as exc:
            _raise_http(exc)

    @router.post("/api/projects")
    async def create_project(payload: ProjectCreateRequest):
        try:
            return {"project": service.record(service.create(payload.name))}
        except ProjectApplicationError as exc:
            _raise_http(exc)

    @router.post("/api/projects/{project_id}")
    async def update_project(project_id: str, payload: ProjectUpdateRequest):
        try:
            return {"project": service.record(service.update(project_id, name=payload.name, order=payload.order))}
        except ProjectApplicationError as exc:
            _raise_http(exc)

    @router.delete("/api/projects/{project_id}")
    async def delete_project(project_id: str):
        try:
            return service.delete(project_id)
        except ProjectApplicationError as exc:
            _raise_http(exc)

    return router
