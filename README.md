# TCM — OpenClaw plugin suite

Turn an IDrive e2 S3 bucket of study material into MCQ quiz CSVs via NotebookLM.

Three OpenClaw plugins working together. No deployment scaffolding — you bring the OpenClaw gateway, this repo brings the brains.

## What it does

- **`tcm-idrive`** — Indexes your S3 bucket into a local SQLite store. Exposes `openclaw tcm idrive sync/ls/tree/find/get/presign` plus an `idrive_find` MCP tool for agents. Also writes optional per-folder summary markdown into OpenClaw's memory directory so `memory_search` can find your study material by topic.
- **`tcm-notebooklm`** — Wraps the [`nlm`](https://pypi.org/project/notebooklm-mcp-cli/) CLI. Exposes `openclaw tcm nlm status/create/add/ask/list`.
- **`tcm-quiz`** — Orchestrator. Resolves a folder/file from the index, downloads each source, uploads to a NotebookLM notebook (reusing per topic — new sources are appended, never re-uploaded), asks for MCQs, writes a CSV, uploads to a separate output bucket, prints a presigned download URL. Exposes `openclaw tcm quiz generate/list/show/download/forget` and an `mcq_status` MCP tool.

## End-to-end user flow

```
# 1. one-time
openclaw tcm setup                          # interactive: keys, buckets, nlm path
openclaw tcm idrive sync                    # scan your S3 study bucket

# 2. anytime
openclaw tcm quiz generate "Biology/Genetics" --count 30 --difficulty medium
# → CSV in s3://tcm-mcqs/mcq/<jobId>-biology-genetics.csv
# → presigned download URL printed (24h TTL by default)
```

If you're invoking this from a Telegram-fronted agent (or any other agent connected to the gateway): the agent shells out to the same CLI commands and reads the final JSON line for the result. The 30 MCQs never enter the agent's context — only the receipt does.

## Install

Each plugin is a separate npm package in this monorepo. To install into an existing OpenClaw gateway:

```bash
# clone
git clone https://github.com/durgasathwik/tcm.git
cd tcm
pnpm install
pnpm -r exec tsc -p tsconfig.json   # builds dist/

# tell openclaw about the local packages
openclaw plugins install ./packages/tcm-idrive
openclaw plugins install ./packages/tcm-notebooklm
openclaw plugins install ./packages/tcm-quiz
```

OpenClaw can also install plugins directly from a git URL — see [`docs/INSTALL.md`](./docs/INSTALL.md) for the exact recipes.

After install, run the setup wizard:

```bash
openclaw tcm setup
```

It prompts for IDrive credentials and bucket names, writes `~/.tcm/.env` (mode 0600), verifies your credentials by hitting the source bucket, checks that `nlm` is authenticated, and prints the config snippet to paste into `~/.openclaw/config.json`.

## CLI cheatsheet

| Command | What it does |
| --- | --- |
| `openclaw tcm setup` | Interactive credential setup |
| `openclaw tcm idrive sync [--prefix X]` | Scan source bucket → SQLite + memory summaries |
| `openclaw tcm idrive ls [path]` | List folder contents (folders + files) |
| `openclaw tcm idrive tree [--depth N]` | Tree view of folder structure |
| `openclaw tcm idrive find <query>` | Fuzzy search filenames |
| `openclaw tcm idrive get <key> --out <path>` | Download one object |
| `openclaw tcm idrive presign <key>` | Print a presigned download URL |
| `openclaw tcm nlm status` | NotebookLM auth check |
| `openclaw tcm nlm create <title>` | Create a notebook, print its ID |
| `openclaw tcm nlm add <nb-id> --file <path>` | Add a source |
| `openclaw tcm nlm ask <nb-id> "<q>" [--json]` | Query a notebook |
| `openclaw tcm quiz generate <source> [--count N] [--difficulty L]` | Generate MCQ CSV |
| `openclaw tcm quiz list [--status done\|running\|error]` | Recent jobs |
| `openclaw tcm quiz show <jobId>` | Full job record (JSON) |
| `openclaw tcm quiz download <jobId>` | Presigned download URL for CSV |
| `openclaw tcm quiz forget <topic>` | Clear notebook-reuse mapping for a topic |

## How notebook reuse works

`tcm-quiz` maintains `~/.tcm/notebook-map.json` mapping `<source-path>` → `{ notebookId, sources: { <key>: { etag } } }`. On each `generate`:

1. Look up the topic. If a notebook already exists for it, reuse the same notebook.
2. Diff the resolved source files against what's tracked in the notebook by S3 ETag.
3. Only newly-added or content-changed files get downloaded and uploaded to NotebookLM. Already-tracked sources are left in place.
4. Run the MCQ query against the notebook. Update the map's `lastUsedAt`.

Result: subsequent quizzes on the same topic are fast and your NotebookLM accumulates sources rather than spawning duplicates. If you want a fresh notebook for a topic, run `openclaw tcm quiz forget "<topic>"`.

## State

| Where | What |
| --- | --- |
| `~/.tcm/index.db` | SQLite file/folder index (rebuildable from a fresh `sync`) |
| `~/.tcm/jobs/<id>.json` | One file per quiz job |
| `~/.tcm/notebook-map.json` | Topic → notebook ID mapping |
| `~/.tcm/.env` | Secrets (mode 0600) written by `setup` |
| `s3://tcm-study/` | Your study materials (canonical) |
| `s3://tcm-mcqs/` | Generated CSVs (canonical) |

## Development

```bash
pnpm install
pnpm -r exec tsc -p tsconfig.json
pnpm -r exec vitest run
```

Tests live in each package under `src/__tests__/`. Network-heavy paths (S3, nlm) are tested at the integration boundary only — unit tests cover parsers, schemas, the SQLite store, and the notebook map.

## License

MIT — see [`LICENSE`](./LICENSE).
