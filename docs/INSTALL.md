# Install

## Prerequisites

- **OpenClaw gateway** running and reachable (`openclaw plugins list` works).
- **Node 20+** and **pnpm** (`corepack enable && corepack prepare pnpm@latest --activate`).
- **`nlm` CLI** installed and authenticated:
  ```bash
  pipx install notebooklm-mcp-cli   # or: pip install --user notebooklm-mcp-cli
  ~/.local/bin/nlm login            # interactive Google OAuth
  ~/.local/bin/nlm login --check    # confirms "Authentication valid! you@example.com"
  ```
- **IDrive e2 account** with two buckets created (default names: `tcm-study` for input, `tcm-mcqs` for output).

## From this repo

```bash
git clone https://github.com/durgasathwik/tcm.git
cd tcm
pnpm install
pnpm -r exec tsc -p tsconfig.json
```

Each subfolder in `packages/` is a self-contained OpenClaw plugin once built (look in `packages/<name>/dist/`).

## Register plugins with OpenClaw

```bash
openclaw plugins install ./packages/tcm-idrive
openclaw plugins install ./packages/tcm-notebooklm
openclaw plugins install ./packages/tcm-quiz
```

If your OpenClaw supports git-URL installs (newer builds do), you can also point straight at this repo:

```bash
openclaw plugins install git+https://github.com/durgasathwik/tcm.git#packages/tcm-idrive
openclaw plugins install git+https://github.com/durgasathwik/tcm.git#packages/tcm-notebooklm
openclaw plugins install git+https://github.com/durgasathwik/tcm.git#packages/tcm-quiz
```

## Configure

Run the wizard — it handles everything end-to-end:

```bash
openclaw tcm setup
```

It will:

1. Prompt for endpoint, region, access/secret key, bucket names, `nlm` path, and data directory.
2. Write `~/.tcm/.env` (mode 0600) with the IDrive credentials.
3. Verify credentials by listing the source bucket (`ListObjectsV2`, max 1 key).
4. Verify the `nlm` CLI by running `nlm login --check`.
5. Print a JSON snippet to paste into `~/.openclaw/config.json` under `plugins.entries`.

## Required environment variables

The `setup` command writes these into `~/.tcm/.env`. Source the file before running OpenClaw:

```bash
set -a; source ~/.tcm/.env; set +a
```

Add that to your shell profile, or have your service manager (systemd, etc.) load the file as an EnvironmentFile.

| Variable | Required | Purpose |
| --- | --- | --- |
| `IDRIVE_E2_ACCESS_KEY` | yes | IDrive access key |
| `IDRIVE_E2_SECRET_KEY` | yes | IDrive secret key |
| `IDRIVE_E2_ENDPOINT` | no (defaults in plugin config) | Override endpoint URL |
| `IDRIVE_E2_REGION` | no | Override signature region |
| `TCM_SOURCE_BUCKET` | no | Override source bucket name |
| `TCM_MCQ_BUCKET` | no | Override output bucket name |
| `TCM_NLM_BIN` | no | Override path to `nlm` |
| `TCM_DATA_DIR` | no | Override local data dir |

Note: the plugins themselves only read `accessKeyEnv` / `secretKeyEnv` from process env. All other settings come from `openclaw.json`. The `setup` snippet wires the JSON correctly.

## Example openclaw.json snippet

```json5
{
  plugins: {
    entries: {
      "tcm-idrive": {
        enabled: true,
        config: {
          endpoint: "https://s3.us-east-1.idrivee2.com",
          region: "us-east-1",
          sourceBucket: "tcm-study",
          dataDir: "~/.tcm"
        }
      },
      "tcm-notebooklm": {
        enabled: true,
        config: { nlmBin: "~/.local/bin/nlm" }
      },
      "tcm-quiz": {
        enabled: true,
        config: {
          outputBucket: "tcm-mcqs",
          endpoint: "https://s3.us-east-1.idrivee2.com",
          region: "us-east-1",
          sourceBucket: "tcm-study",
          dataDir: "~/.tcm",
          nlmBin: "~/.local/bin/nlm"
        }
      }
    }
  }
}
```

## Verify

```bash
openclaw plugins list                       # should show tcm-idrive, tcm-notebooklm, tcm-quiz
openclaw tcm idrive sync                    # should report a non-zero file count
openclaw tcm nlm status                     # should print your Google email
openclaw tcm quiz generate <small-folder> --count 5 --difficulty easy
```

The final command's last stdout line is a single-line JSON: `{ "jobId": "...", "s3Uri": "s3://tcm-mcqs/...", "presignedUrl": "https://...", "count": 5, "notebookId": "...", "outputKey": "mcq/..." }`. Use that URL to download the CSV.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `missing credentials` | Did you `source ~/.tcm/.env` before starting OpenClaw? Restart the gateway after sourcing. |
| `no files resolved for source "X"` | Run `openclaw tcm idrive sync` first. `find` and `ls` only see what's been synced. |
| `NotebookLM rate limit reached` | Free tier is ~50 queries/day. Wait or upgrade. |
| `nlm spawn failed` | Reinstall `notebooklm-mcp-cli` and confirm with `nlm login --check`. |
| `S3 endpoint redirect` | IDrive sometimes returns region-specific endpoints. Run `setup` again and confirm endpoint. |
