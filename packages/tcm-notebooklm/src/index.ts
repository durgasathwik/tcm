import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "tcm-notebooklm",
  name: "TCM NotebookLM Bridge",
  description:
    "Wraps the nlm CLI for use from inside OpenClaw. Exposes openclaw tcm nlm ... subcommands.",
  register(api) {
    const pluginConfig = api.pluginConfig;

    api.registerCli(
      async ({ program }) => {
        const { registerTcmNlmCli } = await import("./cli/index.js");
        registerTcmNlmCli(program, { config: pluginConfig });
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
