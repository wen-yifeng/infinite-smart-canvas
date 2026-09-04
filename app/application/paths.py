"""路径常量与持久化锁（Phase 1.2 自 main.py 机械搬移，未做语义改动）。"""

import os
from threading import Lock
from threading import RLock


# 迁移至 app/application/paths.py：三级 dirname 从 app/application/ 向上指回项目根
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATIC_DIR = os.path.join(BASE_DIR, "static")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
OUTPUT_INPUT_DIR = os.path.join(ASSETS_DIR, "input")
OUTPUT_OUTPUT_DIR = os.path.join(ASSETS_DIR, "output")
ASSET_LIBRARY_DIR = os.path.join(ASSETS_DIR, "library")
LOCAL_UPLOAD_DIR = os.path.join(ASSETS_DIR, "uploads")
HISTORY_FILE = os.path.join(BASE_DIR, "history.json")
API_ENV_FILE = os.path.join(BASE_DIR, "API", ".env")
DATA_DIR = os.path.abspath(os.path.expanduser(os.path.expandvars(os.getenv("SMART_CANVAS_DATA_DIR", os.path.join(BASE_DIR, "data")))))
CANVAS_DIR = os.path.join(DATA_DIR, "canvases")
CANVAS_TASK_DIR = os.path.join(DATA_DIR, "canvas_tasks")
MEDIA_PREVIEW_DIR = os.path.join(DATA_DIR, "media_previews")
CANVAS_LOG_DIR = os.path.join(DATA_DIR, "canvas_logs")
ASSET_LIBRARY_PATH = os.path.join(DATA_DIR, "asset_library.json")
PROMPT_LIBRARY_PATH = os.path.join(DATA_DIR, "prompt_libraries.json")
API_PROVIDERS_FILE = os.path.join(DATA_DIR, "api_providers.json")
GLOBAL_CONFIG_FILE = os.path.join(BASE_DIR, "global_config.json")
HISTORY_LOCK = Lock()
GLOBAL_CONFIG_LOCK = Lock()


CANVAS_LOCK = RLock()
