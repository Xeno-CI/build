<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/xenocast-dark.svg">
  <img src=".github/assets/xenocast-light.svg" alt="XenoCast for GitHub Actions" width="320">
</picture>

# XenoCast for GitHub Actions

**Your workflow, your rented Mac, your build**

[![Release](https://img.shields.io/github/v/release/Xeno-CI/build?style=flat-square&color=2563eb)](https://github.com/Xeno-CI/build/releases) [![MIT License](https://img.shields.io/badge/license-MIT-475569?style=flat-square)](LICENSE) [![Docs](https://img.shields.io/badge/docs-xenoci.com-2563eb?style=flat-square)](https://xenoci.com/docs) [![Downloads](https://img.shields.io/github/downloads/Xeno-CI/xenocast/total?style=flat-square&color=475569)](https://github.com/Xeno-CI/xenocast/releases)

[한국어](README.md) | [English](README.en.md)

</div>

## Install

macOS and Linux

```sh
curl -fsSL https://xenoci.com/install.sh | sh
```

Windows PowerShell

```powershell
irm https://xenoci.com/install.ps1 | iex
```

One install command takes you through GitHub login, MCP registration and a connection-check build on your rented Mac, with your approval at the login link

You need an active [Mac rental](https://xenoci.com/app/store) for the connection build, and you handle rental and payment yourself

## Give your AI this line

Paste this into Claude Code, Codex, Cursor or opencode

> Read https://raw.githubusercontent.com/Xeno-CI/xenocast/main/SETUP.md and set up XenoCast on this computer, show me the GitHub approval link, and verify the connection build on my rented Mac

The [setup guide](https://raw.githubusercontent.com/Xeno-CI/xenocast/main/SETUP.md) includes the current release installer and recovery steps, so your AI can follow the complete setup now

## Why XenoCast

**Build iOS from Windows, without a local Mac**
Send your project to a rented Mac mini M4 and run your build there
Xcode runs on the remote Mac while you stay on Windows, Linux or macOS

**Your AI can run the build**
MCP exposes five tools: build, status, cancel, logs and macs
Your agent can start a job, inspect its logs and cancel it without leaving the conversation

**Your rented Mac, not a shared runner queue**
Build on the Mac assigned to your rental rather than a shared CI runner
Check its Xcode version and remaining rental time with `xenocast macs`

**CI that uses build-only tokens**
Use a CI token with GitHub Actions, GitLab, Jenkins or your existing pipeline
It can build, read status and logs, cancel jobs and list Macs, but cannot sign, order or extend rentals

**Signing and TestFlight are in preparation**
Remote builds and artifact downloads are available today
Managed iOS signing and TestFlight upload are not yet verified for this setup, so do not rely on them for release delivery

## Connect your workflow

Use a build-only CI token, with no GitHub App installation required
From the computer where you completed setup, pipe the token straight into a secret

```sh
xenocast token --ci --raw | gh secret set XENOCAST_TOKEN --repo owner/name
```

Add `ci.sh` to your repository, then add this workflow
It runs for pushes and same-repository PRs and skips fork PR jobs

```yaml
name: macOS build
on:
  push:
  pull_request:
permissions:
  contents: read
jobs:
  build:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: xeno-ci/build@v1
        with:
          token: ${{ secrets.XENOCAST_TOKEN }}
          script: ./ci.sh
```

With the default `source: git`, the Mac fetches the commit directly, so you do not need `actions/checkout`
Build logs appear in step output and the remote build's exit code becomes the step's exit code

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `token` | Required | Build-only token from `secrets.XENOCAST_TOKEN` |
| `script` | Required | Build script path relative to the repository |
| `source` | `git` | Fetch the commit, or use `upload` for the working directory |
| `xcode` | Unset | Xcode version to use |
| `timeout` | `30` | Time limit in minutes |
| `priority` | `normal` | `normal` or `high` |
| `api-url` | `https://xenoci.com` | API address |
| `github-status` | `false` | Post commit status, requires `statuses: write` |
| `notify-url` | Unset | HTTPS URL for build notifications |

<details>
<summary>Build files generated in the workflow</summary>

Place file-generation steps after checkout and use `source: upload`

```yaml
steps:
  - uses: actions/checkout@v5
  - uses: xeno-ci/build@v1
    with:
      token: ${{ secrets.XENOCAST_TOKEN }}
      script: ./ci.sh
      source: upload
```

The `git` mode fetches changed source for subsequent builds of the same repository
For `pull_request`, the Action builds the PR head rather than GitHub's temporary merge commit and records the PR number
The `upload` mode also records the repository name for display and search

</details>

<details>
<summary>CI tokens and fork PR security</summary>

CI tokens expire after 90 days by default and cannot sign, order or extend rentals
Each run exchanges the CI token for a short-lived access token and masks both tokens in GitHub logs
The job's `GITHUB_TOKEN` used to fetch source is not stored or logged and is removed from the Mac immediately after cloning

Do not pass secrets to fork PRs
Never check out external PR code with `pull_request_target` and pass it a CI token
In GitLab, mark the token Masked and Protected, and in Jenkins withhold credentials from fork PR builds

```sh
xenocast token --ci --revoke <ses_id>
```

The retired `api-key` input and `XENOCI_API_KEY` fail immediately
Keep raw tokens out of build scripts, conversations and repositories

</details>

<details>
<summary>CLI builds in GitLab and other CI systems</summary>

Register the secret variable `XENOCAST_TOKEN` and run this on a runner with the CLI installed

```sh
xenocast build --script ./ci.sh
```

Follow the [setup guide](https://raw.githubusercontent.com/Xeno-CI/xenocast/main/SETUP.md) for installation and secret registration in GitLab, Jenkins, CircleCI, Buildkite, Bitrise or Azure Pipelines
The CLI does not write CI tokens to the credential store and reads PR numbers and commits from CI environment variables

</details>

<details>
<summary>MCP and everyday CLI commands</summary>

Connect your local AI with `xenocast setup --no-tui`, without putting tokens in MCP configuration
The five tools are `build`, `status`, `cancel`, `logs` and `macs`

| Task | Command |
| --- | --- |
| List Macs | `xenocast macs` |
| Check status | `xenocast status <rb_id>` |
| Read logs | `xenocast logs <rb_id>` |
| Cancel a build | `xenocast cancel <rb_id>` |
| Diagnose a failure | `xenocast diagnose <rb_id>` |

See the [CLI and MCP guide](https://github.com/Xeno-CI/xenocast) for local development

</details>

<details>
<summary>Troubleshooting</summary>

| Symptom | Check |
| --- | --- |
| Missing CI token | Secret name and `with.token` wiring |
| Token exchange failed | Expiration or revocation, then issue a new token |
| Source fetch failed | `contents: read` permission and target commit |
| Generated files are missing | Generate after checkout and use `source: upload` |
| Remote build failed | Step logs or `xenocast diagnose <rb_id>` |
| Fork PR job was skipped | Expected behavior in the example, keeping secrets away from external code |

Use the [error reference](https://xenoci.com/docs/errors) to find your next step

</details>

[Docs](https://xenoci.com/docs) | [XenoCast CLI](https://github.com/Xeno-CI/xenocast) | [MIT license](LICENSE)
