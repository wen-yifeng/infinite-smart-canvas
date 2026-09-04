"""FastAPI adapter for the Smart Canvas lifecycle API.

This module is intentionally a thin adapter: validation and HTTP status
mapping live here, while use-case mutations live in the application service.
Legacy URLs and response envelopes are preserved.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.application.canvas_service import (
    CanvasApplicationError,
    CanvasApplicationNotFound,
    CanvasApplicationService,
    CanvasApplicationStorageError,
)


class CanvasCreateRequest(BaseModel):
    title: str = "智能画布"
    icon: str = "sparkles"
    kind: str = "smart"
    project: Optional[str] = None
    board_x: Optional[float] = None
    board_y: Optional[float] = None


class CanvasMetaUpdate(BaseModel):
    title: Optional[str] = None
    icon: Optional[str] = None
    owner: Optional[str] = None
    color: Optional[str] = None
    pinned: Optional[bool] = None
    project: Optional[str] = None
    board_x: Optional[float] = None
    board_y: Optional[float] = None


class CanvasOrderRequest(BaseModel):
    canvas_ids: List[str] = Field(default_factory=list)

class CanvasLogAppendRequest(BaseModel):
    entry: Dict[str, Any] = Field(default_factory=dict)


class CanvasSaveRequest(BaseModel):
    title: str = "未命名画布"
    icon: str = "🧩"
    nodes: List[Dict[str, Any]] = Field(default_factory=list)
    connections: List[Dict[str, Any]] = Field(default_factory=list)
    viewport: Dict[str, Any] = Field(default_factory=dict)
    logs: List[Dict[str, Any]] = Field(default_factory=list)
    settings: Dict[str, Any] = Field(default_factory=dict)
    ui_state: Optional[Dict[str, Any]] = None
    client_id: str = ""
    base_updated_at: int = 0
    base_revision: int = 0


class CanvasPatchRequest(BaseModel):
    nodes_upsert: List[Dict[str, Any]] = Field(default_factory=list)
    nodes_delete: List[str] = Field(default_factory=list)
    connections: Optional[List[Dict[str, Any]]] = None
    viewport: Optional[Dict[str, Any]] = None
    logs: Optional[List[Dict[str, Any]]] = None
    settings: Optional[Dict[str, Any]] = None
    ui_state: Optional[Dict[str, Any]] = None
    title: Optional[str] = None
    icon: Optional[str] = None
    client_id: str = ""
    base_updated_at: int = 0
    base_revision: int = 0


@dataclass(frozen=True)
class CanvasApiDependencies:
    service: CanvasApplicationService
    broadcast_canvas_updated: Callable[[str, int, str], Awaitable[None]]


def _raise_http(exc: CanvasApplicationError) -> None:
    if isinstance(exc, CanvasApplicationNotFound):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, CanvasApplicationStorageError):
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    detail = exc.args[0] if exc.args else str(exc)
    if isinstance(detail, dict):
        raise HTTPException(status_code=409, detail=detail) from exc
    raise HTTPException(status_code=400, detail=str(detail)) from exc


def create_canvas_router(dependencies: CanvasApiDependencies) -> APIRouter:
    """Build a router with explicit dependencies instead of importing ``main``."""
    router = APIRouter()
    service = dependencies.service

    @router.get("/api/canvases")
    async def canvases():
        return {"canvases": service.list()}

    @router.get("/api/canvases/trash")
    async def trashed_canvases():
        return {"canvases": service.list_deleted(), "retention_days": 30}

    @router.post("/api/canvases")
    async def create_canvas(payload: CanvasCreateRequest):
        try:
            canvas = service.create(payload.title, payload.icon, payload.kind, payload.project, payload.board_x, payload.board_y)
            return {"canvas": canvas}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.patch("/api/canvases/order")
    async def reorder_canvases(payload: CanvasOrderRequest):
        try:
            return {"canvases": service.reorder(payload.canvas_ids)}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.get("/api/canvases/{canvas_id}/meta")
    async def get_canvas_meta(canvas_id: str):
        try:
            canvas = service.get(canvas_id)
            return {
                "id": canvas.get("id"),
                "updated_at": canvas.get("updated_at", 0),
                "title": canvas.get("title", "未命名画布"),
                "icon": canvas.get("icon", "layers"),
                "kind": service.normalize_kind(canvas.get("kind")),
            }
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.post("/api/canvases/{canvas_id}/meta")
    async def update_canvas_meta(canvas_id: str, payload: CanvasMetaUpdate):
        try:
            canvas = service.update_meta(canvas_id, payload)
            return {"canvas": service.canvas_record(canvas)}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.get("/api/canvases/{canvas_id}")
    async def get_canvas(canvas_id: str):
        try:
            return {"canvas": service.get(canvas_id)}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.get("/api/canvases/{canvas_id}/logs")
    async def get_canvas_logs(canvas_id: str, offset: int = Query(0, ge=0), limit: int = Query(40, ge=1, le=200)):
        try:
            return service.list_logs(canvas_id, offset, limit)
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.post("/api/canvases/{canvas_id}/logs")
    async def append_canvas_log(canvas_id: str, payload: CanvasLogAppendRequest):
        try:
            return service.append_log(canvas_id, payload.entry)
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.post("/api/canvases/{canvas_id}/touch")
    async def touch_canvas(canvas_id: str):
        try:
            canvas = service.touch(canvas_id)
            return {"canvas": service.canvas_record(canvas), "updated_at": canvas.get("updated_at", 0)}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.put("/api/canvases/{canvas_id}")
    async def update_canvas(canvas_id: str, payload: CanvasSaveRequest):
        try:
            canvas = service.update_snapshot(canvas_id, payload)
            await dependencies.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or service.now_ms()), payload.client_id)
            return {"canvas": canvas}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.patch("/api/canvases/{canvas_id}")
    async def patch_canvas(canvas_id: str, payload: CanvasPatchRequest):
        try:
            canvas = service.patch(canvas_id, payload)
            await dependencies.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or service.now_ms()), payload.client_id)
            return {"canvas": canvas}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.delete("/api/canvases/{canvas_id}")
    async def delete_canvas(canvas_id: str):
        try:
            service.delete(canvas_id)
            return {"ok": True}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.post("/api/canvases/{canvas_id}/restore")
    async def restore_canvas(canvas_id: str):
        try:
            canvas = service.restore(canvas_id)
            return {"canvas": canvas}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    @router.delete("/api/canvases/{canvas_id}/purge")
    async def purge_canvas(canvas_id: str):
        try:
            service.purge(canvas_id)
            return {"ok": True}
        except CanvasApplicationError as exc:
            _raise_http(exc)

    return router
