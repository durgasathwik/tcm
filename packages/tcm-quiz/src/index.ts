import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type, type Static } from "@sinclair/typebox";
import { resolveConfig } from "./config.js";
import { readJob, listJobs } from "./job-store.js";

const StatusParams = Type.Object({
  jobId: Type.String({ description: "Job ID returned by openclaw tcm quiz generate." }),
});
type StatusParams = Static<typeof StatusParams>;

export default definePluginEntry({
  id: "tcm-quiz",
  name: "TCM Quiz Pipeline",
  description:
    "Generates MCQ CSVs from study files: resolves source via tcm-idrive index, drives NotebookLM, writes CSV to output bucket. Exposes openclaw tcm quiz ... CLI and mcq_status tool.",
  register(api) {
    const pluginConfig = api.pluginConfig;

    api.registerTool({
      name: "mcq_status",
      label: "Check MCQ generation job status",
      description:
        "Look up the current status of an MCQ generation job by its ID. Returns running/done/error plus output key/count when available.",
      parameters: StatusParams,
      async execute(_id: string, rawParams: unknown) {
        const params = rawParams as StatusParams;
        try {
          const cfg = resolveConfig(pluginConfig);
          const job = readJob(cfg.resolvedDataDir, params.jobId);
          if (!job) {
            return {
              content: [{ type: "text" as const, text: `Job ${params.jobId} not found.` }],
              details: { found: false },
            };
          }
          const text =
            job.status === "done"
              ? `Job ${job.id} done. ${job.count} MCQs at s3://${job.outputBucket}/${job.outputKey}`
              : job.status === "error"
              ? `Job ${job.id} failed: ${job.error}`
              : `Job ${job.id} running since ${job.startedAt}.`;
          return {
            content: [{ type: "text" as const, text }],
            details: { job },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `mcq_status failed: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    });

    // Optional: surface a "recent jobs" hint via the same tool by listing when jobId is omitted —
    // but we keep the schema strict for now.

    // tcm-quiz is the sole CLI owner for the `tcm` top-level command.
    // OpenClaw's lazy CLI model invokes only one plugin's registerCli per
    // command name, so this callback registers the nlm, idrive, and quiz
    // subcommand trees together. The other two plugins no longer call
    // registerCli; they only expose their CLI registrar for import here.
    api.registerCli(
      async ({ program }) => {
        const { registerTcmNlmCli } = await import("@tcm/notebooklm/cli");
        const { registerTcmIdriveCli } = await import("@tcm/idrive/cli");
        const { registerTcmQuizCli } = await import("./cli/index.js");
        // All three registrars resolve their own config from ~/.tcm/.env;
        // pluginConfig only supplies optional overrides.
        registerTcmNlmCli(program, { config: pluginConfig });
        registerTcmIdriveCli(program, { config: pluginConfig });
        registerTcmQuizCli(program, { config: pluginConfig });
      },
      {
        descriptors: [
          {
            name: "tcm",
            description: "TCM study toolkit",
            hasSubcommands: true,
          },
        ],
      }
    );

    // Suppress unused import warning when listJobs is referenced only via CLI dynamic import.
    void listJobs;
  },
});
