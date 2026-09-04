"""生成任务路由（Phase 1 自 main.py 拆出）。

路由处理器逐字搬移；Phase 1.2 已溶解 deps 间接层，引擎函数直接
import 自 app.application（见 DATA_CONTRACT.md §5）。
request DTO 模型随路由迁入；与 main 其他代码共用的模型经工厂参数注入。
"""

import asyncio
import base64
import json
import math
import os
import re
import time
import urllib.parse
import uuid
from typing import Any, Dict, List, Optional

import httpx
import requests
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from app.application.chat_engine import canvas_chat_image_url, friendly_chat_error_detail, parse_canvas_chat_result, resolve_chat_provider, text_from_chat_response
from app.application.common import log_net_error
from app.application.image_engine import IMAGE_TASK_FAILED_STATUSES, extract_images, extract_task_id, fetch_image_task_payload, image_task_fail_reason, image_task_status, modelscope_image_url, modelscope_size, reference_to_data_url
from app.application.model_probe import looks_like_html_response
from app.application.output_storage import image_output_meta, output_path_for, output_url_for, save_ai_image_to_output, save_remote_video_to_output, save_to_history
from app.application.provider_config import AI_REQUEST_TIMEOUT, VIDEO_POLL_TIMEOUT, api_headers, get_api_provider, get_api_provider_exact, is_agnes_provider, is_apimart_provider, is_lingjing_provider, is_volcengine_provider, is_yuli_provider, modelscope_api_key, modelscope_image_api_root, provider_env_key_value, selected_model
from app.application.schemas import AIReference, CanvasChatAttachment, CanvasChatMessage, CanvasChatRequest, CanvasChatTarget, CanvasVideoRequest, OnlineImageRequest
from app.application.task_runtime import create_canvas_task_with_idempotency, get_canvas_task, publish_canvas_task_update, run_canvas_image_task
from app.application.video_engine import apimart_veo31_aspect, apimart_veo31_duration, apimart_veo31_model, apimart_veo31_resolution, apimart_video_duration, apimart_video_reference_error, apimart_video_size, apply_trusted_asset_prompt_index, generate_agnes_video, generate_lingjing_openai_video, generate_yuli_openai_video, invalid_video_image_preview, is_apimart_veo31_model, looks_like_image_media_url, probe_local_audio_duration_seconds, upload_audio_for_apimart, upload_image_for_apimart, upload_video_for_apimart, valid_apimart_video_image_input, video_api_root, video_output_urls, video_submit_url_candidates, volcengine_content_role, volcengine_media_reference_url, volcengine_video_duration, volcengine_video_reference_content_items, volcengine_video_resolution, wait_for_video_task, yuli_is_veo_openai_model
from app.application import runtime

class CloudGenRequest(BaseModel):
    prompt: str
    api_key: str = ""
    model: str = ""
    resolution: str = "1024x1024"
    type: str = "zimage"
    image_urls: List[str] = []
    loras: Optional[Any] = None
    client_id: Optional[str] = None
class ImageTaskQueryRequest(BaseModel):
    provider_id: str = "comfly"
    task_id: str = Field(min_length=1, max_length=240)
class MsGenerateRequest(BaseModel):
    prompt: str
    api_key: str = ""
    model: str = "black-forest-labs/FLUX.2-klein-9B"
    image_urls: List[str] = []
    width: int = 0
    height: int = 0
    size: str = ""
    loras: Optional[Any] = None
    client_id: Optional[str] = None

_REQUIRED_MODELS = ['AIReference', 'CanvasChatAttachment', 'CanvasChatMessage', 'CanvasChatRequest', 'CanvasChatTarget', 'CanvasVideoRequest', 'OnlineImageRequest']


def create_generation_router():
    router = APIRouter()

    @router.post("/api/canvas-image-tasks")
    async def create_canvas_image_task(
        payload: OnlineImageRequest,
        idempotency_key: Optional[str] = Header(default=None, alias="X-Idempotency-Key"),
    ):
        timestamp = time.time()
        task, created = create_canvas_task_with_idempotency({
            "id": f"canvas_img_{uuid.uuid4().hex}",
            "type": "online-image",
            "status": "queued",
            "created_at": timestamp,
            "updated_at": timestamp,
            "result": None,
            "error": "",
            "provider_id": payload.provider_id,
            "model": payload.model,
        }, idempotency_key)
        task_id = task["id"]
        if created:
            await publish_canvas_task_update(task)
            asyncio.create_task(run_canvas_image_task(task_id, payload))
        return {"task_id": task_id, "status": task.get("status") or "queued"}
    @router.get("/api/canvas-image-tasks/{task_id}")
    async def get_canvas_image_task(task_id: str):
        task = get_canvas_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="画布任务不存在")
        return task
    @router.post("/api/image-task-query")
    async def query_image_task(payload: ImageTaskQueryRequest):
        provider = get_api_provider(payload.provider_id)
        task_id = str(payload.task_id or "").strip()
        timeout = httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=20.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                raw = await fetch_image_task_payload(client, task_id, provider)
        except httpx.HTTPStatusError as exc:
            log_net_error(f"查询生图任务 HTTP状态错误 provider={provider.get('id')} task_id={task_id}", exc)
            text = exc.response.text or ""
            raise HTTPException(status_code=exc.response.status_code, detail=f"查询上游生图任务失败：{text[:300]}") from exc
        except httpx.HTTPError as exc:
            log_net_error(f"查询生图任务 网络/TLS错误 provider={provider.get('id')} task_id={task_id}", exc)
            raise HTTPException(status_code=502, detail=f"查询上游生图任务失败：{exc}") from exc

        status = image_task_status(raw)
        image_items = []
        try:
            image_items = extract_images(raw)
        except HTTPException:
            image_items = []
        if image_items:
            local_urls = []
            local_items = []
            for item in image_items:
                local_url = await save_ai_image_to_output(item, prefix="online_")
                if local_url:
                    local_urls.append(local_url)
                    local_items.append(image_output_meta(local_url, item))
            result = {
                "status": "succeeded",
                "prompt": "",
                "images": local_urls,
                "image_items": local_items,
                "timestamp": time.time(),
                "type": "online",
                "model": "",
                "provider_id": provider["id"],
                "provider_name": provider.get("name") or provider["id"],
                "task_id": task_id,
                "request_id": raw.get("id") if isinstance(raw, dict) else "",
                "params": {"provider_id": provider["id"]},
                "raw": raw,
            }
            save_to_history(result)
            if runtime.GLOBAL_LOOP:
                asyncio.run_coroutine_threadsafe(runtime.manager.broadcast_new_image(result), runtime.GLOBAL_LOOP)
            return result
        if status in IMAGE_TASK_FAILED_STATUSES:
            return {
                "status": "failed",
                "task_id": task_id,
                "provider_id": provider["id"],
                "provider_name": provider.get("name") or provider["id"],
                "error": image_task_fail_reason(raw),
                "raw": raw,
            }
        return {
            "status": "running",
            "task_id": task_id,
            "provider_id": provider["id"],
            "provider_name": provider.get("name") or provider["id"],
            "message": "任务仍在生成中",
            "raw": raw,
        }
    @router.post("/api/canvas-video")
    async def canvas_video(payload: CanvasVideoRequest):
        provider = get_api_provider(payload.provider_id)
        base_url = video_api_root(provider)
        if not base_url:
            raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider['id']} 未配置 Base URL")
        api_key = provider_env_key_value(provider["id"])
        if not api_key:
            raise HTTPException(status_code=400, detail=f"未配置 {provider.get('name') or provider['id']} 的 API Key，请在 API 设置中填写。")
        is_apimart = is_apimart_provider(provider)
        is_volcengine = is_volcengine_provider(provider)
        is_yuli = is_yuli_provider(provider)
        is_lingjing = is_lingjing_provider(provider)
        is_agnes = is_agnes_provider(provider, payload.model)
        volc_is_proxy = bool(is_volcengine and urllib.parse.urlparse(base_url).path.rstrip("/"))
        submit_urls = video_submit_url_candidates(provider, base_url)
        submit_url = submit_urls[0]
        requested_model = selected_model(payload.model, "agnes-video-v2.0" if is_agnes else "veo3-fast")
        is_veo31 = is_apimart and is_apimart_veo31_model(requested_model)
        if is_agnes:
            try:
                async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as agnes_client:
                    return await generate_agnes_video(agnes_client, payload, provider, base_url, requested_model)
            except httpx.HTTPStatusError as exc:
                text = exc.response.text
                raise HTTPException(status_code=exc.response.status_code, detail=f"Agnes 视频接口错误：{text}") from exc
            except httpx.HTTPError as exc:
                log_net_error(f"视频(Agnes) 网络/TLS错误 model={requested_model}", exc)
                raise HTTPException(status_code=502, detail=f"请求 Agnes 视频接口失败：{exc}") from exc
        if is_lingjing:
            try:
                async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as lingjing_client:
                    return await generate_lingjing_openai_video(lingjing_client, payload, provider, base_url, requested_model)
            except httpx.HTTPStatusError as exc:
                text = exc.response.text
                raise HTTPException(status_code=exc.response.status_code, detail=f"灵境 API 视频接口错误：{text}") from exc
            except httpx.HTTPError as exc:
                log_net_error(f"视频(灵境) 网络/TLS错误 model={requested_model}", exc)
                raise HTTPException(status_code=502, detail=f"请求灵境 API 视频接口失败：{exc}") from exc
        # 玉玉API veo3.1 走 OpenAI multipart 格式（支持 seconds 时长）；其余模型（doubao 等）
        # 沿用下方原生 /v1/video/create JSON 流程。
        if is_yuli and yuli_is_veo_openai_model(requested_model):
            try:
                async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as yuli_client:
                    return await generate_yuli_openai_video(yuli_client, payload, provider, base_url, requested_model)
            except httpx.HTTPStatusError as exc:
                text = exc.response.text
                raise HTTPException(status_code=exc.response.status_code, detail=f"上游视频接口错误：{text}") from exc
            except httpx.HTTPError as exc:
                log_net_error(f"视频(玉玉) 网络/TLS错误 model={requested_model}", exc)
                raise HTTPException(status_code=502, detail=f"请求上游视频接口失败：{exc}") from exc
        try:
            async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as client:
                # --- 构造图片载荷 ---
                if is_apimart:
                    # APIMart 只接受 http/https 或 asset:// URL，先上传本地图片取回网络 URL
                    image_with_roles = []
                    invalid_images = []  # 每项为 (原始 URL, 失败原因)
                    video_payload = []
                    invalid_videos = []
                    for ref_url in payload.videos[:3]:
                        ref_url = str(ref_url or "").strip()
                        if not ref_url:
                            continue
                        normalized_video_url = await upload_video_for_apimart(client, provider, ref_url)
                        if valid_apimart_video_image_input(normalized_video_url):
                            video_payload.append(normalized_video_url)
                        else:
                            reason = normalized_video_url[4:] if isinstance(normalized_video_url, str) and normalized_video_url.startswith("ERR:") else apimart_video_reference_error(ref_url)
                            invalid_videos.append((ref_url, reason))
                    if invalid_videos:
                        first_url, first_reason = invalid_videos[0]
                        sample = invalid_video_image_preview(first_url)
                        raise HTTPException(
                            status_code=400,
                            detail=f"输入视频无法转换为 APIMart 支持的格式：{sample}\n原因：{first_reason}"
                        )
                    apimart_model = apimart_veo31_model(requested_model) if is_veo31 else ""
                    if apimart_model == "veo3.1-lite" and payload.images:
                        raise HTTPException(status_code=400, detail="veo3.1-lite 不支持图片输入，请改用 veo3.1-fast 或 veo3.1-quality。")
                    image_limit = 0 if apimart_model == "veo3.1-lite" else (3 if is_veo31 else 9)
                    for ref in payload.images[:image_limit]:
                        if not ref.url:
                            continue
                        role = str(ref.role or "").strip()
                        if not is_veo31 and role in {"first_frame", "last_frame", "reference_image"}:
                            up_url = await upload_image_for_apimart(client, provider, ref.url)
                            if valid_apimart_video_image_input(up_url):
                                image_with_roles.append({"url": up_url, "role": role})
                            else:
                                reason = up_url[4:] if isinstance(up_url, str) and up_url.startswith("ERR:") else "未知错误"
                                invalid_images.append((ref.url, reason))
                    image_payload = []
                    if not image_with_roles:
                        for ref in payload.images[:image_limit]:
                            if not ref.url:
                                continue
                            up_url = await upload_image_for_apimart(client, provider, ref.url)
                            if valid_apimart_video_image_input(up_url):
                                image_payload.append(up_url)
                            else:
                                reason = up_url[4:] if isinstance(up_url, str) and up_url.startswith("ERR:") else "未知错误"
                                invalid_images.append((ref.url, reason))
                    if payload.images and not image_with_roles and not image_payload:
                        first_url, first_reason = invalid_images[0] if invalid_images else ("", "未知错误")
                        sample = invalid_video_image_preview(first_url)
                        raise HTTPException(status_code=400, detail=f"输入图片无法转换为视频接口支持的格式：{sample}\n原因：{first_reason}\n请确认本地文件存在且不超过 10MB；VEO3.1 需要图片是 APIMart 可访问的 http/https / asset:// / data URL。")
                    # --- APIMart 请求体 ---
                    if is_veo31:
                        model = apimart_model
                        body = {
                            "prompt": payload.prompt,
                            "model": model,
                            "duration": apimart_veo31_duration(payload.duration),
                            "aspect_ratio": apimart_veo31_aspect(payload.aspect_ratio),
                            "resolution": apimart_veo31_resolution(payload.resolution),
                        }
                        if image_payload and model != "veo3.1-lite":
                            video_images = image_payload[:3]
                            if model == "veo3.1-quality" and len(video_images) > 2:
                                video_images = video_images[:2]
                            body["image_urls"] = video_images
                            if len(video_images) == 2:
                                body["generation_type"] = "frame"
                            elif len(video_images) >= 3 and model != "veo3.1-quality":
                                body["generation_type"] = "reference"
                        if model != "veo3.1-lite":
                            body["official_fallback"] = False
                    else:
                        body = {
                            "prompt": payload.prompt,
                            "model": selected_model(payload.model, "doubao-seedance-2.0"),
                            "duration": apimart_video_duration(payload.duration),
                            "size": apimart_video_size(payload.aspect_ratio or payload.size),
                            "resolution": payload.resolution or "480p",
                        }
                        if image_with_roles and video_payload:
                            raise HTTPException(status_code=400, detail="APIMart Seedance 的 image_with_roles 不能和 video_urls 同时使用，请只保留图片首尾帧或参考视频其中一种。")
                        if image_with_roles:
                            body["image_with_roles"] = image_with_roles
                        elif image_payload:
                            body["image_urls"] = image_payload[:9]
                        if video_payload:
                            body["video_urls"] = video_payload
                        audio_payload = []
                        invalid_audios = []
                        for ref_url in (payload.audios or [])[:3]:
                            ref_url = str(ref_url or "").strip()
                            if not ref_url:
                                continue
                            normalized_audio_url = await upload_audio_for_apimart(client, provider, ref_url)
                            if valid_apimart_video_image_input(normalized_audio_url):
                                audio_payload.append(normalized_audio_url)
                            else:
                                reason = normalized_audio_url[4:] if isinstance(normalized_audio_url, str) and normalized_audio_url.startswith("ERR:") else "未知错误"
                                invalid_audios.append((ref_url, reason))
                        if invalid_audios:
                            first_url, first_reason = invalid_audios[0]
                            raise HTTPException(status_code=400, detail=f"参考音频无法转换为 APIMart 支持的地址：{invalid_video_image_preview(first_url)}\n原因：{first_reason}")
                        if audio_payload:
                            body["audio_urls"] = audio_payload
                        if payload.trusted_asset:
                            img_count = len(body.get("image_urls") or []) or len(image_with_roles)
                            body["prompt"] = apply_trusted_asset_prompt_index(
                                body["prompt"], img_count, len(video_payload), len(audio_payload)
                            )
                        if payload.seed is not None:
                            body["seed"] = payload.seed
                        if payload.return_last_frame:
                            body["return_last_frame"] = True
                        if payload.generate_audio:
                            body["generate_audio"] = True
                else:
                    # 非 APIMart：data URL 方式（OpenAI / ComflyAI 接口）
                    if is_volcengine and not volc_is_proxy:
                        text = str(payload.prompt or "").strip()
                        volc_model = selected_model(payload.model, "doubao-seedance-2-0-fast-260128")
                        body = {
                            "model": volc_model,
                            "content": [
                                {
                                    "type": "text",
                                    "text": text,
                                }
                            ],
                        }
                        # 火山方舟视频接口（含 Seedance 2.0 图生视频）均通过 body 的 duration 字段控制时长；
                        # 之前对 seedance-2.0 + 参考图的情况省略了 duration，导致接口回退到默认 5s。
                        body["duration"] = volcengine_video_duration(payload.duration)
                        if payload.aspect_ratio:
                            body["ratio"] = payload.aspect_ratio
                        resolution = volcengine_video_resolution(payload.resolution)
                        if resolution:
                            body["resolution"] = resolution
                        if payload.watermark:
                            body["watermark"] = True
                        if payload.generate_audio:
                            body["generate_audio"] = True
                        if payload.camerafixed:
                            body["camerafixed"] = True
                        image_like_urls = set()
                        frame_roles_used = {"first_frame": False, "last_frame": False}
                        volc_video_count = 0

                        def append_volcengine_image(url: str, role: str):
                            if role in {"first_frame", "last_frame"}:
                                if frame_roles_used.get(role):
                                    return False
                                frame_roles_used[role] = True
                            elif role != "reference_image":
                                return False
                            body["content"].append({
                                "type": "image_url",
                                "image_url": {"url": url},
                                "role": role,
                            })
                            image_like_urls.add(url)
                            return True

                        for ref in payload.images[:9]:
                            url = volcengine_media_reference_url(ref.url, max_image_size=1536)
                            if not url:
                                continue
                            role = volcengine_content_role(ref.role, "image")
                            if role in {"first_frame", "last_frame"}:
                                append_volcengine_image(url, role)
                            elif payload.multimodal:
                                # 智能多帧/多参模式：多张图作为参考图提交，不能全部伪装成首帧。
                                append_volcengine_image(url, "reference_image")
                            elif not frame_roles_used["first_frame"]:
                                # 普通图生视频没有显式 role 时，只取第一张作为首帧。
                                append_volcengine_image(url, "first_frame")
                        for url in (payload.videos or [])[:3]:
                            text_url = str(url or "").strip()
                            if not text_url:
                                continue
                            media_url = volcengine_media_reference_url(text_url, max_image_size=1536 if looks_like_image_media_url(text_url) else None)
                            if not media_url:
                                continue
                            if media_url in image_like_urls or looks_like_image_media_url(media_url):
                                append_volcengine_image(media_url, "reference_image" if payload.multimodal else "first_frame")
                                continue
                            video_items = await volcengine_video_reference_content_items(media_url)
                            body["content"].extend(video_items)
                            volc_video_count += 1
                        for url in (payload.audios or [])[:3]:
                            duration = probe_local_audio_duration_seconds(url)
                            if duration is not None and (duration < 1.8 or duration > 15.2):
                                raise HTTPException(
                                    status_code=400,
                                    detail=f"参考音频时长 {duration:.2f} 秒超出范围：方舟 Seedance 参考音频要求在 1.8 ~ 15.2 秒之间，请裁剪后再插入。"
                                )
                            audio_url = volcengine_media_reference_url(url, max_image_size=None)
                            if not audio_url:
                                continue
                            body["content"].append({
                                "type": "audio_url",
                                "audio_url": {"url": audio_url},
                                "role": volcengine_content_role("", "audio"),
                            })
                        if payload.trusted_asset and body["content"] and body["content"][0].get("type") == "text":
                            body["content"][0]["text"] = apply_trusted_asset_prompt_index(
                                body["content"][0].get("text") or "", len(image_like_urls), volc_video_count, 0
                            )
                        if payload.seed is not None:
                            body["seed"] = payload.seed
                    elif is_yuli:
                        # 玉玉API（yuli.host）视频走自有 veo 统一格式：POST /v1/video/create。
                        # 字段：model / prompt / images[]（http(s) URL）/ enhance_prompt /
                        # enable_upsample / aspect_ratio（仅 16:9、9:16）。无 duration 字段，
                        # 时长由模型本身决定，所以这里不传 duration/seconds。
                        yuli_images = []
                        for ref in payload.images[:3]:
                            ref_url = str(getattr(ref, "url", "") or "").strip()
                            if not ref_url:
                                continue
                            if ref_url.startswith("http://") or ref_url.startswith("https://"):
                                yuli_images.append(ref_url)
                            else:
                                # 本地/dataURL 图片转成 data URL 兜底传递
                                data_url = reference_to_data_url(ref.dict(), max_size=1536)
                                if data_url:
                                    yuli_images.append(data_url)
                        prompt_text = str(payload.prompt or "")
                        # veo 只支持英文提示词：仅在含中文等非 ASCII 字符时才开启翻译增强，
                        # 纯英文原样传递（避免增强改写时引入人物等触发安全过滤的描述）。
                        needs_enhance = any(ord(ch) > 127 for ch in prompt_text)
                        body = {
                            "model": selected_model(payload.model, "veo3.1-fast"),
                            "prompt": prompt_text,
                            "enhance_prompt": needs_enhance,
                        }
                        if yuli_images:
                            body["images"] = yuli_images
                        ratio = str(payload.aspect_ratio or "").strip()
                        if ratio in {"16:9", "9:16"}:
                            body["aspect_ratio"] = ratio
                        if payload.enable_upsample:
                            body["enable_upsample"] = True
                    else:
                        image_payload = []
                        for ref in payload.images[:4]:
                            if ref.url:
                                image_payload.append(reference_to_data_url(ref.dict(), max_size=1536))
                        body = {
                            "prompt": payload.prompt,
                            "model": selected_model(payload.model, "veo3-fast"),
                            "duration": payload.duration,
                            "watermark": payload.watermark,
                        }
                        if payload.aspect_ratio:
                            body["aspect_ratio"] = payload.aspect_ratio
                            body["ratio"] = payload.aspect_ratio
                        if payload.size:
                            body["size"] = payload.size
                        if payload.resolution:
                            body["resolution"] = payload.resolution
                        if image_payload:
                            body["images"] = image_payload
                        if payload.videos:
                            body["videos"] = [v for v in payload.videos if v]
                        if payload.enhance_prompt:
                            body["enhance_prompt"] = True
                        if payload.enable_upsample:
                            body["enable_upsample"] = True
                        if payload.seed is not None:
                            body["seed"] = payload.seed
                        if payload.camerafixed:
                            body["camerafixed"] = True
                        if payload.return_last_frame:
                            body["return_last_frame"] = True
                        if payload.generate_audio:
                            body["generate_audio"] = True
                # --- 发起视频生成请求 ---
                raw = None
                html_response = None
                last_response = None
                last_json_error = None
                total_candidates = len(submit_urls)
                for idx, candidate_url in enumerate(submit_urls):
                    submit_url = candidate_url
                    is_last = idx == total_candidates - 1
                    response = await client.post(submit_url, headers=api_headers(provider=provider), json=body)
                    last_response = response
                    if response.status_code >= 400:
                        # 404/405（或直接返回网页 HTML）通常表示该平台不支持这个端点路径——
                        # 例如有的站点只实现了统一格式的 /v2/videos/generations，而我们先试了 /v1。
                        # 这种情况要继续尝试下一个候选端点（关键修复：以前在这里直接 raise_for_status，
                        # 第一个 /v1 报错就抛出，永远轮不到 /v2，表现为“接口错误”）。
                        # 其它错误（模型不支持/时长/额度等请求被拒）说明端点是存在的，直接抛出交给外层友好提示。
                        endpoint_missing = response.status_code in (404, 405) or looks_like_html_response(response.text)
                        if endpoint_missing and not is_last:
                            continue
                        response.raise_for_status()
                    try:
                        raw = response.json()
                        break
                    except Exception as exc:
                        last_json_error = exc
                        if looks_like_html_response(response.text):
                            html_response = response
                            continue
                        if not is_last:
                            continue
                        resp_text = response.text[:500]
                        raise HTTPException(status_code=502, detail=f"上游视频接口返回非 JSON 响应（状态 {response.status_code}）：{resp_text}")
                if raw is None:
                    resp = html_response or last_response
                    status_code = getattr(resp, "status_code", 200)
                    resp_text = (getattr(resp, "text", "") or "")[:500]
                    raise HTTPException(
                        status_code=502,
                        detail=(
                            f"上游视频接口返回了网页 HTML，而不是 JSON（状态 {status_code}）。\n\n"
                            f"这通常表示 API 设置里的 Base URL 指到了第三方聚合平台的管理后台/网页入口，"
                            f"或该平台不支持当前视频接口路径。请确认 Base URL 是接口地址，例如以 /v1 结尾的 OpenAI 兼容地址，"
                            f"并确认该平台实际支持视频生成端点。\n\n原始响应：{resp_text}"
                        )
                    ) from last_json_error
                task_id = extract_task_id(raw) or raw.get("task_id") or raw.get("id")
                result = raw
                if task_id and not video_output_urls(raw):
                    result = await wait_for_video_task(client, provider, task_id, submit_url)
                urls = video_output_urls(result)
                if not urls:
                    raise HTTPException(status_code=502, detail=f"视频生成成功但没有返回视频：{result}")
                local_urls = [await save_remote_video_to_output(url) for url in urls]
                return {"videos": local_urls, "task_id": task_id, "raw": result}
        except httpx.HTTPStatusError as exc:
            text = exc.response.text
            try:
                requested_model = body.get("model", "") or payload.model or ""
            except NameError:
                requested_model = payload.model or ""
            provider_name = provider.get('name') or provider['id']
            # 1) 模型名不在上游支持范围 → 从错误信息里抽取合法列表展示
            valid_models_match = re.search(r"not in\s*\[([^\]]+)\]", text)
            if valid_models_match:
                valid_models = [m.strip() for m in valid_models_match.group(1).split(",") if m.strip()]
                sample = valid_models[:30]
                more = f"（共 {len(valid_models)} 个，仅显示前 {len(sample)} 个）" if len(valid_models) > len(sample) else ""
                hint = (
                    f"上游「{provider_name}」不识别模型「{requested_model}」。\n\n"
                    f"上游支持的视频模型清单{more}：\n  {', '.join(sample)}\n\n"
                    f"请到「API 设置」里把视频模型改成上面列表中的一个。"
                )
                raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
            # 2) 模型名合法但账号没开通通道
            if "channel not found" in text or "model_not_found" in text:
                hint = (
                    f"上游「{provider_name}」识别了模型「{requested_model}」，但你的 API Key 账号下**没有该模型的可用通道**。\n\n"
                    f"原因：你的账号没开通这个模型的访问权限（付费/订阅相关）。\n\n"
                    f"解决方法：\n"
                    f"  1. 登录 {provider.get('base_url') or '上游平台'} 控制台，开通该模型 / 充值；\n"
                    f"  2. 或在「API 设置」里把视频模型改成你账号已开通的型号（如 veo3-fast / veo2-fast / sora-2 等）。"
                )
                raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
            if "text.duration" in text or "specified duration is not supported" in text:
                hint = (
                    f"上游「{provider_name}」模型「{requested_model}」不支持当前时长参数。\n\n"
                    f"不同视频模型支持的时长不一样；如果选择了模型不支持的时长，上游可能报错，"
                    f"也可能自动按平台默认时长生成，例如 5 秒。\n\n"
                    f"请把视频时长切回该模型支持的值，或改用支持更长时长的视频模型。"
                )
                raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
            if "audio duration" in text.lower():
                too_long = "less than or equal" in text.lower() or "15.2" in text
                bound_hint = "太长（超过 15.2 秒）" if too_long else "太短（不足 1.8 秒）"
                hint = (
                    f"上游「{provider_name}」模型「{requested_model}」拒绝了参考音频：时长{bound_hint}。\n\n"
                    f"方舟 Seedance 的参考音频时长必须在 1.8 ~ 15.2 秒之间，"
                    f"请把音频裁剪到这个区间后再作为参考音频输入。"
                )
                raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
            if "inputimagesensitivecontentdetected" in text.lower() or "privacyinformation" in text.lower() or "may contain real person" in text.lower():
                hint = (
                    f"上游「{provider_name}」拦截了输入参考图，原因是图片里可能包含真人身份/隐私信息。\n\n"
                    f"这不是代码协议错误，而是火山视频模型的内容安全策略。\n\n"
                    f"建议你这样处理：\n"
                    f"  1. 改用非真人参考图，例如插画、AI 头像、商品图、场景图；\n"
                    f"  2. 先把真人脸做模糊、遮挡、裁掉，或转成明显的二次元/插画风；\n"
                    f"  3. 如果只是想做文生视频，先去掉参考图只保留文字提示词测试。"
                )
                raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
            raise HTTPException(status_code=exc.response.status_code, detail=f"上游视频接口错误：{text}") from exc
        except httpx.HTTPError as exc:
            log_net_error(f"视频 网络/TLS错误 provider={provider.get('id')} model={payload.model}", exc)
            raise HTTPException(status_code=502, detail=f"请求上游视频接口失败：{exc}") from exc
    @router.post("/api/canvas-chat")
    async def canvas_chat(payload: CanvasChatRequest):
        provider_id = str(payload.provider_id or "").strip()
        requested_model = str(payload.model or "").strip()
        mode = str(payload.mode or "chat").strip().lower()
        if mode not in {"chat", "optimize", "review"}:
            raise HTTPException(status_code=400, detail="对话模式不支持")
        if not provider_id:
            raise HTTPException(status_code=400, detail="未选择聊天平台，请先在 API 设置中配置聊天模型")
        provider = get_api_provider_exact(provider_id)
        configured_models = [str(item or "").strip() for item in (provider.get("chat_models") or []) if str(item or "").strip()]
        if not configured_models:
            raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider_id} 尚未配置聊天模型")
        if requested_model and requested_model not in configured_models:
            raise HTTPException(status_code=400, detail="所选聊天模型已不在当前平台配置中，请刷新 API 设置")
        chat_base, chat_hdrs, resolved_model = resolve_chat_provider(provider_id, requested_model, "")
        attachments = []
        for attachment in (payload.attachments or [])[:8]:
            image_url = canvas_chat_image_url(attachment)
            if not image_url:
                continue
            attachments.append({
                "url": image_url,
                "name": str(attachment.name or "图片")[:160],
                "title": str(attachment.title or "")[:160],
                "prompt": str(attachment.prompt or "")[:4000],
                "role": str(attachment.role or "product")[:40],
                "role_label": str(attachment.role_label or "产品参考")[:80],
                "node_id": str(attachment.node_id or "")[:80],
            })
        context_lines = []
        for index, item in enumerate(attachments, 1):
            detail = f"图片 {index}（{item['role_label']}）：{item['name']}"
            if item["node_id"]:
                detail += f"；节点ID：{item['node_id']}"
            if item["title"]:
                detail += f"；来自节点：{item['title']}"
            if item["prompt"]:
                detail += f"；节点当前提示词：{item['prompt']}"
            context_lines.append(detail)
        context_sections = []
        target = payload.target
        if target:
            target_title = str(target.title or target.node_id or "目标节点")[:160]
            target_prompt = str(target.current_prompt or "").strip()[:12000]
            target_detail = f"提示词写回目标：{target_title}"
            if target_prompt:
                target_detail += f"\n目标节点当前完整提示词：\n{target_prompt}"
            else:
                target_detail += "\n目标节点当前提示词为空。"
            context_sections.append(target_detail)
        if context_lines:
            context_sections.append("关联图片上下文：\n" + "\n".join(context_lines))
        context_text = "\n\n" + "\n\n".join(context_sections) if context_sections else ""
        system_text = (
            "你是原生智能画布里的 AI 视觉分析助手。你可以分析用户提供的图片、讨论产品结构和画面问题，"
            "并帮助用户改进生图提示词。不要声称已经执行图片生成、上传或修改文件；只返回分析和可操作建议。"
            "当用户要求局部修改提示词时，只改变用户明确指定的内容；未要求修改的产品外观、结构、比例、佩戴关系、"
            "构图、镜头、场景、光影、材质、文字与负面约束应尽量原样保留。"
        )
        if mode == "optimize":
            system_text += (
                " 当前任务是分析并优化提示词。请严格返回 JSON 对象，字段为 reply 和 optimized_prompt；"
                "reply 用中文简述问题与改动理由，optimized_prompt 是一段可直接写回图片节点的完整纯提示词。"
                "若用户只要求局部修改，optimized_prompt 必须以目标节点当前完整提示词为基础，仅替换必要片段，"
                "不要省略未修改内容，也不要在 optimized_prompt 外层加引号、Markdown 标题或解释。"
            )
        if mode == "review":
            system_text += (
                " 当前任务是批量审片。请严格返回 JSON 对象，字段为 reply 和 items；"
                "reply 用中文写整体审片结论；items 是数组，每个元素对应一个图片节点，字段为 node_id、title、issues、optimized_prompt。"
                "node_id 必须原样使用上下文给出的节点ID，不要编造；issues 用中文指出画面、产品结构、比例、材质、光影、文字等问题；"
                "optimized_prompt 是以该节点当前完整提示词为基础、可直接写回该节点的完整纯提示词。"
            )
        history = (payload.messages or [])[-24:]
        if not history:
            raise HTTPException(status_code=400, detail="对话内容不能为空")
        upstream_messages = [{"role": "system", "content": system_text}]
        last_index = len(history) - 1
        for index, message in enumerate(history):
            role = "assistant" if str(message.role or "").lower() == "assistant" else "user"
            text = str(message.text or "").strip()[:12000]
            if message.optimizedPrompt:
                text += "\n\n此前候选优化提示词：\n" + str(message.optimizedPrompt)[:12000]
            if index == last_index and role == "user" and context_text:
                text += context_text
            if index == last_index and role == "user" and attachments:
                content = [{"type": "text", "text": text}]
                content.extend({"type": "image_url", "image_url": {"url": item["url"]}} for item in attachments)
                upstream_messages.append({"role": role, "content": content})
            else:
                upstream_messages.append({"role": role, "content": text})
        raw_response = None
        try:
            async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
                req_body = {"model": resolved_model, "messages": upstream_messages}
                if is_apimart_provider(provider):
                    req_body["stream"] = False
                response = await client.post(f"{chat_base}/chat/completions", headers=chat_hdrs, json=req_body)
                response.raise_for_status()
                raw_response = response.json()
        except httpx.HTTPStatusError as exc:
            body = exc.response.text or ""
            friendly = friendly_chat_error_detail(body, resolved_model, provider)
            raise HTTPException(status_code=exc.response.status_code, detail=friendly or f"上游接口错误：{body}") from exc
        except httpx.HTTPError as exc:
            log_net_error(f"画布对话 网络/TLS错误 provider={provider_id} model={resolved_model}", exc)
            raise HTTPException(status_code=502, detail=f"请求上游接口失败：{exc}") from exc
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"解析上游响应失败：{exc}") from exc
        response_text = text_from_chat_response(raw_response).strip() if isinstance(raw_response, dict) else ""
        if mode in {"optimize", "review"}:
            reply, optimized_prompt, review_items = parse_canvas_chat_result(response_text)
        else:
            reply, optimized_prompt, review_items = response_text or "接口返回了空回复。", "", []
        return {"text": reply, "optimized_prompt": optimized_prompt, "review_items": review_items, "model": resolved_model}
    @router.post("/api/angle/generate")
    async def generate_angle_cloud(req: CloudGenRequest):
        api_root = modelscope_image_api_root()
        clean_token = modelscope_api_key(req.api_key)
        if not clean_token:
            raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

        headers = {
            "Authorization": f"Bearer {clean_token}",
            "Content-Type": "application/json",
            "X-ModelScope-Async-Mode": "true"
        }
        model = selected_model(req.model, "Qwen/Qwen-Image-Edit-2511")
        payload = {
            "model": model,
            "prompt": req.prompt.strip(),
            "image_url": [modelscope_image_url(url, max_size=1536) for url in req.image_urls]
        }
        if req.resolution:
            payload["size"] = modelscope_size(req.resolution)
        if req.loras is not None:
            payload["loras"] = req.loras

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                submit_res = await client.post(f"{api_root}/images/generations", headers=headers, json=payload)
                if submit_res.status_code != 200:
                    try:
                        detail = submit_res.json()
                    except:
                        detail = submit_res.text
                    raise HTTPException(status_code=submit_res.status_code, detail=detail)

                task_id = submit_res.json().get("task_id")
                print(f"Angle Task submitted, ID: {task_id}")

                for i in range(300):
                    await asyncio.sleep(2)
                    result = await client.get(
                        f"{api_root}/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    result.raise_for_status()
                    data = result.json()
                    status = str(data.get("task_status") or "").upper()

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_angle_{int(time.time())}.png"
                                    file_path = output_path_for(filename, "output")
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = output_url_for(filename, "output")
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {"timestamp": time.time(), "prompt": req.prompt, "images": [local_path], "type": "angle"}
                        save_to_history(record)
                        if req.client_id:
                            await runtime.manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED", "task_id": task_id}, req.client_id)
                        if runtime.GLOBAL_LOOP:
                            asyncio.run_coroutine_threadsafe(runtime.manager.broadcast_new_image(record), runtime.GLOBAL_LOOP)
                        return {"url": local_path, "task_id": task_id}

                    elif status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                        if req.client_id:
                            await runtime.manager.send_personal_message({"type": "cloud_status", "status": "FAILED", "task_id": task_id}, req.client_id)
                        raise HTTPException(status_code=502, detail=f"ModelScope task failed: {data}")

                    if i % 5 == 0 and req.client_id:
                        await runtime.manager.send_personal_message({
                            "type": "cloud_status", "status": f"{status} ({i}/300)",
                            "task_id": task_id, "progress": i, "total": 300
                        }, req.client_id)

                if req.client_id:
                    await runtime.manager.send_personal_message({"type": "cloud_status", "status": "TIMEOUT", "task_id": task_id}, req.client_id)
                return {"status": "timeout", "task_id": task_id, "message": "Task still pending"}

        except HTTPException:
            raise
        except Exception as e:
            print(f"Angle generation error: {e}")
            raise HTTPException(status_code=400, detail=str(e))
    @router.post("/generate")
    async def generate_cloud(req: CloudGenRequest):
        api_root = modelscope_image_api_root()
        clean_token = modelscope_api_key(req.api_key)
        if not clean_token:
            raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

        headers = {
            "Authorization": f"Bearer {clean_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "Tongyi-MAI/Z-Image-Turbo",
            "prompt": req.prompt.strip(),
            "size": modelscope_size(req.resolution),
            "n": 1
        }
        if req.loras is not None:
            payload["loras"] = req.loras

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                submit_res = await client.post(
                    f"{api_root}/images/generations",
                    headers={**headers, "X-ModelScope-Async-Mode": "true"},
                    json=payload
                )
                if submit_res.status_code != 200:
                    try:
                        detail = submit_res.json()
                    except:
                        detail = submit_res.text
                    raise HTTPException(status_code=submit_res.status_code, detail=detail)

                task_id = submit_res.json().get("task_id")
                print(f"Z-Image Task submitted, ID: {task_id}")

                for i in range(200):
                    await asyncio.sleep(3)
                    result = await client.get(
                        f"{api_root}/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    result.raise_for_status()
                    data = result.json()
                    status = str(data.get("task_status") or "").upper()

                    if i % 5 == 0:
                        print(f"Task {task_id} status check {i}: {status}")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_{int(time.time())}.png"
                                    file_path = output_path_for(filename, "output")
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = output_url_for(filename, "output")
                                else:
                                    local_path = img_url
                        except Exception as dl_e:
                            print(f"Download error: {dl_e}")
                            local_path = img_url

                        record = {"timestamp": time.time(), "prompt": req.prompt, "images": [local_path], "type": "cloud"}
                        save_to_history(record)
                        try:
                            await runtime.manager.broadcast_new_image(record)
                        except Exception:
                            pass
                        return {"url": local_path}

                    elif status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                        raise HTTPException(status_code=502, detail=f"ModelScope task failed: {data}")

                raise Exception("Cloud generation timeout")

        except HTTPException:
            raise
        except Exception as e:
            print(f"Cloud generation error: {e}")
            raise HTTPException(status_code=400, detail=str(e))
    @router.post("/api/ms/generate")
    async def ms_generate(req: MsGenerateRequest):
        api_root = modelscope_image_api_root()
        clean_token = modelscope_api_key(req.api_key)
        if not clean_token:
            raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写，或重新保存 ModelScope Token。")

        headers = {
            "Authorization": f"Bearer {clean_token}",
            "Content-Type": "application/json",
            "X-ModelScope-Async-Mode": "true"
        }
        payload = {
            "model": req.model,
            "prompt": req.prompt.strip(),
        }
        if req.width and req.height:
            payload["width"] = req.width
            payload["height"] = req.height
            payload["size"] = modelscope_size(req.size or f"{req.width}x{req.height}")
        elif req.size:
            payload["size"] = modelscope_size(req.size)
        if req.image_urls:
            payload["image_url"] = [modelscope_image_url(url, max_size=1536) for url in req.image_urls]
        if req.loras is not None:
            payload["loras"] = req.loras

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                submit_res = await client.post(
                    f"{api_root}/images/generations",
                    headers=headers,
                    json=payload
                )
                if submit_res.status_code != 200:
                    try:
                        detail = submit_res.json()
                    except:
                        detail = submit_res.text
                    raise HTTPException(status_code=submit_res.status_code, detail=detail)

                task_id = submit_res.json().get("task_id")
                print(f"MS Generate Task submitted ({req.model}), ID: {task_id}")

                TERMINAL_FAILED_STATUSES = {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}

                for i in range(300):
                    await asyncio.sleep(2)
                    try:
                        result = await client.get(
                            f"{api_root}/tasks/{task_id}",
                            headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                        )
                        data = result.json()
                        status = data.get("task_status")
                        print(f"MS Task {task_id} poll {i}: status={status}")

                        if status == "SUCCEED":
                            img_url = data["output_images"][0]
                            local_path = ""
                            try:
                                async with httpx.AsyncClient() as dl_client:
                                    img_res = await dl_client.get(img_url)
                                    if img_res.status_code == 200:
                                        filename = f"ms_{req.model.replace('/', '_').replace(':', '_')}_{int(time.time())}.png"
                                        file_path = output_path_for(filename, "output")
                                        with open(file_path, "wb") as f:
                                            f.write(img_res.content)
                                        local_path = output_url_for(filename, "output")
                                    else:
                                        local_path = img_url
                            except Exception:
                                local_path = img_url

                            record = {
                                "timestamp": time.time(),
                                "prompt": req.prompt,
                                "images": [local_path],
                                "type": "klein",
                                "model": req.model,
                            }
                            save_to_history(record)
                            if runtime.GLOBAL_LOOP:
                                asyncio.run_coroutine_threadsafe(runtime.manager.broadcast_new_image(record), runtime.GLOBAL_LOOP)
                            return {"url": local_path, "task_id": task_id}

                        elif status in TERMINAL_FAILED_STATUSES:
                            error_info = data.get("error_info") or data.get("message") or data.get("detail") or str(data)
                            raise HTTPException(status_code=502, detail=f"MS task {status}: {error_info}")

                    except HTTPException:
                        raise
                    except Exception as loop_e:
                        print(f"MS polling error: {loop_e}")
                        continue

                raise HTTPException(status_code=504, detail="MS 生图超时")

        except HTTPException:
            raise
        except Exception as e:
            print(f"MS generate error: {e}")
            raise HTTPException(status_code=400, detail=str(e))

    return router
