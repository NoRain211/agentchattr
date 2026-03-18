import tempfile
import unittest
from pathlib import Path

import app as app_module
from fastapi.testclient import TestClient

from store import MessageStore
from thread_store import ThreadStore, build_thread_index, rebuild_thread_state


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

    def test_thread_store_persists_owner_and_status(self):
        root = self.message_store.add("user", "Root", channel="general")

        rebuild_thread_state(self.message_store.get_all(), self.thread_store)
        self.thread_store.update_thread(root["id"], owner="codex", status="resolved")

        reloaded = ThreadStore(self.thread_store.path)
        thread = reloaded.get(root["id"])

        self.assertIsNotNone(thread)
        self.assertEqual(thread["owner"], "codex")
        self.assertEqual(thread["status"], "resolved")

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
