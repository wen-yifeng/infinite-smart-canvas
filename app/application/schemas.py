"""生成/对话请求模型（Phase 1.2 自 main.py 机械搬移，未做语义改动）。"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.application.provider_config import (
    ONLINE_IMAGE_PROMPT_MAX_LENGTH,
    VIDEO_PROMPT_MAX_LENGTH,
    VOLCENGINE_DEFAULT_PROJECT_NAME,
    VOLCENGINE_DEFAULT_REGION,
)




class AIReference(BaseModel):
    url: str = ""
    name: str = ""
    role: str = ""
    kind: str = ""
    mime: str = ""
class OnlineImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    provider_id: str = "comfly"
    model: str = ""
    size: str = "1024x1024"
    quality: str = "auto"
    n: int = 1
    reference_images: List[AIReference] = []
class CanvasVideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=VIDEO_PROMPT_MAX_LENGTH)
    provider_id: str = "comfly"
    model: str = "veo3-fast"
    duration: int = 5
    aspect_ratio: str = "16:9"
    resolution: str = ""
    size: str = ""
    images: List[AIReference] = []
    videos: List[str] = []
    audios: List[str] = []
    enhance_prompt: bool = False
    enable_upsample: bool = False
    watermark: bool = False
    seed: Optional[int] = None
    camerafixed: bool = False
    return_last_frame: bool = False
    generate_audio: bool = False
    multimodal: bool = False
    trusted_asset: bool = False
class ApiProviderPayload(BaseModel):
    id: str = ""
    name: str = ""
    base_url: str = ""
    protocol: str = "openai"
    image_request_mode: str = "openai"
    image_generation_endpoint: str = ""
    image_edit_endpoint: str = ""
    enabled: bool = True
    primary: bool = False
    image_models: List[str] = []
    chat_models: List[str] = []
    video_models: List[str] = []
    model_names: Dict[str, str] = {}
    model_protocols: Dict[str, str] = {}
    ms_loras: List[Dict[str, Any]] = []
    ms_defaults_version: int = 0
    volcengine_project_name: str = VOLCENGINE_DEFAULT_PROJECT_NAME
    volcengine_region: str = VOLCENGINE_DEFAULT_REGION
    volcengine_access_key_id: Optional[str] = None
    volcengine_secret_access_key: Optional[str] = None
    api_key: Optional[str] = None
    clear_key: bool = False
    clear_volcengine_access_key_id: bool = False
    clear_volcengine_secret_access_key: bool = False
class CanvasChatMessage(BaseModel):
    id: str = ""
    role: str = "user"
    text: str = ""
    optimizedPrompt: str = ""
    createdAt: Optional[float] = None
class CanvasChatAttachment(BaseModel):
    url: str = ""
    name: str = ""
    node_id: str = ""
    image_index: int = 0
    title: str = ""
    prompt: str = ""
    role: str = "product"
    role_label: str = "产品参考"
class CanvasChatTarget(BaseModel):
    node_id: str = ""
    title: str = ""
    current_prompt: str = ""
class CanvasChatRequest(BaseModel):
    provider_id: str = ""
    model: str = ""
    mode: str = "chat"
    messages: List[CanvasChatMessage] = Field(default_factory=list)
    target: Optional[CanvasChatTarget] = None
    attachments: List[CanvasChatAttachment] = Field(default_factory=list)
