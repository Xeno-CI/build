# XenoCI sticky disk delete

Deletes sticky disks of the workflow's own repository from a step. Same input
names as Blacksmith's `stickydisk-delete` (`delete-key`, `delete-docker-cache`),
plus `api-key`: an admin or normal XenoCI API key stored as the repository
secret `XENOCI_API_KEY` (a read key gets 403 and nothing is deleted).

```yaml
jobs:
  reset-cache:
    runs-on: ubuntu-latest   # any runner; the action only calls the XenoCI API
    steps:
      - uses: Xeno-CI/build/stickydisk-delete@main
        with:
          delete-key: dependencies          # exact key, every architecture
          # delete-docker-cache: true       # this repository's Xeno-CI/build/docker-builder cache
          api-key: ${{ secrets.XENOCI_API_KEY }}
```

- Only disks of `GITHUB_REPOSITORY` whose key matches exactly are deleted.
  `delete-docker-cache: true` deletes the repository's Docker builder disks.
- A delete cannot be undone; the next job fills the disk again. Each delete is
  in the organization's audit log. No match is not an error (a notice line).
- Outputs: `deleted` (number of disks), `deleted-bytes`.
- Same API as `xenoci stickydisk delete --repo owner/name --key KEY --yes`.

`scripts/build-stickydisk-delete-action.sh <out>` copies the folder for
publishing to Xeno-CI/build/stickydisk-delete (no bundling needed: node
built-ins only).
