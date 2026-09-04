"""Trusted built-in node contracts used by Smart Canvas Agent operations."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Mapping


TRUSTED_NODE_TYPES: Dict[str, Dict[str, Any]] = {
    "smart-image": {
        "title": "图片节点",
        "default_width": 440,
        "default_height": 440,
        "can_run": True,
        "accepts": ["smart-image"],
        "outputs": ["smart-image"],
    },
}


def node_type(node: Mapping[str, Any] | None) -> str:
    value = str((node or {}).get("type") or "smart-image").strip().lower()
    return value or "smart-image"


def definition_for(value: str | Mapping[str, Any] | None) -> Dict[str, Any]:
    key = node_type(value if isinstance(value, Mapping) else {"type": value})
    definition = TRUSTED_NODE_TYPES.get(key)
    if definition is None:
        raise ValueError(f"untrusted node type: {key}")
    return deepcopy(definition)


def normalize_agent_node(raw: Mapping[str, Any]) -> Dict[str, Any]:
    node = deepcopy(dict(raw))
    key = node_type(node)
    definition = definition_for(key)
    node["type"] = key
    node.setdefault("title", definition["title"])
    node.setdefault("images", [])
    node.setdefault("scale", 1)
    node.setdefault("w", definition["default_width"])
    node.setdefault("h", definition["default_height"])
    return node


def can_connect(source: Mapping[str, Any], target: Mapping[str, Any]) -> bool:
    source_type = node_type(source)
    target_type = node_type(target)
    source_definition = definition_for(source_type)
    target_definition = definition_for(target_type)
    return target_type in source_definition.get("outputs", []) and source_type in target_definition.get("accepts", [])
