import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type, type Static } from "@sinclair/typebox";
import { resolveConfig } from "./config.js";
import { SqliteStore, defaultDbPath } from "./sqlite-store.js";

const FindParams = Type.Object({
  query: Type.String({ description: "Search terms — matched against file paths." }),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 100, default: 20, description: "Max results." })
  ),
});
type FindParams = Static<typeof FindParams>;

export default definePluginEntry({
  id: "tcm-idrive",
  name: "TCM IDrive Index",
  description:
    "Indexes an IDrive e2 S3 bucket into a local SQLite store and exposes openclaw tcm idrive ... CLI + idrive_find tool.",
  register(api) {
    const pluginConfig = api.pluginConfig;

    // MCP tool: lightweight fuzzy file search for agents.
    api.registerTool({
      name: "idrive_find",
      label: "Find files in IDrive index",
      description:
        "Search the local IDrive index for files matching the query. Returns up to N file keys with sizes. Run `openclaw tcm idrive sync` first if results are stale.",
      parameters: FindParams,
      async execute(_id: string, rawParams: unknown) {
        const params = rawParams as FindParams;
        try {
          const cfg = resolveConfig(pluginConfig);
          const store = new SqliteStore(defaultDbPath(cfg.resolvedDataDir));
          try {
            const hits = store.find(cfg.sourceBucket, params.query, params.limit ?? 20);
            const text =
              hits.length === 0
                ? `No matches for "${params.query}".`
                : hits.map((h) => `${h.key} (${h.size} B)`).join("\n");
            return {
              content: [{ type: "text" as const, text }],
              details: { hits, count: hits.length },
            };
          } finally {
            store.close();
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `idrive_find failed: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    });

    // CLI: openclaw tcm idrive <subcommand>
    api.registerCli(
      async ({ program }) => {
        const { registerTcmIdriveCli } = await import("./cli/index.js");
        registerTcmIdriveCli(program, { config: pluginConfig });
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
  },
});
