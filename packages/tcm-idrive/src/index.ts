import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type, type Static } from "@sinclair/typebox";
import { existsSync } from "node:fs";
import { resolveConfig, parseSourceSpec } from "./config.js";
import { SqliteStore, defaultDbPath } from "./sqlite-store.js";
import { buildClient, uploadFile, objectExists } from "./s3-client.js";
import { guessContentType } from "./cli/put.js";

const FindParams = Type.Object({
  query: Type.String({ description: "Search terms — matched against file paths." }),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 100, default: 20, description: "Max results." })
  ),
});
type FindParams = Static<typeof FindParams>;

const PutParams = Type.Object({
  file: Type.String({ description: "Absolute path to a local file to upload." }),
  dest: Type.String({
    description:
      "Destination '<bucket>' (key = filename) or '<bucket>/<key>'. Choose the bucket from the user's request (e.g. study material for a subject goes in that subject's bucket). Bucket names are not fixed — list them with 'openclaw tcm idrive ls'. The bucket must already exist.",
  }),
  contentType: Type.Optional(
    Type.String({ description: "Override content type; inferred from extension if omitted." })
  ),
  overwrite: Type.Optional(
    Type.Boolean({ description: "Replace the destination object if a file already exists at that key." })
  ),
});
type PutParams = Static<typeof PutParams>;

export default definePluginEntry({
  id: "tcm-idrive",
  name: "TCM IDrive Index",
  description:
    "Indexes IDrive e2 S3 buckets into a local SQLite store and exposes openclaw tcm idrive ... CLI (sync/ls/tree/find/get/put/presign) + idrive_find and idrive_put tools.",
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
            const limit = params.limit ?? 20;
            const buckets = store.distinctBuckets();
            const hits: Array<{ bucket: string; key: string; size: number }> = [];
            for (const b of buckets) {
              for (const h of store.find(b, params.query, limit)) {
                hits.push({ bucket: h.bucket, key: h.key, size: h.size });
                if (hits.length >= limit) break;
              }
              if (hits.length >= limit) break;
            }
            const text =
              hits.length === 0
                ? `No matches for "${params.query}".`
                : hits.map((h) => `${h.bucket}/${h.key} (${h.size} B)`).join("\n");
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

    // MCP tool: upload a local workspace file back to IDrive.
    api.registerTool({
      name: "idrive_put",
      label: "Upload a file to IDrive",
      description:
        "Upload a local file to an IDrive e2 bucket. dest is '<bucket>' (key defaults to the filename) or '<bucket>/<key>'. Pick the bucket from the user's request. Refuses to overwrite an existing object unless overwrite=true.",
      parameters: PutParams,
      async execute(_id: string, rawParams: unknown) {
        const params = rawParams as PutParams;
        try {
          if (!existsSync(params.file)) {
            throw new Error(`local file not found: ${params.file}`);
          }
          const { bucket } = parseSourceSpec(params.dest);
          let { key } = parseSourceSpec(params.dest);
          if (!bucket) throw new Error(`invalid dest "${params.dest}" — expected '<bucket>[/<key>]'`);
          if (!key) key = params.file.split("/").pop() ?? params.file;

          const cfg = resolveConfig(pluginConfig);
          const client = buildClient(cfg);
          if (!params.overwrite && (await objectExists(client, bucket, key))) {
            throw new Error(
              `s3://${bucket}/${key} already exists. Pass overwrite=true to replace it.`
            );
          }
          const contentType = params.contentType ?? guessContentType(params.file);
          await uploadFile(client, bucket, key, params.file, contentType);
          const uri = `s3://${bucket}/${key}`;
          return {
            content: [{ type: "text" as const, text: `Uploaded ${params.file} → ${uri}` }],
            details: { bucket, key, uri, contentType },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `idrive_put failed: ${msg}` }],
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
