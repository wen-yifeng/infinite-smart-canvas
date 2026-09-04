"""FastAPI adapter for direct and page-interactive Smart Canvas Agent operations."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.application.canvas_service import CanvasApplicationError
from app.application.smart_canvas_agent_service import SmartCanvasAgentError, SmartCanvasAgentService


class AgentHeartbeatRequest(BaseModel):
    client_id: str
    canvas_id: str
    selection: Dict[str, Any] = Field(default_factory=dict)
    page_url: str = ""
    visible: bool = True


class AgentCloseRequest(BaseModel):
    client_id: str


class AgentCreateRequest(BaseModel):
    kind: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    base_revision: Optional[int] = None
    canvas_id: Optional[str] = None
    client_id: Optional[str] = None
    operation_id: Optional[str] = None


class AgentResolveRequest(BaseModel):
    client_id: str
    approved: bool = True


class AgentFastAddRequest(BaseModel):
    base_revision: Optional[int] = None
    nodes: list[Dict[str, Any]] = Field(default_factory=list)
    placement: str = "below_existing"
    canvas_id: Optional[str] = None
    client_id: Optional[str] = None
    operation_id: Optional[str] = None


class AgentOpsRequest(BaseModel):
    base_revision: Optional[int] = None
    ops: list[Dict[str, Any]] = Field(default_factory=list)
    canvas_id: Optional[str] = None
    client_id: Optional[str] = None
    operation_id: Optional[str] = None


class AgentStageRequest(BaseModel):
    base_revision: Optional[int] = None
    nodes: list[Dict[str, Any]] = Field(default_factory=list)
    canvas_id: Optional[str] = None
    client_id: Optional[str] = None
    operation_id: Optional[str] = None


class AgentNeighborhoodRequest(BaseModel):
    node_ids: list[str] = Field(default_factory=list)
    depth: int = 1
    canvas_id: Optional[str] = None
    client_id: Optional[str] = None


class AgentCheckpointRequest(BaseModel):
    label: str = "手动检查点"
    canvas_id: Optional[str] = None
    client_id: Optional[str] = None


class AgentRestoreRequest(BaseModel):
    base_revision: Optional[int] = None
    canvas_id: Optional[str] = None
    client_id: Optional[str] = None
    operation_id: Optional[str] = None


@dataclass(frozen=True)
class SmartCanvasAgentApiDependencies:
    service: SmartCanvasAgentService
    broadcast_canvas_updated: Callable[[str, int, str], Awaitable[None]]


def _raise_http(exc: Exception) -> None:
    if isinstance(exc, CanvasApplicationError):
        detail = exc.args[0] if exc.args else str(exc)
        if isinstance(detail, dict):
            raise HTTPException(status_code=409, detail=detail) from exc
        raise HTTPException(status_code=400, detail=str(detail)) from exc
    if isinstance(exc, SmartCanvasAgentError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    raise HTTPException(status_code=500, detail=str(exc)) from exc


def _csv(value: Optional[str]) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def create_smart_canvas_agent_router(dependencies: SmartCanvasAgentApiDependencies) -> APIRouter:
    router = APIRouter(prefix="/api/smart-canvas-agent")
    service = dependencies.service

    async def broadcast(result: Dict[str, Any]) -> None:
        await dependencies.broadcast_canvas_updated(
            str(result.get("canvas_id") or ""),
            int(result.get("updated_at") or service.now_ms()),
            str(result.get("client_id") or ""),
        )

    @router.post("/session/heartbeat")
    async def heartbeat(payload: AgentHeartbeatRequest):
        try:
            session = service.heartbeat(payload.client_id, payload.canvas_id, payload.selection, payload.page_url, payload.visible)
            return {"session": session}
        except Exception as exc:
            _raise_http(exc)

    @router.post("/session/close")
    async def close_session(payload: AgentCloseRequest):
        service.close_session(payload.client_id)
        return {"ok": True}

    @router.get("/active")
    async def active_session():
        try:
            return {"session": service.active_session()}
        except Exception as exc:
            _raise_http(exc)

    @router.get("/canvases")
    async def list_canvases(query: str = "", limit: int = 100):
        try:
            return service.list_canvases(query, limit)
        except Exception as exc:
            _raise_http(exc)

    @router.get("/state")
    async def state(detail: str = "summary", canvas_id: Optional[str] = None, client_id: Optional[str] = None):
        try:
            normalized_detail = str(detail or "summary").lower()
            if normalized_detail not in {"summary", "full"}:
                raise SmartCanvasAgentError("detail must be summary or full")
            return service.state(normalized_detail, canvas_id, client_id)
        except Exception as exc:
            _raise_http(exc)

    @router.get("/context")
    async def context(canvas_id: Optional[str] = None, client_id: Optional[str] = None):
        try:
            return service.context(canvas_id, client_id)
        except Exception as exc:
            _raise_http(exc)

    @router.get("/selection")
    async def selection(canvas_id: Optional[str] = None, client_id: Optional[str] = None):
        try:
            return service.selection(canvas_id, client_id)
        except Exception as exc:
            _raise_http(exc)

    @router.get("/upstream")
    async def upstream(canvas_id: Optional[str] = None, client_id: Optional[str] = None):
        try:
            return service.upstream(canvas_id, client_id)
        except Exception as exc:
            _raise_http(exc)

    @router.get("/downstream")
    async def downstream(node_ids: Optional[str] = None, canvas_id: Optional[str] = None, client_id: Optional[str] = None):
        try:
            return service.downstream(_csv(node_ids), canvas_id, client_id)
        except Exception as exc:
            _raise_http(exc)

    @router.post("/neighborhood")
    async def neighborhood(payload: AgentNeighborhoodRequest):
        try:
            return service.neighborhood(payload.node_ids, payload.depth, payload.canvas_id, payload.client_id)
        except Exception as exc:
            _raise_http(exc)

    @router.get("/path")
    async def path(source_id: str, target_id: str, directed: bool = True, max_depth: int = 20, canvas_id: Optional[str] = None, client_id: Optional[str] = None):
        try:
            return service.path(source_id, target_id, directed, max_depth, canvas_id, client_id)
        except Exception as exc:
            _raise_http(exc)

    @router.get("/nodes")
    async def nodes(
        node_ids: Optional[str] = None,
        titles: Optional[str] = None,
        query: str = "",
        include: str = "summary",
        limit: int = 50,
        x: Optional[float] = None,
        y: Optional[float] = None,
        w: Optional[float] = None,
        h: Optional[float] = None,
        status: str = "",
        has_images: Optional[bool] = None,
        has_upstream: Optional[bool] = None,
        has_downstream: Optional[bool] = None,
        canvas_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ):
        try:
            values = (x, y, w, h)
            if any(value is not None for value in values) and not all(value is not None for value in values):
                raise SmartCanvasAgentError("空间查询必须同时提供 x, y, w, h")
            region = {"x": x, "y": y, "w": w, "h": h} if all(value is not None for value in values) else None
            conditions = {
                "status": status,
                "has_images": has_images,
                "has_upstream": has_upstream,
                "has_downstream": has_downstream,
            }
            return service.query_nodes(
                node_ids=_csv(node_ids),
                titles=_csv(titles),
                query=query,
                include=include,
                limit=limit,
                region=region,
                conditions=conditions,
                canvas_id=canvas_id,
                client_id=client_id,
            )
        except Exception as exc:
            _raise_http(exc)

    @router.post("/validate-ops")
    async def validate_ops(payload: AgentOpsRequest):
        try:
            return service.validate_ops(payload.base_revision, payload.ops, payload.canvas_id, payload.client_id)
        except Exception as exc:
            _raise_http(exc)

    @router.post("/nodes/fast")
    async def add_nodes_fast(payload: AgentFastAddRequest):
        try:
            result = service.add_nodes_fast(
                payload.base_revision,
                payload.nodes,
                payload.placement,
                payload.canvas_id,
                payload.client_id,
                payload.operation_id,
            )
            if not result.get("idempotent_replay"):
                await broadcast(result)
            return result
        except Exception as exc:
            _raise_http(exc)

    @router.post("/ops/direct")
    async def apply_ops_direct(payload: AgentOpsRequest):
        try:
            result = service.apply_ops_direct(
                payload.base_revision,
                payload.ops,
                payload.canvas_id,
                payload.client_id,
                payload.operation_id,
            )
            if not result.get("idempotent_replay"):
                await broadcast(result)
            return result
        except Exception as exc:
            _raise_http(exc)

    @router.post("/stage/direct")
    async def stage_image_prompt_direct(payload: AgentStageRequest):
        try:
            result = service.stage_image_prompt_direct(
                payload.base_revision,
                payload.nodes,
                payload.canvas_id,
                payload.client_id,
                payload.operation_id,
            )
            if not result.get("idempotent_replay"):
                await broadcast(result)
            return result
        except Exception as exc:
            _raise_http(exc)

    @router.post("/requests")
    async def create_request(payload: AgentCreateRequest):
        try:
            request = service.create_request(
                payload.kind,
                payload.payload,
                payload.base_revision,
                payload.canvas_id,
                payload.client_id,
                payload.operation_id,
            )
            return {"request": request}
        except Exception as exc:
            _raise_http(exc)

    @router.get("/requests/pending")
    async def pending_requests(client_id: str):
        return {"requests": service.pending_requests(client_id)}

    @router.get("/requests/{request_id}")
    async def get_request(request_id: str):
        try:
            return {"request": service.get_request(request_id)}
        except Exception as exc:
            _raise_http(exc)

    @router.post("/requests/{request_id}/resolve")
    async def resolve_request(request_id: str, payload: AgentResolveRequest):
        try:
            request = service.resolve(payload.client_id, request_id, payload.approved)
            if request.get("status") == "completed" and request.get("kind") in {"apply_ops", "stage_image_prompt"}:
                result = request.get("result") or {}
                if not result.get("idempotent_replay"):
                    await dependencies.broadcast_canvas_updated(
                        str(request.get("canvas_id") or ""),
                        int(result.get("updated_at") or service.now_ms()),
                        payload.client_id,
                    )
            return {"request": request}
        except Exception as exc:
            _raise_http(exc)

    @router.get("/checkpoints")
    async def checkpoints(canvas_id: Optional[str] = None, client_id: Optional[str] = None, limit: int = 20):
        try:
            return service.list_checkpoints(canvas_id, client_id, limit)
        except Exception as exc:
            _raise_http(exc)

    @router.post("/checkpoints")
    async def create_checkpoint(payload: AgentCheckpointRequest):
        try:
            return service.create_checkpoint(payload.label, payload.canvas_id, payload.client_id)
        except Exception as exc:
            _raise_http(exc)

    @router.post("/checkpoints/{checkpoint_id}/restore")
    async def restore_checkpoint(checkpoint_id: str, payload: AgentRestoreRequest):
        try:
            result = service.restore_checkpoint(checkpoint_id, payload.base_revision, payload.canvas_id, payload.client_id, payload.operation_id)
            if not result.get("idempotent_replay"):
                await broadcast(result)
            return result
        except Exception as exc:
            _raise_http(exc)

    @router.post("/undo")
    async def undo(payload: AgentRestoreRequest):
        try:
            result = service.undo(payload.base_revision, payload.canvas_id, payload.client_id, payload.operation_id)
            if not result.get("idempotent_replay"):
                await broadcast(result)
            return result
        except Exception as exc:
            _raise_http(exc)

    @router.get("/operations")
    async def operations(canvas_id: Optional[str] = None, client_id: Optional[str] = None, limit: int = 50, kind: str = "", status: str = ""):
        try:
            return service.operation_log(canvas_id, client_id, limit, kind, status)
        except Exception as exc:
            _raise_http(exc)

    return router
