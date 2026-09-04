"""Persistent task records for asynchronous smart-canvas generation.

Task execution remains in the FastAPI layer.  This module only owns durable,
atomic task records so task polling survives a server restart without replaying
an upstream request.
"""
import json
import os
import re
import tempfile
import time
from typing import Any, Dict, Iterable, Optional


_TERMINAL_STATUSES = {"succeeded", "failed", "cancelled", "stale", "interrupted"}


def task_path(task_dir: str, task_id: str) -> str:
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(task_id or ""))
    if not safe_id:
        raise ValueError("invalid canvas task id")
    return os.path.join(task_dir, f"{safe_id}.json")


def persist_task(task_dir: str, task: Dict[str, Any]) -> Dict[str, Any]:
    """Atomically persist a JSON-safe task and return its detached snapshot."""
    task_id = str(task.get("id") or "")
    target = task_path(task_dir, task_id)
    os.makedirs(task_dir, exist_ok=True)
    snapshot = json.loads(json.dumps(task, ensure_ascii=False, default=str))
    fd, temporary = tempfile.mkstemp(prefix=f".{task_id}.", suffix=".tmp", dir=task_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(snapshot, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            try:
                os.remove(temporary)
            except OSError:
                pass
    return snapshot


def load_task(task_dir: str, task_id: str) -> Optional[Dict[str, Any]]:
    try:
        with open(task_path(task_dir, task_id), "r", encoding="utf-8") as handle:
            task = json.load(handle)
        return task if isinstance(task, dict) and task.get("id") else None
    except (OSError, ValueError, json.JSONDecodeError):
        return None


def recover_tasks(task_dir: str, now: Optional[float] = None) -> Iterable[Dict[str, Any]]:
    """Mark local in-flight records interrupted after a process restart.

    We intentionally never resume or re-submit an upstream request here.
    Providers may already have accepted it, so automatic replay could charge
    twice.
    """
    timestamp = float(now if now is not None else time.time())
    if not os.path.isdir(task_dir):
        return []
    recovered = []
    for name in os.listdir(task_dir):
        if not name.endswith(".json"):
            continue
        task = load_task(task_dir, name[:-5])
        if not task or task.get("status") in _TERMINAL_STATUSES:
            continue
        task.update({
            "status": "interrupted",
            "error": "服务重启，任务状态无法安全恢复；请确认上游结果后手动重试。",
            "updated_at": timestamp,
            "interrupted_at": timestamp,
        })
        recovered.append(persist_task(task_dir, task))
    return recovered


def task_event(task: Dict[str, Any]) -> Dict[str, Any]:
    """Return the compact event payload safe for WebSocket fan-out."""
    return {
        "id": str(task.get("id") or ""),
        "type": str(task.get("type") or ""),
        "status": str(task.get("status") or ""),
        "updated_at": task.get("updated_at") or 0,
        "error": str(task.get("error") or ""),
        "message": str(task.get("message") or ""),
        "submit_id": str(task.get("submit_id") or ""),
    }

