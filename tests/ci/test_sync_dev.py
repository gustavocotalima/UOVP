import contextlib
import copy
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("ci_sync", Path(__file__).resolve().parents[2] / "scripts/ci/sync-dev.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

HEAD, MERGED, NEW = "a" * 40, "b" * 40, "c" * 40


def merged_pr():
    return {
        "merged": True, "merge_commit_sha": MERGED,
        "base": {"ref": "main", "repo": {"full_name": sync.REPOSITORY}},
        "head": {"ref": "dev", "sha": HEAD, "repo": {"full_name": sync.REPOSITORY}},
    }


class DevSynchronizationTests(unittest.TestCase):
    def setUp(self):
        environment = {
            "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": sync.REPOSITORY,
            "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "pull_request_target",
            "PR_NUMBER": "1", "GH_TOKEN": "temporary-test-token",
        }
        contexts = contextlib.ExitStack()
        self.addCleanup(contexts.close)
        contexts.enter_context(patch.dict(os.environ, environment, clear=True))
        contexts.enter_context(contextlib.redirect_stdout(io.StringIO()))

    def test_untrusted_contexts_cannot_read_or_write(self):
        for key, value in [
            ("GITHUB_ACTIONS", "false"), ("GITHUB_REPOSITORY", "other/repo"),
            ("GITHUB_REF", "refs/heads/dev"), ("GITHUB_EVENT_NAME", "pull_request"),
        ]:
            with self.subTest(key=key), patch.dict(os.environ, {key: value}), patch.object(sync, "api") as api:
                with self.assertRaises(RuntimeError):
                    sync.main()
                api.assert_not_called()

    def test_invalid_pr_number_is_rejected(self):
        for number in ["", "0", "-1", "1; echo unsafe"]:
            with self.subTest(number=number), patch.dict(os.environ, {"PR_NUMBER": number}), patch.object(sync, "api") as api:
                with self.assertRaises(RuntimeError):
                    sync.main()
                api.assert_not_called()

    def test_only_merged_same_repository_dev_to_main_pr_is_accepted(self):
        changes = [
            lambda pr: pr.update(merged=False),
            lambda pr: pr["base"].update(ref="other"),
            lambda pr: pr["head"].update(ref="feature"),
            lambda pr: pr["base"]["repo"].update(full_name="other/repo"),
            lambda pr: pr["head"]["repo"].update(full_name="fork/UOVP"),
            lambda pr: pr["head"].update(repo=None),
        ]
        for change in changes:
            pr = copy.deepcopy(merged_pr())
            change(pr)
            with self.subTest(pr=pr), patch.object(sync, "api", return_value=pr) as api, patch.object(sync, "push_dev") as push:
                sync.main()
                self.assertEqual(api.call_count, 1)
                push.assert_not_called()

    def test_invalid_commit_sha_cannot_be_used_as_git_argument(self):
        pr = merged_pr()
        pr["merge_commit_sha"] = "--upload-pack=unsafe"
        with patch.object(sync, "api", return_value=pr), patch.object(sync.subprocess, "run") as git:
            with self.assertRaises(RuntimeError):
                sync.main()
            git.assert_not_called()

    def test_new_dev_commits_are_preserved(self):
        with patch.object(sync, "api", return_value=merged_pr()) as api, \
                patch.object(sync, "branch_sha", side_effect=[MERGED, NEW]), \
                patch.object(sync, "push_dev") as push:
            sync.main()
            push.assert_not_called()
            self.assertEqual(api.call_count, 1)

    def test_new_main_commits_skip_old_merge(self):
        with patch.object(sync, "api", return_value=merged_pr()) as api, \
                patch.object(sync, "branch_sha", return_value=NEW), patch.object(sync, "push_dev") as push:
            sync.main()
            push.assert_not_called()
            self.assertEqual(api.call_count, 1)

    def test_main_advancing_during_fetch_is_preserved(self):
        with patch.object(sync, "api", return_value=merged_pr()) as api, \
                patch.object(sync, "branch_sha", side_effect=[MERGED, HEAD, NEW]), \
                patch.object(sync.subprocess, "run"), patch.object(sync, "push_dev") as push:
            sync.main()
            push.assert_not_called()
            self.assertEqual(api.call_count, 1)

    def test_success_uses_expected_head_and_dispatches_ci_after_push(self):
        events = []

        def api(path, data=None):
            events.append((path, data))
            return merged_pr() if data is None else None

        def push(expected, target):
            self.assertEqual((expected, target), (HEAD, MERGED))
            events.append(("push", None))
            return True

        with patch.object(sync, "api", side_effect=api), \
                patch.object(sync, "branch_sha", side_effect=[MERGED, HEAD, MERGED, MERGED, MERGED]), \
                patch.object(sync.subprocess, "run") as git, patch.object(sync, "push_dev", side_effect=push):
            sync.main()
            git.assert_called_once_with(["git", "fetch", "--no-tags", "origin", MERGED], check=True, timeout=90)
        self.assertEqual(events, [("/pulls/1", None), ("push", None), ("/actions/workflows/ci.yml/dispatches", {"ref": "dev"})])

    def test_concurrent_dev_push_is_preserved_without_dispatch(self):
        with patch.object(sync, "api", return_value=merged_pr()) as api, \
                patch.object(sync, "branch_sha", side_effect=[MERGED, HEAD, MERGED, NEW]), \
                patch.object(sync.subprocess, "run"), patch.object(sync, "push_dev", return_value=False):
            sync.main()
            self.assertEqual(api.call_count, 1)

    def test_push_failure_with_unchanged_head_is_an_error(self):
        with patch.object(sync, "api", return_value=merged_pr()), \
                patch.object(sync, "branch_sha", side_effect=[MERGED, HEAD, MERGED, HEAD]), \
                patch.object(sync.subprocess, "run"), patch.object(sync, "push_dev", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "Could not synchronize"):
                sync.main()

    def test_transport_failure_after_remote_update_still_dispatches_ci(self):
        with patch.object(sync, "api", return_value=merged_pr()) as api, \
                patch.object(sync, "branch_sha", side_effect=[MERGED, HEAD, MERGED, MERGED, MERGED, MERGED]), \
                patch.object(sync.subprocess, "run"), patch.object(sync, "push_dev", return_value=False):
            sync.main()
            api.assert_called_with("/actions/workflows/ci.yml/dispatches", {"ref": "dev"})

    def test_main_racing_with_push_is_reported_before_dispatch(self):
        with patch.object(sync, "api", return_value=merged_pr()) as api, \
                patch.object(sync, "branch_sha", side_effect=[MERGED, HEAD, MERGED, MERGED, NEW]), \
                patch.object(sync.subprocess, "run"), patch.object(sync, "push_dev", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "Main advanced during synchronization"):
                sync.main()
            self.assertEqual(api.call_count, 1)

    def test_dispatch_does_not_use_newer_unchecked_head(self):
        with patch.object(sync, "api", return_value=merged_pr()) as api, \
                patch.object(sync, "branch_sha", side_effect=[MERGED, HEAD, MERGED, NEW]), \
                patch.object(sync.subprocess, "run"), patch.object(sync, "push_dev", return_value=True):
            sync.main()
            self.assertEqual(api.call_count, 1)

    def test_already_synced_retry_dispatches_without_another_push(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch"}), \
                patch.object(sync, "api", return_value=merged_pr()) as api, \
                patch.object(sync, "branch_sha", return_value=MERGED), patch.object(sync, "push_dev") as push:
            sync.main()
            push.assert_not_called()
            api.assert_called_with("/actions/workflows/ci.yml/dispatches", {"ref": "dev"})

    def test_failed_dispatch_can_be_retried(self):
        with patch.object(sync, "api", side_effect=[merged_pr(), RuntimeError("Dispatch unavailable")]), \
                patch.object(sync, "branch_sha", return_value=MERGED), patch.object(sync, "push_dev") as push:
            with self.assertRaisesRegex(RuntimeError, "Dispatch unavailable"):
                sync.main()
            push.assert_not_called()


class GitLeaseTests(unittest.TestCase):
    def test_real_git_lease_rejects_racing_commit_and_accepts_matching_head(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*arguments, input=None):
                return subprocess.run(
                    ["git", *arguments], cwd=root, input=input, text=True,
                    capture_output=True, check=True,
                ).stdout.strip()

            git("init", "--bare", "remote.git")
            git("init", "checkout")
            root = root / "checkout"
            git("config", "user.name", "CI fixture")
            git("config", "user.email", "ci@example.test")
            git("remote", "add", "origin", str(root.parent / "remote.git"))
            tree = git("mktree", input="")
            old = git("commit-tree", tree, "-m", "old")
            merged = git("commit-tree", tree, "-m", "squash")
            newer = git("commit-tree", tree, "-p", old, "-m", "new work")
            git("push", "origin", f"{old}:refs/heads/dev")
            git("push", "origin", f"{newer}:refs/heads/dev")
            run = subprocess.run

            def in_checkout(*args, **kwargs):
                return run(*args, cwd=root, **kwargs)

            with patch.object(sync.subprocess, "run", side_effect=in_checkout):
                self.assertFalse(sync.push_dev(old, merged))
            self.assertEqual(git("ls-remote", "origin", "refs/heads/dev").split()[0], newer)
            with patch.object(sync.subprocess, "run", side_effect=in_checkout):
                self.assertTrue(sync.push_dev(newer, merged))
            self.assertEqual(git("ls-remote", "origin", "refs/heads/dev").split()[0], merged)


if __name__ == "__main__":
    unittest.main()
