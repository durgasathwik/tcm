import type { Command } from "commander";
import { defaultConfig, runNlm, looseParseJson, unwrapQueryAnswer, parseNotebookId } from "../nlm-runner.js";

export interface CliContext {
  config: Record<string, unknown> | undefined;
}

export function registerTcmNlmCli(program: Command, ctx: CliContext): void {
  // Ensure the shared "tcm" root exists. Another plugin may have created it; reuse if so.
  let root = program.commands.find((c) => c.name() === "tcm");
  if (!root) {
    root = program.command("tcm").description("TCM study toolkit commands");
  }

  const nlm = root.command("nlm").description("NotebookLM CLI wrapper");

  const cfg = () => defaultConfig(ctx.config);

  nlm
    .command("status")
    .description("Check NotebookLM authentication status")
    .action(async () => {
      const res = await runNlm(cfg(), ["login", "--check"]);
      process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
    });

  nlm
    .command("create <title>")
    .description("Create a new NotebookLM notebook and print its ID")
    .action(async (title: string) => {
      const res = await runNlm(cfg(), ["notebook", "create", title]);
      const id = parseNotebookId(res.stdout);
      if (!id) {
        process.stderr.write(`Could not parse notebook ID from output:\n${res.stdout}\n`);
        process.exit(1);
      }
      process.stdout.write(id + "\n");
    });

  nlm
    .command("add <notebookId>")
    .description("Add a source to a notebook from a local file or URL")
    .option("--file <path>", "Local file path to upload")
    .option("--url <url>", "Remote URL to import")
    .action(async (notebookId: string, opts: { file?: string; url?: string }) => {
      if (!opts.file && !opts.url) {
        process.stderr.write("Must pass --file or --url\n");
        process.exit(1);
      }
      const args = ["source", "add", notebookId];
      if (opts.file) args.push("--file", opts.file);
      if (opts.url) args.push("--url", opts.url);
      const res = await runNlm(cfg(), args);
      process.stdout.write(res.stdout);
    });

  nlm
    .command("ask <notebookId> <question>")
    .description("Query a notebook and print the answer (or full JSON with --json)")
    .option("--json", "Print the full JSON response")
    .option("--raw", "Print raw stdout from nlm")
    .action(async (notebookId: string, question: string, opts: { json?: boolean; raw?: boolean }) => {
      const res = await runNlm(cfg(), ["notebook", "query", notebookId, question, "--json"]);
      if (opts.raw) {
        process.stdout.write(res.stdout);
        return;
      }
      const parsed = looseParseJson(res.stdout);
      if (opts.json) {
        process.stdout.write(JSON.stringify(parsed) + "\n");
        return;
      }
      const { answer } = unwrapQueryAnswer(parsed);
      process.stdout.write(answer + "\n");
    });

  nlm
    .command("list")
    .description("List notebooks (raw passthrough)")
    .action(async () => {
      const res = await runNlm(cfg(), ["notebook", "list", "--json"]);
      process.stdout.write(res.stdout);
    });
}
