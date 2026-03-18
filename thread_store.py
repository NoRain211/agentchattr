"""Persistent thread workflow state plus read models for Phase 1 threads."""

import json
import re
import threading
import time
from pathlib import Path

MENTION_RE = re.compile(r"(?<!\w)@([a-zA-Z0-9][\w-]*)")


class ThreadStore:
    def __init__(self, path: str):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._threads: dict[str, dict] = {}
        self._load()

    @property
    def path(self) -> str:
        return str(self._path)

    def _load(self):
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text("utf-8"))
        except Exception:
            raw = {}
        if "threads" in raw:
            threads_raw = raw.get("threads", {})
        else:
            threads_raw = raw
        self._threads = {
            str(int(root_id)): _normalize_thread_record(record)
            for root_id, record in threads_raw.items()
        }

    def _save(self):
        payload = {
            "threads": self._threads,
        }
        self._path.write_text(json.dumps(payload, indent=2), "utf-8")

    def get(self, root_id: int) -> dict | None:
        with self._lock:
            record = self._threads.get(str(int(root_id)))
            return dict(record) if record else None

    def update_thread(
        self,
        root_id: int,
        *,
        title: str | None = None,
        owner: str | None = None,
        status: str | None = None,
        channel: str | None = None,
        last_message_id: int | None = None,
        updated_at: float | None = None,
    ) -> dict:
        key = str(int(root_id))
        now = updated_at if updated_at is not None else time.time()
        with self._lock:
            record = dict(self._threads.get(key) or _default_thread_record(root_id))
            if title is not None:
                record["title"] = title
            if owner is not None:
                record["owner"] = owner
            if status is not None:
                record["status"] = status
            if channel:
                record["channel"] = channel
            if last_message_id is not None:
                record["last_message_id"] = int(last_message_id)
            record["updated_at"] = now
            self._threads[key] = _normalize_thread_record(record)
            self._save()
            return dict(self._threads[key])

    def replace_all(self, records: list[dict]):
        with self._lock:
            self._threads = {
                str(int(record["root_id"])): _normalize_thread_record(record)
                for record in records
            }
            self._save()

    def list_all(
        self,
        *,
        channel: str | None = None,
        owner: str | None = None,
        status: str | None = None,
    ) -> list[dict]:
        with self._lock:
            records = [dict(record) for record in self._threads.values()]
        if channel:
            records = [record for record in records if record.get("channel") == channel]
        if owner:
            records = [record for record in records if record.get("owner") == owner]
        if status:
            records = [record for record in records if record.get("status") == status]
        records.sort(
            key=lambda record: (record.get("updated_at", 0), record.get("root_id", 0)),
            reverse=True,
        )
        return records


def extract_mentions(text: str) -> list[str]:
    return sorted({match.group(1).lower() for match in MENTION_RE.finditer(text or "")})


def rebuild_thread_state(messages: list[dict], thread_store: ThreadStore):
    """Refresh metadata for explicitly created threads only.

    Does NOT auto-create threads for every message — only updates threads
    that already exist in the store (created via POST /api/threads).
    """
    existing = {record["root_id"]: record for record in thread_store.list_all()}
    if not existing:
        return
    message_index = _message_index(messages)
    grouped: dict[int, list[dict]] = {}
    for message in messages:
        root_id = resolve_thread_root_id(message, message_index)
        if root_id in existing:
            grouped.setdefault(root_id, []).append(message)

    records = []
    for root_id, prior in existing.items():
        group = grouped.get(root_id, [])
        group.sort(key=lambda message: message["id"])
        records.append(
            {
                "root_id": root_id,
                "owner": prior.get("owner", ""),
                "status": prior.get("status", "open"),
                "channel": prior.get("channel", ""),
                "last_message_id": group[-1]["id"]
                if group
                else prior.get("last_message_id", root_id),
                "updated_at": group[-1].get("timestamp", time.time())
                if group
                else prior.get("updated_at", time.time()),
            }
        )
    thread_store.replace_all(records)


def sync_thread_state_for_message(
    message_store, thread_store: ThreadStore, message: dict
):
    """Update thread metadata when a new message arrives.

    Only updates threads that already exist in the store — does NOT
    auto-create threads for every message.
    """
    messages = message_store.get_all()
    message_index = _message_index(messages)
    root_id = resolve_thread_root_id(message, message_index)
    existing = thread_store.get(root_id)
    if not existing:
        return  # Not part of an explicit thread — skip
    thread_store.update_thread(
        root_id,
        owner=existing.get("owner", ""),
        status=existing.get("status", "open"),
        channel=message.get("channel", "general"),
        last_message_id=message["id"],
        updated_at=message.get("timestamp"),
    )


def build_thread_index(
    messages: list[dict],
    thread_store: ThreadStore,
    *,
    channel: str | None = None,
    owner: str | None = None,
    status: str | None = None,
) -> list[dict]:
    """Build thread index for only explicitly created threads.

    Only returns threads that exist in the store — not every message chain.
    """
    explicit_threads = thread_store.list_all(
        channel=channel, owner=owner, status=status
    )
    if not explicit_threads:
        return []

    explicit_root_ids = {record["root_id"] for record in explicit_threads}
    scoped = [
        message
        for message in messages
        if not channel or message.get("channel", "general") == channel
    ]
    message_index = _message_index(scoped)

    grouped: dict[int, list[dict]] = {}
    for message in scoped:
        root_id = resolve_thread_root_id(message, message_index)
        if root_id in explicit_root_ids:
            grouped.setdefault(root_id, []).append(message)

    threads = []
    for state in explicit_threads:
        root_id = state["root_id"]
        group = grouped.get(root_id, [])
        group.sort(key=lambda message: message["id"])
        root_message = message_index.get(root_id)
        if not root_message:
            continue
        thread = {
            "root_id": root_id,
            "title": state.get("title", ""),
            "channel": root_message.get("channel", "general"),
            "owner": state.get("owner", ""),
            "status": state.get("status", "open"),
            "message_count": len(group),
            "reply_count": max(0, len(group) - 1),
            "last_message_id": group[-1]["id"]
            if group
            else state.get("last_message_id", root_id),
            "updated_at": group[-1].get("timestamp", 0)
            if group
            else state.get("updated_at", 0),
            "participants": sorted(
                {
                    message.get("sender", "")
                    for message in group
                    if message.get("sender")
                }
            ),
            "root_message": _compact_message(root_message),
        }
        threads.append(thread)

    threads.sort(
        key=lambda thread: (thread["last_message_id"], thread["root_id"]), reverse=True
    )
    return threads


def resolve_thread_root_id(message: dict, message_index: dict[int, dict]) -> int:
    current = message
    seen = {int(current["id"])}
    while current.get("reply_to") is not None:
        parent_id = int(current["reply_to"])
        if parent_id in seen:
            break
        parent = message_index.get(parent_id)
        if not parent:
            break
        seen.add(parent_id)
        current = parent
    return int(current["id"])


def _compact_message(message: dict) -> dict:
    return {
        "id": message["id"],
        "sender": message.get("sender", ""),
        "text": message.get("text", ""),
        "time": message.get("time", ""),
        "channel": message.get("channel", "general"),
        "reply_to": message.get("reply_to"),
    }


def _message_index(messages: list[dict]) -> dict[int, dict]:
    return {int(message["id"]): message for message in messages}


def _default_thread_record(root_id: int) -> dict:
    now = time.time()
    return {
        "root_id": int(root_id),
        "title": "",
        "owner": "",
        "status": "open",
        "channel": "",
        "last_message_id": int(root_id),
        "updated_at": now,
    }


def _normalize_thread_record(record: dict) -> dict:
    normalized = _default_thread_record(int(record["root_id"]))
    normalized.update(record)
    normalized["root_id"] = int(normalized["root_id"])
    normalized["title"] = str(normalized.get("title", ""))
    normalized["last_message_id"] = int(
        normalized.get("last_message_id", normalized["root_id"])
    )
    normalized["owner"] = str(normalized.get("owner", ""))
    normalized["status"] = str(normalized.get("status", "open"))
    normalized["channel"] = str(normalized.get("channel", ""))
    normalized["updated_at"] = float(normalized.get("updated_at", time.time()))
    return normalized
