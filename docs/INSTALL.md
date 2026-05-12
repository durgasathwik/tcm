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

### If install is blocked by code safety scan

The plugins shell out to the `nlm` CLI via `child_process.spawn` (legitimate — that's how they drive NotebookLM). On some OpenClaw versions the safety scanner flags this as `dangerous-exec` and blocks install. Allowlist the three plugins:

```bash
openclaw config set 'plugins.allow' '["tcm-idrive","tcm-notebooklm","tcm-quiz"]'
```

Or pass `--dangerously-force-unsafe-install` per install. Review the spawn surface first — it's in `packages/tcm-notebooklm/src/nlm-runner.ts` and `packages/tcm-idrive/src/cli/setup.ts`.

### If install fails with a symlink error

`Error: manifest dependency scan found node_modules symlink target outside install root` means pnpm's default `node-linker=isolated` produced symlinks the scanner refuses to follow. This repo ships `.npmrc` with `node-linker=hoisted` so a fresh `pnpm install` produces a flat tree. If you already installed before pulling that file, blow away the trees and reinstall:

```bash
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm -r exec tsc -p tsconfig.json
```

### Native build approval (pnpm 11)

pnpm 11 prompts to approve native module builds (`better-sqlite3`) even with `onlyBuiltDependencies` set in `package.json`. If `pnpm install` pauses, approve only `better-sqlite3`; reject the rest.

## Configure

### Interactive (terminal user)

```bash
openclaw tcm setup
```

The wizard:

1. Prompts for endpoint, region, access/secret key, bucket names, `nlm` path, data directory.
2. Discovers buckets via `ListBuckets` and lets you pick subjects.
3. Writes `~/.tcm/.env` (mode 0600).
4. Verifies each subject bucket and the `nlm` CLI.
5. Prints a JSON snippet to paste into `~/.openclaw/config.json` under `plugins.entries` (or pass `--apply-config` to write it for you).

### Non-interactive (chat agent / scripted)

Drive setup from a chat agent or any caller that can shell out — every prompt has a matching flag, and `--json` emits a single-line receipt the caller can parse.

```bash
openclaw tcm setup --yes \
  --endpoint https://s3.ap-northeast-1.idrivee2.com \
  --region ap-northeast-1 \
  --access-key "$IDRIVE_E2_ACCESS_KEY" \
  --secret-key "$IDRIVE_E2_SECRET_KEY" \
  --subject-buckets maths,biology,english,hindi,physics,chemistry,social,telugu \
  --output-bucket tcm-mcqs \
  --apply-config \
  --json
```

Pass `--subject-buckets auto` to take all discovered buckets except `--output-bucket`. Omit `--access-key`/`--secret-key` to reuse the values already in `~/.tcm/.env`.

Receipt shape (single line, last in stdout):

```json
{
  "envPath": "/home/u/.tcm/.env",
  "subjectBuckets": ["maths","biology",...],
  "outputBucket": "tcm-mcqs",
  "bucketChecks": [{"bucket":"maths","ok":true}, ...],
  "nlmOk": true,
  "nlmEmail": "you@example.com",
  "configApplied": true,
  "warnings": []
}
```

Exit codes: `0` success, `1` setup ran but a check failed (env file is still written), `2` required flag missing, `3` ListBuckets failed during `auto` resolution.

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

All other settings (endpoint, region, subject buckets, output bucket, paths) come from `openclaw.json`, not env. Re-run `openclaw tcm setup` to change them.

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
