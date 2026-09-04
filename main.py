import json
import os
import sys
import asyncio
from contextlib import asynccontextmanager
import logging
from typing import Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Request
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# The bundled embedded Python runs in isolated mode and does not add the
# application directory to sys.path. Keep local service modules importable.
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)
from app.domain.canvas_repository import CanvasJsonRepository
from app.domain.canvas_log_repository import CanvasLogRepository
from app.api.canvases import (
    CanvasApiDependencies, CanvasCreateRequest, CanvasMetaUpdate,
    CanvasPatchRequest, CanvasSaveRequest, create_canvas_router,
)
from app.api.projects import (
    ProjectApiDependencies, ProjectCreateRequest, ProjectUpdateRequest,
    create_project_router,
)
from app.api.smart_canvas_agent import (
    SmartCanvasAgentApiDependencies, create_smart_canvas_agent_router,
)
from app.application.canvas_service import CanvasApplicationService
from app.application import runtime
from app.application.smart_canvas_agent_service import SmartCanvasAgentService
from app.application.project_service import ProjectApplicationService

QUIET_ACCESS_PATHS = {
    "/api/queue_status",
    "/api/canvases",
    "/api/canvases/trash",
}
QUIET_ACCESS_PREFIXES = (
    "/api/canvases/",
    "/api/smart-canvas-agent/",
)

class QuietAccessLogFilter(logging.Filter):
    def filter(self, record):
        args = record.args if isinstance(record.args, tuple) else ()
        if len(args) >= 3:
            path = str(args[2]).split("?", 1)[0]
            status = int(args[4]) if len(args) >= 5 and str(args[4]).isdigit() else 0
            quiet_dynamic = path.startswith("/api/smart-canvas-agent/") or any(path.startswith(prefix) and path.endswith("/meta") for prefix in QUIET_ACCESS_PREFIXES)
            if (path in QUIET_ACCESS_PATHS or quiet_dynamic) and status < 400:
                return False
        message = record.getMessage()
        if any(f'"GET {path}' in message and '" 200' in message for path in QUIET_ACCESS_PATHS):
            return False
        if 'GET /api/canvases/' in message and '/meta' in message and '" 200' in message:
            return False
        return True

logging.getLogger("uvicorn.access").addFilter(QuietAccessLogFilter())


def _local_cors_origins():
    port = os.getenv("SMART_CANVAS_PORT", "3001")
    return [f"http://127.0.0.1:{port}", f"http://localhost:{port}"]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """启动钩子（取代已弃用的 @app.on_event，行为与原 startup 一致）。"""
    runtime.GLOBAL_LOOP = asyncio.get_running_loop()
    sync_static_html_versions()
    # 启动时整理资产库：给所有图片分组（含默认角色/场景）建好文件夹，并把根目录里的旧素材归整进去。
    try:
        await asyncio.to_thread(migrate_asset_library_into_dirs)
    except Exception as exc:
        print(f"资产库分组整理失败: {exc}")
    # 修复历史遗留的双重扩展名素材（foo.png.png → foo.png），否则这些卡片无法显示
    try:
        await asyncio.to_thread(migrate_double_extension_uploads)
    except Exception as exc:
        print(f"修复双重扩展名素材失败: {exc}")
    # 纠正内容与扩展名不符的图片（如 WebP 内容却叫 .png），否则严格客户端解不出来
    try:
        await asyncio.to_thread(migrate_mislabeled_image_extensions)
    except Exception as exc:
        print(f"纠正图片扩展名失败: {exc}")
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # 本地服务：前端与 API 同源，CORS 仅需覆盖本机回环地址的显式跨源调用
    allow_origins=_local_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Phase 1.2 引擎搬移：运行时对象（WS 管理器与事件循环槽位）（app/application/runtime.py），main 保留原名别名 ----
from app.application.runtime import (
    ConnectionManager, manager, GLOBAL_LOOP,
)

# ModelScope 仓库默认分支为 master；raw 网页路径会返回 HTML，必须用仓库文件 API 才能拿到纯文本
# 注意：.ai 站命名空间为小写 daniel8152，API 路径大小写敏感（推送/文件 API 用大写会 404/拒绝）

@app.websocket("/ws/stats")
async def websocket_endpoint(websocket: WebSocket, client_id: str = None):
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        await manager.disconnect(websocket, client_id)
    except Exception as e:
        print(f"WS Error: {e}")
        await manager.disconnect(websocket, client_id)

# --- 配置区域 ---


# ---- Phase 1.2 引擎搬移：路径常量与持久化锁（app/application/paths.py），main 保留原名别名 ----
from app.application.paths import (
    BASE_DIR, STATIC_DIR, OUTPUT_DIR, ASSETS_DIR, OUTPUT_INPUT_DIR, OUTPUT_OUTPUT_DIR, ASSET_LIBRARY_DIR, LOCAL_UPLOAD_DIR, HISTORY_FILE, API_ENV_FILE, DATA_DIR, CANVAS_DIR, CANVAS_TASK_DIR, MEDIA_PREVIEW_DIR, CANVAS_LOG_DIR, ASSET_LIBRARY_PATH, PROMPT_LIBRARY_PATH, API_PROVIDERS_FILE, GLOBAL_CONFIG_FILE, HISTORY_LOCK, GLOBAL_CONFIG_LOCK,
)

# ---- Phase 1.2 引擎搬移：画布记录/列表与画布素材抽取辅助（app/application/canvas_assets.py），main 保留原名别名 ----
from app.application.canvas_assets import (
    CANVAS_TRASH_RETENTION_MS, is_smart_canvas, normalize_canvas_kind, DEFAULT_PROJECT_ID, CANVAS_COLORS, normalize_canvas_color, canvas_cover_url, canvas_record, _canvas_summary, cleanup_expired_canvas_trash, iter_canvas_records, _canvas_list_sort_key, list_canvases, list_deleted_canvases, canvas_asset_url_value, canvas_asset_downloadable_url, canvas_asset_kind, canvas_asset_name, iter_canvas_asset_values, canvas_node_title, extract_canvas_assets, canvas_assets_index,
)

# ---- Phase 1.2 引擎搬移：本地素材：上传树/导入/素材库/分类（app/application/local_assets.py），main 保留原名别名 ----
from app.application.local_assets import (
    LOCAL_IMAGE_IMPORT_MAX_BYTES, LOCAL_IMAGE_IMPORT_EXTS, normalize_local_image_path, _sha256_file, _canonical_input_filename, _existing_input_filename_for_hash, import_local_image_file, default_asset_library, normalize_asset_library, AVATAR_LEGACY_FLAT_FIELDS, migrate_asset_item_registrations, load_asset_library, sort_asset_library_items, asset_library_media_kind, asset_library_safe_extension, unique_asset_category_dir, remove_asset_library_file, make_asset_library_item, ASSET_CLASSIFICATION_PROMPT, ASSET_CLASSIFICATION_PROMPT_FILE, load_asset_classification_prompt, ASSET_CLASSIFICATION_DIMENSION_NAMES, _local_upload_classification_path, _safe_asset_tag, normalize_asset_classification, parse_asset_classification_text, _read_local_upload_classification, _write_local_upload_classification, asset_classification_prompt, classify_image_with_provider, classify_asset_image_best_effort, migrate_asset_library_into_dirs, save_asset_library, find_asset_category, find_asset_library, find_asset_category_in_library, find_asset_category_with_library, sanitize_asset_name, _local_upload_kind_ext, _local_upload_display_name, _local_upload_rel_path, _local_upload_abs, _local_upload_safe_path, _local_upload_safe_folder, _local_upload_safe_folder_name, _local_upload_safe_file_stem, _local_upload_caption_path, _read_local_upload_caption, _local_upload_item, _local_upload_folder_node, _local_upload_tree_and_items, _DOUBLE_EXT_RE, _DOUBLE_EXT_MEDIA, migrate_double_extension_uploads, _sniff_image_ext_bytes, _sniff_image_ext, migrate_mislabeled_image_extensions, find_asset_item_in_library,
)


# ---- Phase 1.2 引擎搬移：画布全局锁追加（app/application/paths.py），main 保留原名别名 ----
from app.application.paths import (
    CANVAS_LOCK,
)
# Repository boundary for the legacy per-canvas JSON store. Route contracts
# stay unchanged while atomic writes, schema normalization and per-canvas
# locking move out of this monolithic module.
CANVAS_REPOSITORY = CanvasJsonRepository(CANVAS_DIR, global_lock=CANVAS_LOCK)
CANVAS_LOG_REPOSITORY = CanvasLogRepository(CANVAS_LOG_DIR, global_lock=CANVAS_LOCK)
runtime.CANVAS_REPOSITORY = CANVAS_REPOSITORY

# ---- Phase 1.2 引擎搬移：Provider 清单、env 配置与协议归一（app/application/provider_config.py），main 保留原名别名 ----
from app.application.provider_config import (
    CHAT_MODELS,
    IMAGE_MODELS,
    VIDEO_MODELS,
    PROVIDER_ID_RE, SUPPORTED_PROVIDER_PROTOCOLS, SUPPORTED_IMAGE_REQUEST_MODES, LINGJING_DEFAULT_BASE_URL, VOLCENGINE_DEFAULT_BASE_URL, VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION, ensure_runtime_config_files, load_env_file, AI_BASE_URL, AI_API_KEY, PUBLIC_BASE_URL, PUBLIC_MEDIA_BASE_URL, MODELSCOPE_API_KEY, MODELSCOPE_CHAT_BASE_URL, MODELSCOPE_DEFAULT_IMAGE_MODELS, MODELSCOPE_DEFAULT_CHAT_MODELS, _MODELSCOPE_CONFIGURED_CHAT_MODELS, MODELSCOPE_CHAT_MODELS, MODELSCOPE_DEFAULT_IMAGE_MODEL, MODELSCOPE_DEFAULT_CHAT_MODEL, MODELSCOPE_DEFAULT_LORAS, MODELSCOPE_DEFAULTS_VERSION, CHAT_MODEL, IMAGE_MODEL, AI_REQUEST_TIMEOUT, IMAGE_POLL_INTERVAL, IMAGE_TASK_TIMEOUT, APIMART_IMAGE_TASK_TIMEOUT, APIMART_IMAGE_POLL_INTERVAL, APIMART_IMAGE_INITIAL_POLL_DELAY, TUDOU_ASYNC_IMAGE_TASK_TIMEOUT, TUDOU_ASYNC_IMAGE_POLL_INTERVAL, TUDOU_ASYNC_IMAGE_INITIAL_POLL_DELAY, VIDEO_POLL_TIMEOUT, ONLINE_IMAGE_PROMPT_MAX_LENGTH, VIDEO_PROMPT_MAX_LENGTH, ONLINE_IMAGE_REFERENCE_MAX, model_list, reload_env_globals, provider_key_env, volcengine_access_key_env, volcengine_secret_key_env, read_api_env_value, provider_env_key_value, volcengine_access_key_value, volcengine_secret_key_value, volcengine_provider_api_key, mask_secret, strip_auth_scheme, bearer_auth_value, default_api_providers, merge_default_api_providers, normalize_model_list, model_list_from_values, normalize_ms_loras, normalize_endpoint_override, normalize_image_request_mode, LOCKED_RECOMMENDED_PROVIDER_RULES, locked_recommended_provider_rule, apply_locked_recommended_model_rules, provider_endpoint_url, normalize_provider, load_api_providers, save_api_providers, public_provider, public_api_providers, get_primary_provider_id, get_api_provider, get_api_provider_exact, modelscope_provider_config, modelscope_api_key, modelscope_api_root, modelscope_image_api_root, env_quote, update_env_values, api_headers, selected_model, provider_protocol, PER_MODEL_PROTOCOL_OPTIONS, FIXED_PROTOCOL_PROVIDER_IDS, normalize_model_protocols, normalize_model_name_map, effective_protocol, is_tudou_base_url, is_tudou_provider, is_tudou_async_image_mode, is_tudou_async_image_model, is_apimart_provider, detect_image_request_mode, effective_image_request_mode, is_gemini_provider, is_volcengine_provider, is_yuli_provider, is_lingjing_provider, is_agnes_provider, AVATAR_SUPPORTED_PLATFORMS, avatar_platform_for_provider, provider_supports_avatar,
)

# ---- Phase 1.2 引擎搬移：上游模型探测与协议归一（app/application/model_probe.py），main 保留原名别名 ----


ensure_runtime_config_files()
load_env_file()


# ---- Phase 1.2 引擎搬移：聊天引擎、附件读取与图片描述（app/application/chat_engine.py），main 保留原名别名 ----

FIELD_LABELS = {
    "prompt": "提示词",
    "message": "文本",
    "system_prompt": "系统提示词",
}

def friendly_validation_error(errors):
    parts = []
    for err in errors or []:
        loc = [str(item) for item in err.get("loc", []) if item != "body"]
        field = loc[-1] if loc else ""
        label = FIELD_LABELS.get(field, field or "请求参数")
        ctx = err.get("ctx") or {}
        limit = ctx.get("limit_value") or ctx.get("max_length") or ctx.get("min_length")
        err_type = str(err.get("type") or "")
        msg = str(err.get("msg") or "")
        if "max_length" in err_type or "at most" in msg:
            parts.append(f"{label}过长：当前内容超过后端上限 {limit} 个字符，请缩短后再生成。")
        elif "min_length" in err_type:
            parts.append(f"{label}不能为空。")
        else:
            parts.append(f"{label}格式不正确：{msg}")
    return "\n".join(parts) or "请求参数不正确。"

@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": friendly_validation_error(exc.errors()), "errors": exc.errors()},
    )


os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(OUTPUT_INPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OUTPUT_DIR, exist_ok=True)
os.makedirs(ASSET_LIBRARY_DIR, exist_ok=True)
os.makedirs(LOCAL_UPLOAD_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(CANVAS_DIR, exist_ok=True)

# 以下页面必须在 /static 挂载之前注册：Starlette 按注册顺序匹配，
# 晚于挂载注册的同路径路由永远不会命中。
# 走 static_html_response 后，页面获得 no-cache 响应头，且页内所有
# /static 资源的 ?v= 由文件 mtime 自动生成，无需人工维护版本号。
VERSIONED_HTML_PAGES = ("canvas-list.html", "smart-canvas.html", "api-settings.html")


def _register_versioned_page(filename: str):
    async def _page():
        return static_html_response(filename)

    app.get(f"/static/{filename}", include_in_schema=False)(_page)


for _page_name in VERSIONED_HTML_PAGES:
    _register_versioned_page(_page_name)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

# --- Pydantic 模型 ---


# ---- Phase 1.2 引擎搬移：静态页版本戳与响应（app/application/web_pages.py），main 保留原名别名 ----
from app.application.web_pages import (
    current_app_version, versioned_static_html, sync_static_html_versions, static_html_response,
)


# ---- Phase 1.2 引擎搬移：提示词库与内置模板（app/application/prompt_library.py），main 保留原名别名 ----


# 缓存 GitHub Tree API 响应（含 ETag），减少 60 次/h 限流压力
GITHUB_TREE_CACHE: Dict[str, Any] = {"etag": "", "data": None, "expires_at": 0.0}


# ---- Phase 1.2 引擎搬移：生成/对话请求模型（app/application/schemas.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：画布生成任务运行时（创建/更新/执行/广播）（app/application/task_runtime.py），main 保留原名别名 ----


# --- 负载均衡 ---


# ---- Phase 1.2 引擎搬移：远程媒体读取与同源校验追加（app/application/output_storage.py），main 保留原名别名 ----


# --- 辅助工具 ---


# 纯预览/对比类节点：其输出只用于界面展示（PreviewImage、rgthree 的 Image Comparer 等），
# show/utility 类调试文本节点：ShowText、各种 *Anything、CR Text、MathExpression、note 等，
# 它们的 ui 文本基本是调试信息，不应混进最终结果。


# ---- Phase 1.2 引擎搬移：输出存储、媒体预览与生成历史（app/application/output_storage.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：跨域基础工具（app/application/common.py），main 保留原名别名 ----
from app.application.common import (
    now_ms,
)


# ===== 项目（按项目分类管理画布）=====
PROJECTS_PATH = os.path.join(DATA_DIR, "projects.json")


CANVAS_REPOSITORY.set_summarizer(_canvas_summary)


PROJECT_APPLICATION_SERVICE = ProjectApplicationService(
    projects_path=PROJECTS_PATH,
    canvas_repository=CANVAS_REPOSITORY,
    iter_canvas_records=lambda: iter_canvas_records(include_deleted=False),
    now_ms=now_ms,
    lock=CANVAS_LOCK,
)
from app.api.generation import create_generation_router
from app.api.platform import create_platform_router
from app.api.assets import create_assets_router
from app.api.prompts import create_prompts_router
from app.api.storage import create_storage_router
app.include_router(create_project_router(ProjectApiDependencies(
    service=PROJECT_APPLICATION_SERVICE,
)))


# Canvas HTTP is composed here, after legacy storage helpers are defined.
# The router itself has no import dependency on this monolithic module.
CANVAS_APPLICATION_SERVICE = CanvasApplicationService(
    repository=CANVAS_REPOSITORY,
    now_ms=now_ms,
    normalize_kind=normalize_canvas_kind,
    normalize_color=normalize_canvas_color,
    canvas_record=canvas_record,
    list_canvases=list_canvases,
    list_deleted_canvases=list_deleted_canvases,
    log_repository=CANVAS_LOG_REPOSITORY,
)
app.include_router(create_canvas_router(CanvasApiDependencies(
    service=CANVAS_APPLICATION_SERVICE,
    broadcast_canvas_updated=manager.broadcast_canvas_updated,
)))
SMART_CANVAS_AGENT_SERVICE = SmartCanvasAgentService(
    CANVAS_APPLICATION_SERVICE,
    import_local_images=lambda paths: [
        import_local_image_file(normalize_local_image_path(path)) for path in paths
    ],
)
runtime.CANVAS_APPLICATION_SERVICE = CANVAS_APPLICATION_SERVICE
app.include_router(create_smart_canvas_agent_router(SmartCanvasAgentApiDependencies(
    service=SMART_CANVAS_AGENT_SERVICE,
    broadcast_canvas_updated=manager.broadcast_canvas_updated,
)))


# ---- Phase 1.2 引擎搬移：画布迁移与压缩包导入实现（app/application/canvas_transfer.py），main 保留原名别名 ----
from app.application.canvas_transfer import (
    CanvasMigrationRequest, _connected_canvas_node_ids, _node_bottom, migrate_canvas_nodes_impl, CANVAS_IMPORT_MAX_BYTES, CANVAS_IMPORT_MAX_FILES, _canvas_import_asset_category, _canvas_import_filename_for_hash, _existing_canvas_import_file, _materialize_canvas_import_asset, _rewrite_canvas_import_urls, import_canvas_archive_impl,
)


# ---- Phase 1.2 引擎搬移：网络错误日志工具追加（app/application/common.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：图片生成引擎与响应解析（app/application/image_engine.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：视频生成引擎与 apimart 媒体上传（app/application/video_engine.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：公网 URL 辅助追加（app/application/provider_config.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：本地素材公网 URL 追加（app/application/output_storage.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：apimart 视频引用归一追加（app/application/video_engine.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：头像资产提交与查询（apimart/volcengine ark）（app/application/avatar_assets.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：volcengine 公网资产 URL 追加（app/application/avatar_assets.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：本地媒体云上传辅助追加（app/application/output_storage.py），main 保留原名别名 ----


# ---- Phase 1.2 引擎搬移：尺寸解析工具追加（app/application/provider_config.py），main 保留原名别名 ----


# --- 路由接口 ---

@app.get("/")
async def index():
    return static_html_response("canvas-list.html")


# --- ModelScope Token (从 env 读取，不再支持通过 UI 修改) ---

# --- 在线生图 (COMFLY) ---


# --- Canvas Video ---


# --- Canvas LLM ---

# --- 对话管理 ---


# --- 画布管理 ---


# --- GPT 对话 ---


# --- 历史记录 ---


# --- ModelScope 角度控制 ---


# --- ModelScope Z-Image 云端生图 ---


# --- ModelScope 通用图片生成（支持图生图） ---


# ---- Phase 1 拆分：生成任务路由（app/api/generation.py），引擎经 deps 注入 ----

app.include_router(create_generation_router())


# ---- Phase 1 拆分：平台配置与 Provider 路由（app/api/platform.py），引擎经 deps 注入 ----

app.include_router(create_platform_router())


# ---- Phase 1 拆分：素材库路由（app/api/assets.py），引擎经 deps 注入 ----

app.include_router(create_assets_router())


# ---- Phase 1 拆分：提示词库路由（app/api/prompts.py），引擎经 deps 注入 ----

app.include_router(create_prompts_router())


# ---- Phase 1 拆分：存储/媒体/本地素材路由（app/api/storage.py），引擎经 deps 注入 ----

app.include_router(create_storage_router())


# --- 画布迁移/导入路由（实现在 app/application/canvas_transfer.py，DATA_CONTRACT §5） ---

@app.post("/api/canvas-migrations")
async def migrate_canvas_nodes(payload: CanvasMigrationRequest):
    return await migrate_canvas_nodes_impl(payload)


@app.post("/api/canvas-import")
async def import_canvas_archive(archive: UploadFile = File(...), project: str = Form("default")):
    return await import_canvas_archive_impl(archive, project)


if __name__ == "__main__":
    import uvicorn
    # 关闭服务端协议级 WebSocket ping：部分客户端（如 PS UXP 面板）不会自动回 pong，
    # 默认 20s ping/20s 超时会把这些连接每隔一会儿就踢掉造成"频繁断连"。
    # 客户端有自己的应用层心跳 + 断线重连兜底，这里禁用协议 ping 更稳。
    port = int(os.getenv("SMART_CANVAS_PORT", "3001"))
    uvicorn.run(app, host="0.0.0.0", port=port,
                ws_ping_interval=None, ws_ping_timeout=None)
