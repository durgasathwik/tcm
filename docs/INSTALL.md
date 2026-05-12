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

### Install-time gotchas

OpenClaw runs a code-safety scan on every plugin install. These three are known to trip on pnpm-workspace layouts; all of them have a clean workaround:

1. **Symlinks from pnpm workspace deps** — `better-sqlite3` and `@tcm/shared` both resolve to symlinks under pnpm's default layout. The scanner refuses to follow them. This repo ships `.npmrc` with `node-linker=hoisted`, which fixes transitives but **not** workspace deps (`@tcm/shared` is still a symlink). The clean path is to pass `--dangerously-force-unsafe-install` on each install. Review the spawn surface first — it's in `packages/tcm-notebooklm/src/nlm-runner.ts` and `packages/tcm-idrive/src/cli/setup.ts`.

2. **`child_process.spawn` flagged as `dangerous-exec`** — the plugins call `spawn` to drive the `nlm` CLI (legitimate). The same `--dangerously-force-unsafe-install` covers this. Runtime allowlist alone (`plugins.allow`) doesn't bypass the install-time scan.

3. **pnpm 11 approve-builds prompt** — `pnpm install` may prompt to approve native module builds (`better-sqlite3`, `koffi`, `esbuild`, etc.) even with `onlyBuiltDependencies` set. Approve **only `better-sqlite3`**; reject the rest. This is a pnpm 11 ecosystem quirk, not a TCM bug.

Putting it together — a clean install from scratch:

```bash
git clone https://github.com/durgasathwik/tcm.git
cd tcm
pnpm install                                              # approve better-sqlite3 only
pnpm -r exec tsc -p tsconfig.json
openclaw plugins install --dangerously-force-unsafe-install ./packages/tcm-idrive
openclaw plugins install --dangerously-force-unsafe-install ./packages/tcm-notebooklm
openclaw plugins install --dangerously-force-unsafe-install ./packages/tcm-quiz
```

### Default config — no `openclaw.json` edit required to install

All plugin config fields now have sensible defaults (endpoint defaults to `https://s3.ap-northeast-1.idrivee2.com`, output bucket defaults to `tcm-mcqs`, etc.). The plugin manifests have no `required` fields, so `openclaw plugins install` succeeds with empty `plugins.entries.<id>` objects. You only need to override defaults that don't match your IDrive region or bucket layout — `openclaw tcm setup` does this for you.

### `.env` auto-loaded — `source` not required

`tcm-idrive` and `tcm-quiz` both auto-load `<dataDir>/.env` (default `~/.tcm/.env`) at runtime. After `openclaw tcm setup --yes ...` writes the file, restart the gateway and the credentials are picked up automatically. Process env still wins when both are set, so CI/Docker workflows can override via `IDRIVE_E2_ACCESS_KEY` / `IDRIVE_E2_SECRET_KEY` env vars.

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
