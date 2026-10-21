import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ci_deploy", Path(__file__).resolve().parents[2] / "scripts/ci/deploy-dev.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DevDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        environment = {
            "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "gustavocotalima/UOVP",
            "GITHUB_REF": "refs/heads/dev", "GITHUB_EVENT_NAME": "push", "GITHUB_SHA": self.sha,
            "COOLIFY_URL": "https://coolify.cotalima.com.br", "COOLIFY_APP_UUID": "testdev",
            "COOLIFY_TOKEN": "temporary-test-token", "GH_TOKEN": "temporary-github-token",
        }
        contexts = contextlib.ExitStack()
        self.addCleanup(contexts.close)
        contexts.enter_context(patch.dict(os.environ, environment, clear=True))
        contexts.enter_context(contextlib.redirect_stdout(io.StringIO()))

    def test_main_branch_cannot_deploy(self):
        os.environ["GITHUB_REF"] = "refs/heads/main"
        with patch.object(deploy, "request_json") as request:
            with self.assertRaises(RuntimeError):
                deploy.main()
            request.assert_not_called()

    def test_pull_request_cannot_deploy(self):
        os.environ["GITHUB_EVENT_NAME"] = "pull_request"
        with patch.object(deploy, "request_json") as request:
            with self.assertRaises(RuntimeError):
                deploy.main()
            request.assert_not_called()

    def test_superseded_commit_is_skipped(self):
        with patch.object(deploy, "request_json", return_value={"object": {"sha": "b" * 40}}) as request:
            deploy.main()
            self.assertEqual(request.call_count, 1)

    def test_production_target_cannot_be_changed(self):
        responses = [{"object": {"sha": self.sha}}, {"git_branch": "main", "fqdn": "https://uovp.cotalima.com.br"}]
        with patch.object(deploy, "request_json", side_effect=responses) as request:
            with self.assertRaises(RuntimeError):
                deploy.main()
            self.assertEqual(request.call_count, 2)

    def test_exact_commit_is_pinned_before_cli_and_credentials_are_removed(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            config = home / ".config/coolify-deploy/config.json"
            health = io.BytesIO(b'{"status":"ok"}')
            health.status = 200
            responses = [
                {"object": {"sha": self.sha}},
                {"git_branch": "dev", "fqdn": "http://uovp-dev.cotalima.com.br"},
                {}, {"deployments": []},
                {"deployments": [{"deployment_uuid": "deployment1", "commit": self.sha}]},
                {"status": "finished", "commit": self.sha},
            ]

            def cli(arguments, check):
                self.assertEqual(arguments, ["bash", "scripts/coolify-deploy", "deploy", "testdev"])
                self.assertTrue(check)
                self.assertEqual(config.stat().st_mode & 0o777, 0o600)
                self.assertEqual(json.loads(config.read_text())["token"], os.environ["COOLIFY_TOKEN"])
                self.assertEqual(request.call_args_list[2].args[3], {"git_commit_sha": self.sha, "is_auto_deploy_enabled": False})

            with patch.object(deploy, "request_json", side_effect=responses) as request, \
                    patch.object(deploy.Path, "home", return_value=home), \
                    patch.object(deploy.subprocess, "run", side_effect=cli), \
                    patch.object(deploy.urllib.request, "urlopen", return_value=health):
                deploy.main()
            self.assertFalse(config.exists())


if __name__ == "__main__":
    unittest.main()
