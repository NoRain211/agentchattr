"""Persistent thread workflow state plus read models for Phase 1 inbox/threads."""

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
        self._inbox_state: dict[str, dict[str, dict]] = {}
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
        if "threads" in raw or "inbox_state" in raw:
            threads_raw = raw.get("threads", {})
            inbox_state_raw = raw.get("inbox_state", {})
        else:
            threads_raw = raw
            inbox_state_raw = {}
        self._threads = {
            str(int(root_id)): _normalize_thread_record(record)
            for root_id, record in threads_raw.items()
        }
        self._inbox_state = _normalize_inbox_state(inbox_state_raw)

    def _save(self):
        payload = {
            "threads": self._threads,
            "inbox_state": self._inbox_state,
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

    def list_all(self, *, channel: str | None = None, owner: str | None = None, status: str | None = None) -> list[dict]:
        with self._lock:
            records = [dict(record) for record in self._threads.values()]
        if channel:
            records = [record for record in records if record.get("channel") == channel]
        if owner:
            records = [record for record in records if record.get("owner") == owner]
        if status:
            records = [record for record in records if record.get("status") == status]
        records.sort(key=lambda record: (record.get("updated_at", 0), record.get("root_id", 0)), reverse=True)
        return records

    def get_inbox_item_state(self, actor_id: str, item_id: str) -> dict:
        actor_key = actor_id.strip().lower()
        with self._lock:
            state = ((self._inbox_state.get(actor_key) or {}).get(item_id))
            if not state:
                return {"unread": True, "done": False}
            return {
                "unread": bool(state.get("unread", True)),
                "done": bool(state.get("done", False)),
            }

    def update_inbox_item_state(
        self,
        actor_id: str,
        item_id: str,
        *,
        unread: bool | None = None,
        done: bool | None = None,
    ) -> dict:
        actor_key = actor_id.strip().lower()
        if not actor_key:
            raise ValueError("actor_id is required")
        if not item_id.strip():
            raise ValueError("item_id is required")
        with self._lock:
            actor_state = dict(self._inbox_state.get(actor_key) or {})
            current = dict(actor_state.get(item_id) or {"unread": True, "done": False})
            if unread is not None:
                current["unread"] = bool(unread)
            if done is not None:
                current["done"] = bool(done)
            actor_state[item_id] = current
            self._inbox_state[actor_key] = actor_state
            self._save()
            return {
                "actor_id": actor_key,
                "item_id": item_id,
                "unread": bool(current.get("unread", True)),
                "done": bool(current.get("done", False)),
            }


def extract_mentions(text: str) -> list[str]:
    return sorted({match.group(1).lower() for match in MENTION_RE.finditer(text or "")})


def rebuild_thread_state(messages: list[dict], thread_store: ThreadStore):
    message_index = _message_index(messages)
    grouped: dict[int, list[dict]] = {}
    for message in messages:
        root_id = resolve_thread_root_id(message, message_index)
        grouped.setdefault(root_id, []).append(message)

    prior = {record["root_id"]: record for record in thread_store.list_all()}
    records = []
    for root_id, group in grouped.items():
        group.sort(key=lambda message: message["id"])
        root_message = message_index[root_id]
        previous = prior.get(root_id, {})
        records.append({
            "root_id": root_id,
            "owner": previous.get("owner", ""),
            "status": previous.get("status", "open"),
            "channel": root_message.get("channel", "general"),
            "last_message_id": group[-1]["id"],
            "updated_at": group[-1].get("timestamp", time.time()),
        })
    thread_store.replace_all(records)


def sync_thread_state_for_message(message_store, thread_store: ThreadStore, message: dict):
    messages = message_store.get_all()
    message_index = _message_index(messages)
    root_id = resolve_thread_root_id(message, message_index)
    existing = thread_store.get(root_id) or {}
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
    scoped = [message for message in messages if not channel or message.get("channel", "general") == channel]
    message_index = _message_index(scoped)
    grouped: dict[int, list[dict]] = {}
    for message in scoped:
        root_id = resolve_thread_root_id(message, message_index)
        grouped.setdefault(root_id, []).append(message)

    threads = []
    for root_id, group in grouped.items():
        group.sort(key=lambda message: message["id"])
        root_message = message_index[root_id]
        state = thread_store.get(root_id) or _default_thread_record(root_id)
        thread = {
            "root_id": root_id,
            "channel": root_message.get("channel", "general"),
            "owner": state.get("owner", ""),
            "status": state.get("status", "open"),
            "message_count": len(group),
            "reply_count": max(0, len(group) - 1),
            "last_message_id": state.get("last_message_id", group[-1]["id"]),
            "updated_at": state.get("updated_at", group[-1].get("timestamp", 0)),
            "participants": sorted({message.get("sender", "") for message in group if message.get("sender")}),
            "root_message": _compact_message(root_message),
        }
        if owner and thread["owner"] != owner:
            continue
        if status and thread["status"] != status:
            continue
        threads.append(thread)

    threads.sort(key=lambda thread: (thread["last_message_id"], thread["root_id"]), reverse=True)
    return threads


def build_inbox_view(
    messages: list[dict],
    thread_store: ThreadStore,
    *,
    actor: str,
    channel: str | None = None,
    filter_kind: str | None = None,
    include_done: bool = False,
) -> dict:
    actor_name = actor.strip()
    actor_lower = actor_name.lower()
    scoped = [message for message in messages if not channel or message.get("channel", "general") == channel]
    message_index = _message_index(scoped)

    items = []
    mentions = []
    normalized_filter = (filter_kind or "").strip()
    if normalized_filter.lower() == "all":
        normalized_filter = ""
    for message in scoped:
        for event in _derive_attention_events_for_actor(message, message_index, thread_store, actor_lower):
            if normalized_filter and event["kind"] != normalized_filter:
                continue
            if not include_done and event["done"]:
                continue
            items.append(event)
            if event["kind"] in {"direct_mention", "broadcast"}:
                mentions.append({
                    "message_id": event["message_id"],
                    "thread_root_id": event["thread_id"],
                    "channel": event["channel"],
                    "sender": event["sender"],
                    "text": event["preview"],
                    "time": event.get("time", ""),
                    "is_broadcast": event["kind"] == "broadcast",
                })
    items.sort(key=lambda item: (item.get("ts", 0), item.get("message_id", 0)), reverse=True)
    mentions.sort(key=lambda entry: entry["message_id"], reverse=True)

    owned_threads = [
        thread for thread in build_thread_index(scoped, thread_store, channel=channel)
        if thread.get("owner", "").lower() == actor_lower and thread.get("status") != "resolved"
    ]

    counts = _empty_inbox_counts()
    for item in items:
        counts["all"] += 1
        counts[item["kind"]] += 1
        if item.get("unread"):
            counts["unread"] += 1
        if item.get("done"):
            counts["done"] += 1

    return {
        "actor": actor_name,
        "items": items,
        "counts": counts,
        "mentions": mentions,
        "owned_threads": owned_threads,
    }


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
    normalized["last_message_id"] = int(normalized.get("last_message_id", normalized["root_id"]))
    normalized["owner"] = str(normalized.get("owner", ""))
    normalized["status"] = str(normalized.get("status", "open"))
    normalized["channel"] = str(normalized.get("channel", ""))
    normalized["updated_at"] = float(normalized.get("updated_at", time.time()))
    return normalized


def _derive_attention_events_for_actor(
    message: dict,
    message_index: dict[int, dict],
    thread_store: ThreadStore,
    actor_id: str,
) -> list[dict]:
    if not actor_id:
        return []
    sender = str(message.get("sender", ""))
    sender_lower = sender.lower()
    if sender_lower == actor_id:
        return []

    tags = extract_mentions(message.get("text", ""))
    root_id = resolve_thread_root_id(message, message_index)
    base = {
        "actor_id": actor_id,
        "sender": sender,
        "preview": _preview_text(message.get("text", "")),
        "channel": message.get("channel", "general"),
        "thread_id": root_id,
        "message_id": int(message["id"]),
        "ts": float(message.get("timestamp", 0)),
        "time": message.get("time", ""),
    }
    events = []
    if actor_id in tags:
        events.append(_build_attention_event(thread_store, "direct_mention", base))
    if "all" in tags:
        events.append(_build_attention_event(thread_store, "broadcast", base))

    thread = thread_store.get(root_id) or _default_thread_record(root_id)
    if message.get("reply_to") is not None and thread.get("owner", "").lower() == actor_id:
        events.append(_build_attention_event(thread_store, "thread_reply", base))
    return events


def _build_attention_event(thread_store: ThreadStore, kind: str, base: dict) -> dict:
    item_id = _attention_item_id(kind, base["actor_id"], base["thread_id"], base["message_id"])
    state = thread_store.get_inbox_item_state(base["actor_id"], item_id)
    event = dict(base)
    event.update({
        "item_id": item_id,
        "kind": kind,
        "unread": state["unread"],
        "done": state["done"],
    })
    return event


def _attention_item_id(kind: str, actor_id: str, thread_id: int, message_id: int) -> str:
    if kind == "thread_reply":
        return f"{actor_id}:{kind}:{thread_id}:{message_id}"
    return f"{actor_id}:{kind}:{message_id}"


def _empty_inbox_counts() -> dict:
    return {
        "all": 0,
        "unread": 0,
        "done": 0,
        "direct_mention": 0,
        "thread_reply": 0,
        "broadcast": 0,
        "question": 0,
        "blocked": 0,
        "decision_required": 0,
    }


def _normalize_inbox_state(raw: dict) -> dict[str, dict[str, dict]]:
    normalized: dict[str, dict[str, dict]] = {}
    for actor_id, actor_state in (raw or {}).items():
        actor_key = str(actor_id).strip().lower()
        if not actor_key or not isinstance(actor_state, dict):
            continue
        normalized[actor_key] = {}
        for item_id, state in actor_state.items():
            normalized[actor_key][str(item_id)] = {
                "unread": bool((state or {}).get("unread", True)),
                "done": bool((state or {}).get("done", False)),
            }
    return normalized


def _preview_text(text: str) -> str:
    return (text or "").splitlines()[0].strip()
