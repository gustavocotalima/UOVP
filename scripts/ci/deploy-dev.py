"""Deploy tested dev changes, or sleep dev when its source matches main."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

REPOSITORY = "gustavocotalima/UOVP"
DEV_APPLICATION = "gtqgwkrh0k39w305zrkq4ff3"
DEV_DATABASES = (
    ("dt9ys3pgackztxfgfhfkhlfn", "uovp-dev-postgres", "standalone-postgresql"),
    ("efuywn9zjf5euk494d2ihjee", "uovp-dev-redis", "standalone-redis"),
)


def revision_state(tested_sha):
    def github(path):
        return request_json("https://api.github.com/repos/" + REPOSITORY + path, os.environ["GH_TOKEN"])

    dev = github("/git/ref/heads/dev")["object"]["sha"]
    if dev != tested_sha:
        return None
    main = github("/git/ref/heads/main")["object"]["sha"]
    if not all(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{40}", value) for value in (dev, main)):
        raise RuntimeError("GitHub did not return valid branch revisions.")
    equal = dev == main
    if not equal:
        trees = [github("/git/commits/" + value)["tree"]["sha"] for value in (dev, main)]
        if not all(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{40}", value) for value in trees):
            raise RuntimeError("GitHub did not return valid source trees.")
        equal = trees[0] == trees[1]
    return {"dev": dev, "main": main, "equal": equal}


def run_deploy_tool(*arguments):
    config = Path.home() / ".config/coolify-deploy/config.json"
    if config.exists():
        raise RuntimeError("Refusing to overwrite an existing coolify-deploy configuration.")
    config.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(config, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
            json.dump({"url": os.environ["COOLIFY_URL"].rstrip("/"), "token": os.environ["COOLIFY_TOKEN"]}, stream)
        subprocess.run(["bash", "scripts/coolify-deploy", *arguments], check=True)
    finally:
        config.unlink(missing_ok=True)


def stopped(resource):
    return resource.get("status", "").split(":")[0] in {"exited", "stopped"}


def wait_resource(api, path, *, asleep):
    deadline = time.monotonic() + 5 * 60
    while time.monotonic() < deadline:
        resource = api(path)
        ready = stopped(resource) if asleep else resource.get("status") == "running:healthy"
        if ready:
            return
        time.sleep(5)
    raise RuntimeError("Timed out waiting for dev resource " + path)


def validate_databases(api, application):
    resources = []
    for uuid, name, kind in DEV_DATABASES:
        resource = api("/databases/" + uuid)
        if (resource.get("uuid") != uuid or resource.get("name") != name
                or resource.get("database_type") != kind
                or str(resource.get("destination_id")) != str(application.get("destination_id"))
                or resource.get("destination_id") is None):
            raise RuntimeError("The target is not the expected dev database: " + name)
        resources.append(resource)
    return resources


def sleep_dev(api, sha, resources):
    deployments = api("/deployments/applications/" + DEV_APPLICATION)["deployments"]
    if any(item.get("status") in {"queued", "pending", "in_progress"} for item in deployments):
        print("Skipped sleep: a dev deployment is still active.")
        return
    targets = [("/applications/" + DEV_APPLICATION, ("stop", DEV_APPLICATION))]
    targets.extend(("/databases/" + resource["uuid"], ("database", "stop", resource["uuid"])) for resource in reversed(resources))
    for path, command in targets:
        # Recheck both branches before each stop. The CI deployment concurrency
        # group also serializes wake and sleep operations.
        state = revision_state(sha)
        if not state or not state["equal"]:
            print("Skipped remaining stops: the branch state changed.")
            return
        if not stopped(api(path)):
            run_deploy_tool(*command)
            wait_resource(api, path, asleep=True)
    print("Dev matches main. App, Redis and PostgreSQL are stopped; persistent volumes are retained.")


def wake_databases(api, sha, resources):
    for resource in resources:
        if revision_state(sha) is None:
            print("Skipped wake: a newer dev commit exists.")
            return False
        path = "/databases/" + resource["uuid"]
        if stopped(api(path)):
            run_deploy_tool("database", "start", resource["uuid"])
        wait_resource(api, path, asleep=False)
    return True


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
    if base != "https://coolify.cotalima.com.br" or app_uuid != DEV_APPLICATION or not token:
        raise RuntimeError("Configure the development environment's Coolify variables and secret.")
    mode = os.environ.get("DEV_MODE", "auto")
    if mode not in {"auto", "deploy"} or (mode == "deploy" and os.environ["GITHUB_EVENT_NAME"] != "workflow_dispatch"):
        raise RuntimeError("Explicit dev activation is restricted to manual CI dispatch.")

    def api(path, method="GET", data=None):
        return request_json(base + "/api/v1" + path, token, method, data)

    state = revision_state(sha)
    if not state:
        print("A newer dev commit exists; skipping this superseded deployment.")
        return
    application = api("/applications/" + app_uuid)
    if application["git_branch"] != "dev" or application["fqdn"] != "http://uovp-dev.cotalima.com.br":
        raise RuntimeError("The target is not the expected dev application.")
    resources = validate_databases(api, application)
    if state["equal"] and mode == "auto":
        sleep_dev(api, sha, resources)
        return
    if not wake_databases(api, sha, resources):
        return
    latest = revision_state(sha)
    if not latest:
        print("Skipped deployment: a newer dev commit exists.")
        return
    if latest["equal"] and mode == "auto":
        sleep_dev(api, sha, resources)
        return
    # Coolify's restart API resolves HEAD unless the app is explicitly pinned.
    # Pin before queueing: later pushes cannot cause untested code to be deployed.
    api("/applications/" + app_uuid, "PATCH", {"git_commit_sha": sha, "is_auto_deploy_enabled": False})
    previous = api("/deployments/applications/" + app_uuid)["deployments"]
    previous_ids = {deployment["deployment_uuid"] for deployment in previous}
    run_deploy_tool("deploy", app_uuid)

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
