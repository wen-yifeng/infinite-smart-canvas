"""Pure validation and node-building helpers for Agent image-to-image staging."""
from __future__ import annotations

from copy import deepcopy
import html
import os
from pathlib import Path
import re
import time
import uuid
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Tuple
from urllib.parse import urlparse

SUPPORTED_LOCAL_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
PUBLIC_PATH_PREFIXES = ("/output/", "/assets/", "/static/")
GROUP_SAFE_GAP = 240
DEFAULT_STAGED_NODE_GAP_X = 2000
DEFAULT_NODE_WIDTH = 650
DEFAULT_NODE_HEIGHT = 500
SINGLE_NODE_WIDTH = 440
MEDIA_NODE_HEIGHT = 440
MULTI_NODE_MAX_WIDTH = 820
MAX_STAGE_NODES = 100
MAX_STAGE_REFERENCES = 500
FORBIDDEN_PROMPT_MARKERS = ("【参考图】", "【输出规格】")
LOCAL_IMAGE_PATH_RE = re.compile(
    r"(?i)(?:[a-z]:[\\/]|file:///)[^\r\n<>\"']+?\.(?:png|jpe?g|webp|gif)(?=$|[\s,，;；)）])"
)
MARKDOWN_HEADING_RE = re.compile(r"(?m)^\s{0,3}#{1,6}\s+")


class SmartCanvasImageStageError(ValueError):
    """Raised when an image-to-image staging request is unsafe or malformed."""


def _section(text: str, marker: str) -> str:
    start = text.find(marker)
    if start < 0:
        return ""
    start += len(marker)
    next_marker = text.find("【", start)
    end = len(text) if next_marker < 0 else next_marker
    return text[start:end].strip()


def normalize_prompt(raw: Any) -> str:
    """Keep executable prompt text while excluding prompt-document metadata."""
    text = str(raw or "").replace("\ufeff", "").replace("\r\n", "\n").strip()
    if not text:
        raise SmartCanvasImageStageError("图生图提示词不能为空")

    if "【最终提示词】" in text:
        final_prompt = _section(text, "【最终提示词】")
        negative = _section(text, "【负面要求】")
        if not final_prompt:
            raise SmartCanvasImageStageError("【最终提示词】内容不能为空")
        text = final_prompt
        if negative:
            text = f"{text}\n\n负面要求：\n{negative}"

    text = text.replace("```text", "").replace("```markdown", "").replace("```", "")
    text = MARKDOWN_HEADING_RE.sub("", text).strip()
    if any(marker in text for marker in FORBIDDEN_PROMPT_MARKERS):
        raise SmartCanvasImageStageError("提示词中不能包含【参考图】或【输出规格】，请只提供最终生成指令")
    if LOCAL_IMAGE_PATH_RE.search(text):
        raise SmartCanvasImageStageError("提示词中不能包含本地图片路径；请通过 references 传入素材")
    if len(text) > 100_000:
        raise SmartCanvasImageStageError("图生图提示词过长")
    if not text:
        raise SmartCanvasImageStageError("图生图提示词不能为空")
    return text


def normalize_reference(value: Any) -> Dict[str, str]:
    text = str(value or "").strip().strip('"').strip("'")
    if not text:
        raise SmartCanvasImageStageError("参考素材路径为空")
    parsed = urlparse(text)
    if parsed.scheme.lower() in {"http", "https"}:
        return {"kind": "url", "value": text}
    if text.startswith(PUBLIC_PATH_PREFIXES):
        return {"kind": "url", "value": text}

    expanded = os.path.abspath(os.path.expandvars(os.path.expanduser(text)))
    path = Path(expanded)
    if not path.is_file():
        raise SmartCanvasImageStageError(f"参考素材不存在：{expanded}")
    if path.suffix.lower() not in SUPPORTED_LOCAL_EXTENSIONS:
        raise SmartCanvasImageStageError(f"不支持的参考素材格式：{expanded}")
    return {"kind": "local", "value": str(path)}


def reference_key(reference: Mapping[str, Any]) -> str:
    value = str(reference.get("value") or "")
    if reference.get("kind") == "local":
        return "local:" + os.path.normcase(os.path.normpath(value))
    return "url:" + value


def unique_references(values: Iterable[Any]) -> List[Dict[str, str]]:
    result: List[Dict[str, str]] = []
    seen: set[str] = set()
    for value in values:
        reference = normalize_reference(value)
        key = reference_key(reference)
        if key in seen:
            continue
        seen.add(key)
        result.append(reference)
    return result


def prepare_stage_nodes(raw_nodes: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise SmartCanvasImageStageError("stage_image_prompt requires a non-empty nodes list")
    if len(raw_nodes) > MAX_STAGE_NODES:
        raise SmartCanvasImageStageError(f"单批最多暂存 {MAX_STAGE_NODES} 个节点")

    prepared: List[Dict[str, Any]] = []
    reference_total = 0
    for index, raw in enumerate(raw_nodes, start=1):
        if not isinstance(raw, dict):
            raise SmartCanvasImageStageError(f"nodes[{index}] 必须是对象")
        prompt = normalize_prompt(raw.get("prompt"))
        references = raw.get("references")
        if not isinstance(references, list) or not references:
            raise SmartCanvasImageStageError(f"nodes[{index}] 至少需要一张 references")
        normalized_references = unique_references(references)
        if not normalized_references:
            raise SmartCanvasImageStageError(f"nodes[{index}] 至少需要一张有效 references")
        reference_total += len(normalized_references)
        if reference_total > MAX_STAGE_REFERENCES:
            raise SmartCanvasImageStageError(f"单批最多暂存 {MAX_STAGE_REFERENCES} 个参考素材")

        has_relative_position = raw.get("relative_position") is not None
        position = raw.get("relative_position") or {}
        if not isinstance(position, dict):
            raise SmartCanvasImageStageError(f"nodes[{index}] 的 relative_position 必须是对象")
        try:
            relative_position = {
                "x": float(position.get("x") or 0),
                "y": float(position.get("y") or 0),
            }
        except (TypeError, ValueError) as exc:
            raise SmartCanvasImageStageError(f"nodes[{index}] 的 relative_position 必须是数值") from exc

        prepared.append({
            "node_id": str(raw.get("node_id") or f"smart_agent_{uuid.uuid4().hex[:16]}"),
            "node_title": str(raw.get("node_title") or "")[:200],
            "prompt": prompt,
            "references": normalized_references,
            "relative_position": relative_position,
            "has_relative_position": has_relative_position,
        })
    return prepared


def approximate_rect(node: Mapping[str, Any]) -> Tuple[float, float, float, float]:
    x = float(node.get("x") or 0)
    y = float(node.get("y") or 0)
    node_type = str(node.get("type") or "")
    if node_type == "smart-prompt":
        return x, y, float(node.get("w") or 316), float(node.get("h") or 240)
    if node_type == "smart-loop":
        return x, y, float(node.get("w") or 340), float(node.get("h") or 168)
    if node_type == "smart-group":
        return x, y, float(node.get("w") or 340), float(node.get("h") or 286)
    return x, y, float(node.get("w") or DEFAULT_NODE_WIDTH), float(node.get("h") or DEFAULT_NODE_HEIGHT)


def group_anchor(canvas: Mapping[str, Any]) -> Tuple[float, float]:
    viewport = canvas.get("viewport") if isinstance(canvas.get("viewport"), dict) else {}
    scale = float(viewport.get("scale") or 1)
    if not 0.02 <= scale <= 8:
        scale = 1
    vx = float(viewport.get("x") or 0)
    vy = float(viewport.get("y") or 0)
    existing = [approximate_rect(node) for node in canvas.get("nodes", []) if isinstance(node, dict)]
    if existing:
        left = min(x for x, _y, _w, _h in existing)
        bottom = max(y + h for _x, y, _w, h in existing)
        return round(left, 2), round(bottom + GROUP_SAFE_GAP, 2)
    return round((150 - vx) / scale, 2), round((150 - vy) / scale, 2)


def staged_node_width(item: Mapping[str, Any]) -> float:
    reference_count = len(item.get("references") or [])
    if reference_count <= 1:
        return float(SINGLE_NODE_WIDTH)
    return float(min(
        MULTI_NODE_MAX_WIDTH,
        reference_count * MEDIA_NODE_HEIGHT + max(0, reference_count - 1) * 8,
    ))


def positioned_group(canvas: Mapping[str, Any], items: Sequence[Mapping[str, Any]]) -> List[Tuple[float, float]]:
    anchor_x, anchor_y = group_anchor(canvas)
    if len(items) > 1 and not any(bool(item.get("has_relative_position")) for item in items):
        raw_positions = []
        next_x = 0.0
        for item in items:
            raw_positions.append({"x": next_x, "y": 0.0})
            next_x += staged_node_width(item) + DEFAULT_STAGED_NODE_GAP_X
    else:
        raw_positions = [item.get("relative_position") or {"x": 0, "y": 0} for item in items]
    min_x = min(float(position.get("x") or 0) for position in raw_positions)
    min_y = min(float(position.get("y") or 0) for position in raw_positions)
    return [
        (
            round(anchor_x + float(position.get("x") or 0) - min_x, 2),
            round(anchor_y + float(position.get("y") or 0) - min_y, 2),
        )
        for position in raw_positions
    ]


def _clean_image(image: Mapping[str, Any], index: int) -> Dict[str, str] | None:
    url = str(image.get("url") or "").strip()
    if not url:
        return None
    return {
        "url": url,
        "name": str(image.get("name") or f"reference-{index + 1}"),
        "kind": str(image.get("kind") or "image"),
    }


def direct_image(reference: Mapping[str, Any], index: int) -> Dict[str, str]:
    value = str(reference.get("value") or "")
    name = Path(urlparse(value).path).name or f"reference-{index + 1}"
    return {"url": value, "name": name, "kind": "image"}


def build_node(item: Mapping[str, Any], images: Sequence[Mapping[str, Any]], x: float, y: float) -> Dict[str, Any]:
    clean_images = [clean for index, image in enumerate(images) if (clean := _clean_image(image, index))]
    if not clean_images:
        raise SmartCanvasImageStageError("图生图节点没有可用参考素材")
    requested_title = str(item.get("node_title") or "").strip()
    title = requested_title or ("Group" if len(clean_images) > 1 else "Image")
    width = staged_node_width(item)
    prompt = str(item.get("prompt") or "")
    return {
        "id": str(item.get("node_id") or f"smart_agent_{uuid.uuid4().hex[:16]}"),
        "type": "smart-image",
        "x": x,
        "y": y,
        "title": title,
        "images": clean_images,
        "w": width,
        "h": MEDIA_NODE_HEIGHT,
        "scale": 1,
        "promptDraftHtml": html.escape(prompt, quote=True),
        "promptDraftText": prompt,
        "promptDraftTouched": True,
        "created_at": int(time.time() * 1000),
        "createdBy": "smart-canvas-agent",
    }


def local_paths(items: Sequence[Mapping[str, Any]]) -> List[str]:
    result: List[str] = []
    seen: set[str] = set()
    for item in items:
        for reference in item.get("references") or []:
            if reference.get("kind") != "local":
                continue
            value = str(reference.get("value") or "")
            key = os.path.normcase(os.path.normpath(value))
            if key not in seen:
                seen.add(key)
                result.append(value)
    return result


def imported_reference_map(paths: Sequence[str], imported: Sequence[Mapping[str, Any]]) -> Dict[str, Dict[str, Any]]:
    if len(paths) != len(imported):
        raise SmartCanvasImageStageError(f"本地参考素材导入数量不一致：请求 {len(paths)}，返回 {len(imported)}")
    return {
        os.path.normcase(os.path.normpath(path)): deepcopy(dict(image))
        for path, image in zip(paths, imported)
    }


def build_stage_commands(
    canvas: Mapping[str, Any],
    items: Sequence[Mapping[str, Any]],
    imported_by_path: Mapping[str, Mapping[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    positions = positioned_group(canvas, items)
    nodes: List[Dict[str, Any]] = []
    commands: List[Dict[str, Any]] = []
    for item, (x, y) in zip(items, positions):
        images: List[Dict[str, Any]] = []
        for index, reference in enumerate(item.get("references") or []):
            if reference.get("kind") == "local":
                key = os.path.normcase(os.path.normpath(str(reference.get("value") or "")))
                imported = imported_by_path.get(key)
                if not imported:
                    raise SmartCanvasImageStageError(f"本地参考素材未成功导入：{reference.get('value')}")
                images.append(deepcopy(dict(imported)))
            else:
                images.append(direct_image(reference, index))
        node = build_node(item, images, x, y)
        nodes.append(node)
        commands.append({"type": "add_node", "payload": {"node": node}})
    return commands, nodes
