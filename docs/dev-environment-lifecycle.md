# Development environment lifecycle

CI controls these operations on `dev`; deployment credentials remain confined to the `development` job.

The development job runs only after `CI passed` on `dev`. It checks the current branch revisions before changing resources. Different commits with identical Git trees count as the same source.

## Automatic mode

- When `dev` matches `main`, stop the dev app, then Redis, then PostgreSQL. Before every stop, require the destination server's `delete_unused_volumes` policy to be explicitly false. Missing server identity, an enabled policy or an unknown response aborts hibernation. Each stop uses `docker_cleanup=false` and waits for completion.
- When their source differs, start PostgreSQL and Redis if needed, wait for healthy dependencies, pin the exact tested commit, deploy the dev app, and verify its health endpoint.
- Skip superseded commits. Recheck branch equality before each stop and before deployment. An active deployment prevents sleeping the environment.
- Validate the exact dev application and database identities before mutations. Production resources are excluded. CI serializes lifecycle operations through the existing development concurrency group.

## Manual activation

Run the CI workflow on `dev` with `dev_mode=deploy` to make dev available even when it matches `main`. All checks still run before deployment. A later automatic run can put an equal environment back to sleep.

## Image cleanup and data

Coolify already has scheduled server cleanup and application image retention. Keep persistent-volume deletion disabled and retain rollback images. Coolify 4.5.3 removes standalone database containers when stopping them; their volumes then have no container reference. `docker_cleanup=false` disables only immediate cleanup, so scheduled unused-volume pruning must also remain disabled. Image cleanup remains enabled. The lifecycle commands do not delete volumes or run a Docker prune.

Native server cleanup is separate from the local Docker image/build-cache cleanup performed during dependency validation. No local cleanup command is automatically applied to a Coolify server.

Implementation: `scripts/ci/deploy-dev.py`, `scripts/coolify-deploy`, and `.github/workflows/ci.yml`. Regression tests: `tests/ci/test_deploy_dev.py`.
