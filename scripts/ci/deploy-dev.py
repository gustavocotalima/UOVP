"""Pin the successful dev commit, use coolify-deploy, and verify the rollout."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request


def request_json(url, token, method="GET", data=None):
    request = urllib.request.Request(
        url,
        data=None if data is None else json.dumps(data).encode(),
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "UOVP-CI",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Deployment API request failed: HTTP {error.code}") from None


def main():
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("GITHUB_REPOSITORY") != "gustavocotalima/UOVP"
            or os.environ.get("GITHUB_REF") != "refs/heads/dev"
            or os.environ.get("GITHUB_EVENT_NAME") not in {"push", "workflow_dispatch"}):
        raise RuntimeError("Deployment is restricted to CI on this repository's dev branch.")
    sha = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise RuntimeError("A full tested commit SHA is required.")
    base = os.environ["COOLIFY_URL"].rstrip("/")
    app_uuid = os.environ["COOLIFY_APP_UUID"]
    token = os.environ["COOLIFY_TOKEN"]
    if base != "https://coolify.cotalima.com.br" or not re.fullmatch(r"[a-z0-9]+", app_uuid) or not token:
        raise RuntimeError("Configure the development environment's Coolify variables and secret.")

    def api(path, method="GET", data=None):
        return request_json(base + "/api/v1" + path, token, method, data)

    head = request_json("https://api.github.com/repos/gustavocotalima/UOVP/git/ref/heads/dev", os.environ["GH_TOKEN"])
    if head["object"]["sha"] != sha:
        print("A newer dev commit exists; skipping this superseded deployment.")
        return
    application = api("/applications/" + app_uuid)
    if application["git_branch"] != "dev" or application["fqdn"] != "http://uovp-dev.cotalima.com.br":
        raise RuntimeError("The target is not the expected dev application.")
    # Coolify's restart API resolves HEAD unless the app is explicitly pinned.
    # Pin before queueing: later pushes cannot cause untested code to be deployed.
    api("/applications/" + app_uuid, "PATCH", {"git_commit_sha": sha, "is_auto_deploy_enabled": False})
    previous = api("/deployments/applications/" + app_uuid)["deployments"]
    previous_ids = {deployment["deployment_uuid"] for deployment in previous}
    config = Path.home() / ".config/coolify-deploy/config.json"
    if config.exists():
        raise RuntimeError("Refusing to overwrite an existing coolify-deploy configuration.")
    config.parent.mkdir(parents=True, exist_ok=True)
    try:
        with config.open("x", opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
            json.dump({"url": base, "token": token}, stream)
        subprocess.run(["bash", "scripts/coolify-deploy", "deploy", app_uuid], check=True)
    finally:
        config.unlink(missing_ok=True)

    deadline = time.monotonic() + 20 * 60
    deployment_uuid = None
    last_status = None
    while time.monotonic() < deadline:
        if deployment_uuid is None:
            deployments = api("/deployments/applications/" + app_uuid)["deployments"]
            new = [deployment for deployment in deployments if deployment["deployment_uuid"] not in previous_ids and deployment.get("commit") == sha]
            if new:
                deployment_uuid = new[0]["deployment_uuid"]
                print("Coolify deployment:", deployment_uuid, flush=True)
        if deployment_uuid:
            deployment = api("/deployments/" + deployment_uuid)
            status = deployment["status"]
            if status != last_status:
                print("Deployment status:", status, flush=True)
                last_status = status
            if status == "finished":
                if deployment.get("commit") != sha:
                    raise RuntimeError("Coolify deployed a different commit than CI tested.")
                break
            if status in {"failed", "cancelled", "canceled"}:
                raise RuntimeError("Coolify deployment did not succeed.")
        time.sleep(15)
    else:
        raise RuntimeError("Timed out waiting for Coolify deployment.")

    for attempt in range(12):
        try:
            health = urllib.request.Request("https://uovp-dev.cotalima.com.br/api/health", headers={"User-Agent": "UOVP-deployment-verification"})
            with urllib.request.urlopen(health, timeout=20) as response:
                if response.status == 200 and json.load(response).get("status") == "ok":
                    print("The tested commit is deployed and dev is healthy.")
                    return
        except (urllib.error.URLError, ValueError):
            pass
        time.sleep(5)
    raise RuntimeError("Dev health check failed after deployment.")


if __name__ == "__main__":
    main()
