# Pipeline

The end-to-end flow when you run `openclaw tcm quiz generate "<source>" --count N --difficulty L`.

## Diagram

```
              openclaw tcm quiz generate
                          │
                          ▼
            ┌────────────────────────────┐
            │ tcm-quiz pipeline.ts       │
            │  - allocate jobId          │
            │  - write jobs/<id>.json    │
            └─────────────┬──────────────┘
                          │ status = running
                          ▼
            ┌────────────────────────────┐
            │  Resolve source via        │       index.db
            │  ~/.tcm/index.db (RO)      │◄─────────────┐
            │  → list of S3 keys (≤5)    │              │
            └─────────────┬──────────────┘              │
                          │                              │
                          ▼                              │
            ┌────────────────────────────┐               │
            │  Look up notebook-map.json │   (written by │
            │  for <source>              │   tcm-idrive  │
            │  - found?   reuse notebook │    sync)      │
            │  - missing? create new     │               │
            └─────────────┬──────────────┘               │
                          │                              │
                          ▼                              │
            ┌────────────────────────────┐               │
            │  Diff sources by ETag      │               │
            │  → set of NEW keys to add  │               │
            └─────────────┬──────────────┘               │
                          │ for each new key             │
                          ▼                              │
            ┌────────────────────────────┐  download     │
            │  s3.getObject              │──────────────►│
            │  /tmp/tcm/<jobId>/<file>   │               │
            └─────────────┬──────────────┘               │
                          │ upload                       │
                          ▼                              │
            ┌────────────────────────────┐               │
            │  nlm source add ...        │               │
            │  (~/.local/bin/nlm)        │               │
            └─────────────┬──────────────┘               │
                          │                              │
                          ▼                              │
            ┌────────────────────────────┐               │
            │  nlm notebook query        │               │
            │   "make N MCQs as JSON"    │               │
            └─────────────┬──────────────┘               │
                          │ JSON answer                  │
                          ▼                              │
            ┌────────────────────────────┐               │
            │  parseMcqArray (loose-JSON)│               │
            │  dedupeMcqs (stem hash)    │               │
            └─────────────┬──────────────┘               │
                          │                              │
                          ▼                              │
            ┌────────────────────────────┐               │
            │  writeCsv (RFC 4180)       │               │
            │  /tmp/tcm/<jobId>/output.csv│              │
            └─────────────┬──────────────┘               │
                          │ s3.putObject                  │
                          ▼                              │
            ┌────────────────────────────┐               │
            │  s3://tcm-mcqs/mcq/<...>.csv│              │
            └─────────────┬──────────────┘               │
                          │ getSignedUrl                  │
                          ▼                              │
            ┌────────────────────────────┐               │
            │  presigned URL (24h)        │              │
            └─────────────┬──────────────┘               │
                          │                              │
                          ▼                              │
            ┌────────────────────────────┐               │
            │  Update jobs/<id>.json     │               │
            │   status = done            │               │
            │   outputKey, count         │               │
            └─────────────┬──────────────┘               │
                          │ rm -rf /tmp/tcm/<jobId>/      │
                          ▼                              │
            stdout: { jobId, s3Uri, presignedUrl, count, │
                       notebookId, outputKey }            │
```

## Failure modes

| Where | Symptom | Recovery |
| --- | --- | --- |
| Source resolution | `no files resolved for source "X"` | Run `openclaw tcm idrive sync` first. |
| Notebook create | spawn fails / no ID parsed | Confirm `nlm login --check` returns OK. |
| nlm rate limit | "NotebookLM rate limit reached" | Wait until quota resets; job marked `error`. |
| MCQ parse | "NotebookLM returned no parseable MCQs" | Re-run; sometimes the model emits prose-only. The job is marked `error` and the CSV is not written. |
| S3 upload | 403 / NoSuchBucket | Check `outputBucket` exists and creds have write access. |
| Any failure | partial state | The scratch dir `/tmp/tcm/<jobId>/` is wiped on any error. The job record persists as `status=error`. |

## Why scratch is in `/tmp`

`/tmp` is wiped on reboot. Source PDFs and intermediate CSVs are bulky and shouldn't persist beyond the job. The canonical copies live in S3.

## Notebook reuse semantics

A "topic" is whatever string you pass as `<source>` to `quiz generate` — typically a folder path like `Biology/Genetics` or a single file key. The mapping is exact-match. If you run quizzes on `Biology/Genetics` twice with different files in the folder, the second run reuses the same notebook but only uploads the new files (by ETag diff).

If you ever want to wipe a topic's mapping and start fresh:

```bash
openclaw tcm quiz forget "Biology/Genetics"
```

The old notebook is left intact on NotebookLM — `forget` only removes the local mapping. (We deliberately don't delete notebooks per user direction.)
