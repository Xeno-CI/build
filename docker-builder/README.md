# XenoCI Docker builder

A BuildKit builder whose whole state (image layers and `RUN --mount=type=cache` directories) stays on a disk of your
organization between jobs. Replace `docker/setup-buildx-action` with it and keep building the way you do now.

```yaml
runs-on: xenoci-2vcpu-ubuntu-2404
steps:
  - uses: actions/checkout@v4
  - uses: Xeno-CI/build/docker-builder@<commit sha>   # was: docker/setup-buildx-action
    with:
      cache-key: Dockerfile
  - uses: docker/build-push-action@v6
    with:
      push: true
      tags: user/app:latest
      # cache-from / cache-to are no longer needed
```

- `cache-key` (required) names the layer cache. Builds with the same key share layers. A good default is the path of the
  Dockerfile being built; give unrelated images different keys.
- The builder is the job's default (`BUILDX_BUILDER`), so `docker/build-push-action`, `docker/bake-action`,
  `docker buildx build`, `docker build` and `docker compose build` all use it. Its name is also the `name` output.
- The first job with a key builds without cache. Later jobs start from the last saved state, nothing is downloaded or
  uploaded as an archive.
- The state is saved at the end of a successful job. A failed or cancelled job saves nothing.
- Only jobs of the default branch triggered by `push`, `schedule` or `workflow_dispatch` save. Pull requests and other
  branches start from the default branch's cache and never change it.
- A cache unused for 7 days is deleted. Caches are stored and billed like sticky disks.
- No cache available (first run, no room, any error): the step prints a warning and builds with an empty builder. The job
  does not fail because of the cache.
- On a runner other than a XenoCI Linux runner the step fails: use `docker/setup-buildx-action` there.

Inputs `buildkit-image` and `helper-image` choose the digest-pinned BuildKit image and the tar helper; the defaults are
kept up to date with this action.

Build the publishable folder with `scripts/build-docker-builder-action.sh <out-dir>` (one self-contained module per
entry, no relative imports).
