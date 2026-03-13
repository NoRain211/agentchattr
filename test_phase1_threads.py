import tempfile
import unittest
from pathlib import Path

from store import MessageStore
from thread_store import ThreadStore, build_inbox_view, build_thread_index, rebuild_thread_state


class Phase1ThreadBackendTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.message_store = MessageStore(str(root / "messages.jsonl"))
        self.thread_store = ThreadStore(str(root / "thread_state.json"))

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

    def test_thread_store_persists_owner_and_status(self):
        root = self.message_store.add("user", "Root", channel="general")

        rebuild_thread_state(self.message_store.get_all(), self.thread_store)
        self.thread_store.update_thread(root["id"], owner="codex", status="resolved")

        reloaded = ThreadStore(self.thread_store.path)
        thread = reloaded.get(root["id"])

        self.assertIsNotNone(thread)
        self.assertEqual(thread["owner"], "codex")
        self.assertEqual(thread["status"], "resolved")


if __name__ == "__main__":
    unittest.main()
