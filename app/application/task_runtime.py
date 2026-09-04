"""画布生成任务运行时（创建/更新/执行/广播）（Phase 1.2 自 main.py 机械搬移，未做语义改动）。"""

import json
import time
import asyncio
import httpx
from typing import Dict, Any, Optional, Tuple
from fastapi import HTTPException
from app.application import runtime
from app.application.canvas_task_service import CanvasTaskError, CanvasTaskValidationError
from app.application.canvas_task_service import CanvasTaskApplicationService
from app.application.paths import CANVAS_TASK_DIR
from app.application.provider_config import IMAGE_MODEL, get_api_provider, selected_model, snap_size_to_multiple
from app.application.schemas import OnlineImageRequest
from app.application.output_storage import save_to_history, save_ai_image_to_output, image_output_meta
from app.application.common import log_net_error
from app.application.image_engine import extract_images, extract_task_id, extract_task_id_from_text, image_references, friendly_image_error_detail, generate_ai_image


CANVAS_TASK_SERVICE = CanvasTaskApplicationService(CANVAS_TASK_DIR)
CANVAS_TASKS: Dict[str, Dict[str, Any]] = CANVAS_TASK_SERVICE.tasks
CANVAS_TASK_LOCK = CANVAS_TASK_SERVICE.lock
def create_canvas_task(record: Dict[str, Any]) -> Dict[str, Any]:
    """Compatibility wrapper for legacy callers without an idempotency key."""
    snapshot, _created = CANVAS_TASK_SERVICE.create(record)
    return snapshot
def create_canvas_task_with_idempotency(
    record: Dict[str, Any], idempotency_key: Optional[str] = None
) -> Tuple[Dict[str, Any], bool]:
    """Create a task and report whether this request owns the provider run."""
    try:
        return CANVAS_TASK_SERVICE.create(record, idempotency_key=idempotency_key)
    except CanvasTaskValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
def update_canvas_task(task_id: str, **changes: Any) -> Dict[str, Any]:
    """Compatibility wrapper around the explicit task state machine.

    Task update failures must remain visible to the background runner. Returning
    an empty event here used to make a failed transition look like a successful
    no-op and could leave the browser polling forever.
    """
    try:
        return CANVAS_TASK_SERVICE.update(task_id, **changes)
    except CanvasTaskError as exc:
        print(f"更新画布任务失败 {task_id}: {exc}")
        raise
def get_canvas_task(task_id: str) -> Dict[str, Any]:
    try:
        return CANVAS_TASK_SERVICE.get(task_id)
    except Exception:
        return {}
async def build_online_image_result(payload: OnlineImageRequest):
    provider = get_api_provider(payload.provider_id)
    default_model = (provider.get("image_models") or [IMAGE_MODEL])[0]
    model = selected_model(payload.model, default_model)
    request_size = snap_size_to_multiple(payload.size, 16)
    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    image_refs = image_references(refs)
    count = max(1, min(8, int(payload.n or 1)))
    async def generate_one():
        image_data, raw_item = await generate_ai_image(payload.prompt, request_size, payload.quality, model, image_refs, provider["id"])
        try:
            image_items = extract_images(raw_item) if isinstance(raw_item, dict) else [image_data]
        except HTTPException:
            image_items = [image_data]
        local_urls = []
        local_items = []
        for item in image_items:
            local_url = await save_ai_image_to_output(item, prefix="online_")
            if local_url:
                local_urls.append(local_url)
                local_items.append(image_output_meta(local_url, item))
        return local_urls, local_items, raw_item
    try:
        generated = await asyncio.gather(*(generate_one() for _ in range(count)))
    except httpx.HTTPStatusError as exc:
        log_net_error(f"生图 HTTP状态错误 provider={provider.get('id')} model={model} size={request_size}", exc)
        text = exc.response.text or ''
        friendly = friendly_image_error_detail(text, request_size, model)
        detail = friendly or f"上游生图接口错误：{text[:300]}"
        raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
    except httpx.HTTPError as exc:
        log_net_error(f"生图 网络/TLS错误 provider={provider.get('id')} model={model}", exc)
        raise HTTPException(status_code=502, detail=f"请求上游生图接口失败：{exc}") from exc

    local_urls = [url for urls, _items, _raw in generated for url in (urls or []) if url]
    local_items = [item for _urls, items, _raw in generated for item in (items or []) if item.get("url")]
    raw = generated[0][2] if generated else {}
    if not local_urls:
        provider_name = provider.get("name") or provider["id"]
        raw_text = json.dumps(raw, ensure_ascii=False)[:800] if isinstance(raw, (dict, list)) else str(raw)[:800]
        raise HTTPException(status_code=502, detail=f"{provider_name} 没有返回图片：{raw_text}")
    result = {
        "prompt": payload.prompt,
        "images": local_urls,
        "image_items": local_items,
        "timestamp": time.time(),
        "type": "online",
        "model": model,
        "provider_id": provider["id"],
        "provider_name": provider.get("name") or provider["id"],
        "task_id": extract_task_id(raw) if isinstance(raw, dict) else None,
        "request_id": raw.get("id") if isinstance(raw, dict) else None,
        "params": {"provider_id": provider["id"], "model": model, "size": request_size, "requested_size": payload.size, "quality": payload.quality, "n": count, "reference_images": refs},
        "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
    }
    save_to_history(result)
    if runtime.GLOBAL_LOOP:
        asyncio.run_coroutine_threadsafe(runtime.manager.broadcast_new_image(result), runtime.GLOBAL_LOOP)
    return result
async def publish_canvas_task_update(task: Dict[str, Any]):
    if task:
        await runtime.manager.broadcast_canvas_task_updated(task)
async def run_canvas_image_task(task_id: str, payload: OnlineImageRequest):
    await publish_canvas_task_update(update_canvas_task(task_id, status="running", error=""))
    try:
        result = await build_online_image_result(payload)
        await publish_canvas_task_update(update_canvas_task(
            task_id, status="succeeded", result=result, error=""
        ))
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        status_code = getattr(exc, "status_code", 500)
        upstream_task_id = getattr(exc, "upstream_task_id", "") or extract_task_id_from_text(detail)
        await publish_canvas_task_update(update_canvas_task(
            task_id,
            status="failed",
            error=str(detail),
            status_code=status_code,
            upstream_task_id=upstream_task_id,
        ))
