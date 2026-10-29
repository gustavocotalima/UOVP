import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

spec = importlib.util.spec_from_file_location("ci_deploy", Path(__file__).resolve().parents[2] / "scripts/ci/deploy-dev.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DevDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        self.dev = self.sha
        self.main = "b" * 40
        self.equal_trees = False
        self.commands = []
        self.requests = []
        self.deployed = False
        self.active_deployment = False
        self.after_command = None
        self.application = {"uuid": deploy.DEV_APPLICATION, "git_branch": "dev", "fqdn": "http://uovp-dev.cotalima.com.br", "destination_id": 3, "destination": {"server": {"uuid": "devserver"}}, "status": "running:healthy"}
        self.cleanup_policy = {"delete_unused_volumes": False}
        self.databases = {uuid: {"uuid": uuid, "name": name, "database_type": kind, "destination_id": 3, "status": "running:healthy"} for uuid, name, kind in deploy.DEV_DATABASES}
        contexts = contextlib.ExitStack()
        self.addCleanup(contexts.close)
        contexts.enter_context(patch.dict(os.environ, {
            "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": deploy.REPOSITORY,
            "GITHUB_REF": "refs/heads/dev", "GITHUB_EVENT_NAME": "push", "GITHUB_SHA": self.sha,
            "COOLIFY_URL": "https://coolify.cotalima.com.br", "COOLIFY_APP_UUID": deploy.DEV_APPLICATION,
            "COOLIFY_TOKEN": "temporary-test-token", "GH_TOKEN": "temporary-github-token",
        }, clear=True))
        contexts.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.request = contexts.enter_context(patch.object(deploy, "request_json", side_effect=self.api))
        self.tool = contexts.enter_context(patch.object(deploy, "run_deploy_tool", side_effect=self.command))
        contexts.enter_context(patch.object(deploy.time, "sleep"))
        self.health = contexts.enter_context(patch.object(deploy.urllib.request, "urlopen", side_effect=self.health_response))

    def health_response(self, *args, **kwargs):
        result = io.BytesIO(b'{"status":"ok"}')
        result.status = 200
        return result

    def api(self, url, token, method="GET", data=None):
        path = urlparse(url).path
        self.requests.append((path, method, data))
        if path.endswith("/git/ref/heads/dev"):
            return {"object": {"sha": self.dev}}
        if path.endswith("/git/ref/heads/main"):
            return {"object": {"sha": self.main}}
        if "/git/commits/" in path:
            return {"tree": {"sha": "c" * 40 if self.equal_trees or path.endswith(self.dev) else "d" * 40}}
        if path == "/api/v1/applications/" + deploy.DEV_APPLICATION:
            if method == "PATCH":
                self.application.update(data)
                return {}
            return dict(self.application)
        if path == "/api/v1/servers/devserver/docker-cleanup":
            return dict(self.cleanup_policy)
        if "/databases/" in path:
            return dict(self.databases[path.rsplit("/", 1)[1]])
        if "/deployments/applications/" in path:
            return {"deployments": [{"deployment_uuid": "deployment1", "commit": self.sha, "status": "in_progress" if self.active_deployment else "finished"}] if self.deployed or self.active_deployment else []}
        if path.endswith("/deployments/deployment1"):
            return {"status": "finished", "commit": self.sha}
        raise AssertionError("Unexpected API request: " + path)

    def command(self, *args):
        self.commands.append(args)
        if args[0] == "stop":
            self.application["status"] = "exited"
        elif args[0] == "database":
            self.databases[args[2]]["status"] = "running:healthy" if args[1] == "start" else "exited"
        elif args[0] == "deploy":
            self.assertEqual(self.application.get("git_commit_sha"), self.sha)
            self.assertFalse(self.application["is_auto_deploy_enabled"])
            self.deployed = True
        else:
            raise AssertionError(args)
        if self.after_command:
            self.after_command(args)

    def test_main_branch_cannot_deploy(self):
        os.environ["GITHUB_REF"] = "refs/heads/main"
        with self.assertRaises(RuntimeError):
            deploy.main()
        self.request.assert_not_called()

    def test_pull_request_cannot_deploy(self):
        os.environ["GITHUB_EVENT_NAME"] = "pull_request"
        with self.assertRaises(RuntimeError):
            deploy.main()
        self.request.assert_not_called()

    def test_wrong_repository_cannot_deploy(self):
        os.environ["GITHUB_REPOSITORY"] = "other/project"
        with self.assertRaises(RuntimeError):
            deploy.main()
        self.request.assert_not_called()

    def test_superseded_commit_is_skipped(self):
        self.dev = "e" * 40
        deploy.main()
        self.tool.assert_not_called()
        self.assertEqual(len(self.requests), 1)

    def test_production_uuid_cannot_be_selected(self):
        os.environ["COOLIFY_APP_UUID"] = "production"
        with self.assertRaises(RuntimeError):
            deploy.main()
        self.request.assert_not_called()

    def test_production_target_cannot_be_changed(self):
        self.application["git_branch"] = "main"
        with self.assertRaises(RuntimeError):
            deploy.main()
        self.tool.assert_not_called()

    def test_all_databases_are_validated_before_any_mutation(self):
        self.main = self.sha
        self.databases[deploy.DEV_DATABASES[1][0]]["name"] = "production-redis"
        with self.assertRaises(RuntimeError):
            deploy.main()
        self.tool.assert_not_called()
        self.assertTrue(all(method == "GET" for _, method, _ in self.requests))

    def test_databases_must_share_the_application_destination(self):
        self.databases[deploy.DEV_DATABASES[0][0]]["destination_id"] = 999
        with self.assertRaises(RuntimeError):
            deploy.main()
        self.tool.assert_not_called()

    def test_equal_branches_stop_app_redis_then_postgres_without_deploying(self):
        self.main = self.sha
        deploy.main()
        self.assertEqual(self.commands, [("stop", deploy.DEV_APPLICATION), ("database", "stop", deploy.DEV_DATABASES[1][0]), ("database", "stop", deploy.DEV_DATABASES[0][0])])
        self.assertFalse(self.deployed)
        self.health.assert_not_called()
        self.assertTrue(all(method == "GET" for _, method, _ in self.requests))

    def test_identical_trees_with_different_commits_also_sleep(self):
        self.equal_trees = True
        deploy.main()
        self.assertEqual(len(self.commands), 3)
        self.assertFalse(self.deployed)

    def test_volume_deletion_or_unknown_policy_prevents_any_stop(self):
        self.main = self.sha
        for policy in [{"delete_unused_volumes": True}, {}]:
            with self.subTest(policy=policy):
                self.cleanup_policy = policy
                with self.assertRaisesRegex(RuntimeError, "unused-volume deletion"):
                    deploy.main()
                self.tool.assert_not_called()

    def test_missing_server_identity_prevents_any_stop(self):
        self.main = self.sha
        self.application.pop("destination")
        with self.assertRaisesRegex(RuntimeError, "volume retention"):
            deploy.main()
        self.tool.assert_not_called()

    def test_reenabling_volume_deletion_mid_sleep_keeps_databases_running(self):
        self.main = self.sha
        self.after_command = lambda _: self.cleanup_policy.update(delete_unused_volumes=True)
        with self.assertRaisesRegex(RuntimeError, "unused-volume deletion"):
            deploy.main()
        self.assertEqual(self.commands, [("stop", deploy.DEV_APPLICATION)])
        self.assertTrue(all(database["status"] == "running:healthy" for database in self.databases.values()))

    def test_already_sleeping_dev_is_idempotent(self):
        self.main = self.sha
        self.application["status"] = "exited"
        for database in self.databases.values():
            database["status"] = "exited"
        deploy.main()
        self.tool.assert_not_called()

    def test_active_deployment_prevents_sleep(self):
        self.main = self.sha
        self.active_deployment = True
        deploy.main()
        self.tool.assert_not_called()

    def test_new_dev_commit_during_sleep_preserves_remaining_resources(self):
        self.main = self.sha
        self.after_command = lambda _: setattr(self, "dev", "e" * 40)
        deploy.main()
        self.assertEqual(self.commands, [("stop", deploy.DEV_APPLICATION)])

    def test_new_main_commit_during_sleep_preserves_remaining_resources(self):
        self.main = self.sha
        self.after_command = lambda _: setattr(self, "main", "e" * 40)
        deploy.main()
        self.assertEqual(self.commands, [("stop", deploy.DEV_APPLICATION)])

    def test_different_code_wakes_dependencies_before_deploying_exact_sha(self):
        for database in self.databases.values():
            database["status"] = "exited"
        deploy.main()
        self.assertEqual(self.commands, [("database", "start", deploy.DEV_DATABASES[0][0]), ("database", "start", deploy.DEV_DATABASES[1][0]), ("deploy", deploy.DEV_APPLICATION)])
        self.assertTrue(self.deployed)
        self.health.assert_called_once()

    def test_healthy_dependencies_are_not_restarted(self):
        deploy.main()
        self.assertEqual(self.commands, [("deploy", deploy.DEV_APPLICATION)])

    def test_manual_dispatch_can_wake_equal_branches(self):
        self.main = self.sha
        os.environ.update(GITHUB_EVENT_NAME="workflow_dispatch", DEV_MODE="deploy")
        deploy.main()
        self.assertEqual(self.commands, [("deploy", deploy.DEV_APPLICATION)])

    def test_force_wake_requires_manual_dispatch(self):
        os.environ["DEV_MODE"] = "deploy"
        with self.assertRaises(RuntimeError):
            deploy.main()
        self.tool.assert_not_called()

    def test_new_commit_during_database_start_cannot_deploy_old_code(self):
        self.databases[deploy.DEV_DATABASES[0][0]]["status"] = "exited"
        self.after_command = lambda _: setattr(self, "dev", "e" * 40)
        deploy.main()
        self.assertEqual(self.commands, [("database", "start", deploy.DEV_DATABASES[0][0])])
        self.assertFalse(self.deployed)

    def test_unhealthy_database_blocks_app_deployment(self):
        self.databases[deploy.DEV_DATABASES[0][0]]["status"] = "running:unhealthy"
        with patch.object(deploy.time, "monotonic", side_effect=[0, 0, 301]):
            with self.assertRaises(RuntimeError):
                deploy.main()
        self.tool.assert_not_called()

    def test_cli_failure_prevents_stopping_the_databases(self):
        self.main = self.sha
        self.tool.side_effect = subprocess.CalledProcessError(1, "test-cli")
        with self.assertRaises(subprocess.CalledProcessError):
            deploy.main()
        self.tool.assert_called_once_with("stop", deploy.DEV_APPLICATION)


class DeployToolCredentialTests(unittest.TestCase):
    def test_private_credentials_are_removed_even_when_the_tool_fails(self):
        for fails in [False, True]:
            with self.subTest(fails=fails), tempfile.TemporaryDirectory() as folder:
                config = Path(folder) / ".config/coolify-deploy/config.json"
                def tool(arguments, check):
                    self.assertEqual(arguments, ["bash", "scripts/coolify-deploy", "deploy", deploy.DEV_APPLICATION])
                    self.assertTrue(check)
                    self.assertEqual(config.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(json.loads(config.read_text())["token"], "test-token")
                    if fails:
                        raise subprocess.CalledProcessError(1, arguments)
                with patch.dict(os.environ, {"COOLIFY_URL": "https://coolify.cotalima.com.br", "COOLIFY_TOKEN": "test-token"}), patch.object(deploy.Path, "home", return_value=Path(folder)), patch.object(deploy.subprocess, "run", side_effect=tool):
                    if fails:
                        with self.assertRaises(subprocess.CalledProcessError):
                            deploy.run_deploy_tool("deploy", deploy.DEV_APPLICATION)
                    else:
                        deploy.run_deploy_tool("deploy", deploy.DEV_APPLICATION)
                self.assertFalse(config.exists())

    def test_existing_configuration_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / ".config/coolify-deploy/config.json"
            config.parent.mkdir(parents=True)
            config.write_text("preserve-me")
            with patch.object(deploy.Path, "home", return_value=Path(folder)), patch.object(deploy.subprocess, "run") as tool:
                with self.assertRaises(RuntimeError):
                    deploy.run_deploy_tool("stop", deploy.DEV_APPLICATION)
                tool.assert_not_called()
            self.assertEqual(config.read_text(), "preserve-me")


class LifecycleCliTests(unittest.TestCase):
    def invoke(self, arguments, status="200"):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            config = home / ".config/coolify-deploy/config.json"
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({"url": "https://test.invalid", "token": "dummy-token"}))
            binary = home / "bin"
            binary.mkdir()
            fake = binary / "curl"
            fake.write_text("""#!/bin/sh
previous=''
for argument in "$@"; do
  if [ "$previous" = '-o' ]; then printf '{}' > "$argument"; fi
  case "$argument" in https://*) printf '%s' "$argument" > "$TEST_CURL_URL" ;; esac
  previous="$argument"
done
printf '%s' "$TEST_HTTP_CODE"
""")
            fake.chmod(0o700)
            url = home / "url"
            result = subprocess.run(["bash", str(Path(__file__).resolve().parents[2] / "scripts/coolify-deploy"), *arguments], env={"HOME": str(home), "PATH": str(binary) + os.pathsep + os.environ["PATH"], "TEST_CURL_URL": str(url), "TEST_HTTP_CODE": status}, capture_output=True, text=True)
            return result.returncode, url.read_text() if url.exists() else None

    def test_stop_commands_explicitly_disable_cleanup(self):
        cases = [(["stop", "devapp"], "/applications/devapp/stop?docker_cleanup=false"), (["database", "stop", "devdb"], "/databases/devdb/stop?docker_cleanup=false")]
        for arguments, path in cases:
            with self.subTest(arguments=arguments):
                code, url = self.invoke(arguments)
                self.assertEqual(code, 0)
                self.assertEqual(url, "https://test.invalid/api/v1" + path)

    def test_database_start_uses_start_endpoint(self):
        code, url = self.invoke(["database", "start", "devdb"])
        self.assertEqual(code, 0)
        self.assertEqual(url, "https://test.invalid/api/v1/databases/devdb/start")

    def test_invalid_targets_and_actions_never_reach_the_api(self):
        for arguments in [["stop", "../production"], ["database", "delete", "devdb"], ["database", "stop", "devdb?delete_volumes=true"]]:
            with self.subTest(arguments=arguments):
                code, url = self.invoke(arguments)
                self.assertNotEqual(code, 0)
                self.assertIsNone(url)

    def test_http_and_transport_errors_do_not_report_a_successful_stop(self):
        for status in ["000", "302", "403", "500"]:
            with self.subTest(status=status):
                code, _ = self.invoke(["stop", "devapp"], status)
                self.assertNotEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
