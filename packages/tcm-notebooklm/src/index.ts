import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "tcm-notebooklm",
  name: "TCM NotebookLM Bridge",
  description:
    "Wraps the nlm CLI for use from inside OpenClaw. Exposes openclaw tcm nlm ... subcommands.",
  register(_api) {
    // CLI registration is owned by tcm-quiz, which imports registerTcmNlmCli
    // from "@tcm/notebooklm/cli" and registers it on the shared `tcm` program.
    // OpenClaw's lazy CLI model invokes only one plugin's registerCli per
    // top-level command name, so this plugin no longer declares its own.
  },
});
