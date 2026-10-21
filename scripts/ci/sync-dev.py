"""Align dev after its PR merges, without discarding newer work or bypassing CI."""
import json
import os
import re
import subprocess
import urllib.error
import urllib.request


REPOSITORY = "gustavocotalima/UOVP"


def api(path, data=None):
    request = urllib.request.Request(
        "https://api.github.com/repos/" + REPOSITORY + path,
        data=None if data is None else json.dumps(data).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "UOVP-branch-sync",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return None if response.status == 204 else json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"GitHub synchronization request failed: HTTP {error.code}") from None


def branch_sha(branch):
    return api("/git/ref/heads/" + branch)["object"]["sha"]


def push_dev(expected, target):
    # An explicit lease is checked atomically by GitHub, even if dev advances
    # after our API checks. Never replace it with an unconditional force push.
    return subprocess.run(
        ["git", "push", f"--force-with-lease=refs/heads/dev:{expected}",
         "origin", f"{target}:refs/heads/dev"],
        capture_output=True, text=True, timeout=90, check=False,
    ).returncode == 0


def sync(pr_number):
    pr = api("/pulls/" + str(pr_number))
    if (not pr.get("merged") or pr["base"]["ref"] != "main"
            or pr["head"]["ref"] != "dev"
            or pr["base"]["repo"]["full_name"] != REPOSITORY
            or (pr["head"].get("repo") or {}).get("full_name") != REPOSITORY):
        print("Skipped: only a merged dev-to-main PR in this repository can synchronize dev.")
        return
    expected, target = pr["head"]["sha"], pr["merge_commit_sha"]
    if not all(isinstance(sha, str) and re.fullmatch(r"[a-f0-9]{40}", sha) for sha in (expected, target)):
        raise RuntimeError("The merged PR must supply full commit SHAs.")
    if branch_sha("main") != target:
        print("Skipped: main has advanced since this PR merged.")
        return
    current = branch_sha("dev")
    if current not in {expected, target}:
        print("Skipped: dev has new commits; no branch was changed.")
        return
    if current != target:
        # Fetch only the validated main commit, never execute dev's code.
        subprocess.run(["git", "fetch", "--no-tags", "origin", target], check=True, timeout=90)
        if branch_sha("main") != target:
            print("Skipped: main changed while preparing synchronization.")
            return
        if not push_dev(expected, target):
            if branch_sha("dev") != expected:
                print("Skipped: dev changed during the push; the lease preserved its commits.")
                return
            raise RuntimeError("Could not synchronize dev; its expected head is unchanged. Retry after fixing the push failure.")
        print("Synchronized dev to main:", target)
    else:
        print("Dev is already synchronized; retrying its CI dispatch.")
    if branch_sha("dev") != target:
        print("Skipped CI dispatch: dev advanced after synchronization; its own push runs CI.")
        return
    # GITHUB_TOKEN pushes do not trigger push workflows. This explicit dispatch
    # runs all validations on dev before the existing gated deployment job.
    api("/actions/workflows/ci.yml/dispatches", {"ref": "dev"})
    print("Started CI on dev. Coolify deployment still requires every validation job to pass.")


def main():
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("GITHUB_REPOSITORY") != REPOSITORY
            or os.environ.get("GITHUB_REF") != "refs/heads/main"
            or os.environ.get("GITHUB_EVENT_NAME") not in {"pull_request_target", "workflow_dispatch"}):
        raise RuntimeError("Synchronization is restricted to this repository's main workflow.")
    number = os.environ.get("PR_NUMBER", "")
    if not re.fullmatch(r"[1-9][0-9]*", number):
        raise RuntimeError("A positive merged PR number is required.")
    sync(int(number))


if __name__ == "__main__":
    main()
