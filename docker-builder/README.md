# Linux Docker builder — unpublished DEV draft

This folder is used only from a checkout of the XenoCI dev branch. It is not a
release of the public build action. It uses the ephemeral Linux VM's Docker
socket, never the lab host daemon or a remote Docker context.

The Linux image owner supplies Docker Engine, buildx, Compose, Node 24 and two
digest-pinned images: BuildKit and a GNU tar helper. Keep setup before other
actions with post hooks where possible: post hooks run in reverse order. The
wrapper registers unconditional cleanup first and success-only saving second.

```yaml
runs-on: xenoci-2vcpu-ubuntu-2404
steps:
  # This example assumes the dev draft is already in the workspace.
  - id: docker
    uses: ./integrations/docker-builder
    with:
      cache-key: Dockerfile
      buildkit-image: ${{ vars.XENOCI_BUILDKIT_IMAGE }}
      helper-image: ${{ vars.XENOCI_ARCHIVE_IMAGE }}
  - uses: docker/build-push-action@v7
    with:
      context: .
      builder: ${{ steps.docker.outputs.builder }}
      push: false
      load: true
      tags: app:ci
```

For shell builds use `docker buildx build --builder "$BUILDX_BUILDER" --load .`
or `docker build --builder "$BUILDX_BUILDER" .`. Compose inherits
`BUILDX_BUILDER`; registry pushes remain the workflow's responsibility.

## State and authorization

The driver uses the native snapshotter and a job-private named volume. After
BuildKit stops cleanly, the complete state is archived, including
`RUN --mount=type=cache` directories. On the next job a new volume is restored
before bootstrapping BuildKit. Archives are validated and extracted only in a
network-disabled helper with a read-only root filesystem and no Docker socket
or host/workspace bind mounts.

The existing `XENOCI_STICKY_CONFIG` and `XENOCI_CACHE_JOB_CAPABILITY` handoff
authorizes `kind: sticky` leases. Keys include a `docker-buildkit-v1` namespace,
workload key, architecture, BuildKit digest and snapshotter. Existing server
organization/repository/ref rules remain authoritative. The action sends no
capability to the NAS; the signed object URL is sufficient. The Linux proxy
must route `sticky.ci.xeno` through its existing NAS pin, not a new bypass.

A competing writer attempts a read lease once; absent readable state it builds
cold. This is the existing exclusive-writer/generation-CAS protocol, **not**
last-write-wins. Cache miss, outage, rejected archive or failed save produces a
warning without failing a healthy Docker build. Docker setup failure itself
still fails. Read-only jobs and failed/canceled jobs do not publish. Saving
means the success post hook ran successfully, not that a later runner failure
can be predicted or rolled back.

## Current boundaries

- Existing lease capacity: 1 GiB; lease lifetime: at most one hour. This draft
  adds no capacity change, lease renewal, price or billing policy. Actual DEV
  measurements require an already usage-only QA organization.
- Whole-volume transfer is not a remote mounted disk and may cost more elapsed
  time than the build saves. Report restore, build, save and total separately.
- Docker daemon image-store sharing, service-container prewarming,
  organization-wide image merging and multi-architecture native scheduling
  are not implemented by this layer cache action.
- No BuildKit TCP listener, host socket sharing, general Docker prune, registry
  publication or public action release is performed.
- The relative composite action paths require this draft at
  `./integrations/docker-builder`; arbitrary checkout locations are not supported.

## Evidence commands

In the linux-lab-provided disposable VM, with its actual DEV grant and pinned
image variables, run `scripts/ci-linux-docker-cache-check.mjs --case cold
--cache-key linux-docker-qa-v1 --evidence <absolute-owned-directory>` and then
`--case warm` in a fresh builder/volume. Set `XENOCI_DOCKER_QA_VM` to the supplied
VM identity. Version output, build logs, cache-mount marker, Compose run, result
hash, timing and cleanup receipts are saved. A unit pass is not VM evidence.

Official references read for this design:
- https://docs.blacksmith.sh/blacksmith-caching/docker-builds.md
- https://docs.blacksmith.sh/blacksmith-caching/docker-container-caching.md
- https://docs.docker.com/build/builders/drivers/docker-container/
