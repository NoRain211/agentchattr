import tempfile
import unittest
from pathlib import Path

import app as app_module
from fastapi.testclient import TestClient

from store import MessageStore
from thread_store import ThreadStore, build_inbox_view, build_thread_index, rebuild_thread_state


class Phase1ThreadBackendTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.message_store = MessageStore(str(root / "messages.jsonl"))
        self.thread_store = ThreadStore(str(root / "thread_state.json"))
        app_module.store = self.message_store
        app_module.thread_state = self.thread_store
        app_module.room_settings = {"username": "user"}
        self.client = TestClient(app_module.app)

    def test_build_thread_index_groups_reply_chain_under_root(self):
        root = self.message_store.add("user", "Root message", channel="general")
        reply_a = self.message_store.add("claude", "Reply A", reply_to=root["id"], channel="general")
        reply_b = self.message_store.add("kimi", "Reply B", reply_to=reply_a["id"], channel="general")
        other = self.message_store.add("codex", "Separate root", channel="general")

        rebuild_thread_state(self.message_store.get_all(), self.thread_store)
        threads = build_thread_index(self.message_store.get_all(), self.thread_store, channel="general")

        self.assertEqual([t["root_id"] for t in threads], [other["id"], root["id"]])

        grouped = threads[1]
        self.assertEqual(grouped["message_count"], 3)
        self.assertEqual(grouped["reply_count"], 2)
        self.assertEqual(grouped["last_message_id"], reply_b["id"])
        self.assertEqual(grouped["participants"], ["claude", "kimi", "user"])

    def test_build_inbox_view_includes_mentions_and_owned_threads(self):
        mention_root = self.message_store.add("user", "@codex please review this", channel="general")
        owned_root = self.message_store.add("user", "Owned thread root", channel="general")
        self.message_store.add("claude", "Reply in owned thread", reply_to=owned_root["id"], channel="general")

        rebuild_thread_state(self.message_store.get_all(), self.thread_store)
        self.thread_store.update_thread(owned_root["id"], owner="codex", status="open")

        inbox = build_inbox_view(self.message_store.get_all(), self.thread_store, actor="codex", channel="general")

        self.assertEqual(inbox["actor"], "codex")
        self.assertEqual([m["message_id"] for m in inbox["mentions"]], [mention_root["id"]])
        self.assertEqual([t["root_id"] for t in inbox["owned_threads"]], [owned_root["id"]])

    def test_build_inbox_view_returns_per_actor_attention_events(self):
        mention = self.message_store.add("user", "@codex please review this", channel="general")
        owned_root = self.message_store.add("user", "Owned thread root", channel="general")
        reply = self.message_store.add("claude", "Reply in owned thread", reply_to=owned_root["id"], channel="general")
        broadcast = self.message_store.add("kimi", "@all status update", channel="general")

        rebuild_thread_state(self.message_store.get_all(), self.thread_store)
        self.thread_store.update_thread(owned_root["id"], owner="codex", status="open")

        inbox = build_inbox_view(self.message_store.get_all(), self.thread_store, actor="codex", channel="general")

        self.assertEqual(inbox["actor"], "codex")
        self.assertEqual(
            [item["kind"] for item in inbox["items"]],
            ["broadcast", "thread_reply", "direct_mention"],
        )
        self.assertEqual(
            [item["message_id"] for item in inbox["items"]],
            [broadcast["id"], reply["id"], mention["id"]],
        )
        self.assertEqual(inbox["counts"]["all"], 3)
        self.assertEqual(inbox["counts"]["broadcast"], 1)
        self.assertEqual(inbox["counts"]["thread_reply"], 1)
        self.assertEqual(inbox["counts"]["direct_mention"], 1)

    def test_thread_store_persists_owner_and_status(self):
        root = self.message_store.add("user", "Root", channel="general")

        rebuild_thread_state(self.message_store.get_all(), self.thread_store)
        self.thread_store.update_thread(root["id"], owner="codex", status="resolved")

        reloaded = ThreadStore(self.thread_store.path)
        thread = reloaded.get(root["id"])

        self.assertIsNotNone(thread)
        self.assertEqual(thread["owner"], "codex")
        self.assertEqual(thread["status"], "resolved")

    def test_inbox_api_marks_items_read_and_done_per_actor(self):
        self.message_store.add("user", "@codex please review this", channel="general")
        rebuild_thread_state(self.message_store.get_all(), self.thread_store)

        inbox = self.client.get("/api/inbox", params={"actor": "codex"})
        self.assertEqual(inbox.status_code, 200)
        first_item = inbox.json()["items"][0]

        read_resp = self.client.post(f"/api/inbox/{first_item['item_id']}/read", params={"actor": "codex"})
        self.assertEqual(read_resp.status_code, 200)
        self.assertFalse(read_resp.json()["unread"])
        self.assertFalse(read_resp.json()["done"])

        done_resp = self.client.post(f"/api/inbox/{first_item['item_id']}/done", params={"actor": "codex"})
        self.assertEqual(done_resp.status_code, 200)
        self.assertFalse(done_resp.json()["unread"])
        self.assertTrue(done_resp.json()["done"])

        hidden = self.client.get("/api/inbox", params={"actor": "codex"})
        self.assertEqual(hidden.status_code, 200)
        self.assertEqual(hidden.json()["items"], [])

        visible = self.client.get(
            "/api/inbox",
            params={"actor": "codex", "filter": "direct_mention", "include_done": "true"},
        )
        self.assertEqual(visible.status_code, 200)
        visible_items = visible.json()["items"]
        self.assertEqual(len(visible_items), 1)
        self.assertFalse(visible_items[0]["unread"])
        self.assertTrue(visible_items[0]["done"])

    def test_create_thread_api_creates_thread_record_from_explicit_root(self):
        root = self.message_store.add("user", "Anchor this into a side thread", channel="general")
        rebuild_thread_state(self.message_store.get_all(), self.thread_store)

        response = self.client.post(
            "/api/threads",
            json={
                "root_id": root["id"],
                "title": "rabbit hole",
                "created_by": "user",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["root_id"], root["id"])
        self.assertEqual(payload["title"], "rabbit hole")
        self.assertEqual(payload["channel"], "general")

        thread = self.thread_store.get(root["id"])
        self.assertIsNotNone(thread)
        self.assertEqual(thread["owner"], "user")
        self.assertEqual(thread["status"], "open")


if __name__ == "__main__":
    unittest.main()
