# XenoCI Checkout

`actions/checkout@v4` with a cached Git mirror on XenoCI macOS runners.

```yaml
- uses: Xeno-CI/build/checkout@<commit sha>
  with:
    fetch-depth: 0   # every actions/checkout@v4 input works the same way
```

- The inputs and outputs are those of `actions/checkout@v4` (v4.3.1, included unchanged in `upstream/`).
- On a XenoCI runner the organization keeps one Git mirror per repository on a sticky disk. The first run fetches as
  usual; later runs fetch only the commits the mirror does not have.
- Only runs of the default branch triggered by `push`, `schedule` or `workflow_dispatch` update the mirror. Pull
  requests and other branches read it and never write to it.
- A mirror unused for 7 days is deleted. Mirrors are stored and billed like sticky disks.
- No mirror, no room for one, or any mirror error: the step does a normal `actions/checkout@v4` checkout and the job
  continues. `ssh-key`, `filter`, another repository or another GitHub server always use the normal checkout.
- The job token is used only for the fetch and is never stored with the mirror.
- Outside XenoCI runners the step is exactly `actions/checkout@v4`.
