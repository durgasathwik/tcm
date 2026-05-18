import type { Command } from "commander";
import { defaultConfig, runNlmPassthrough } from "../nlm-runner.js";

export interface CliContext {
  config: Record<string, unknown> | undefined;
}

export function registerTcmNlmCli(program: Command, ctx: CliContext): void {
  // Ensure the shared "tcm" root exists. Another plugin may have created it; reuse if so.
  let root = program.commands.find((c) => c.name() === "tcm");
  if (!root) {
    root = program.command("tcm").description("TCM study toolkit commands");
  }

  const cfg = () => defaultConfig(ctx.config);

  // Transparent passthrough: `openclaw tcm nlm <anything...>` spawns
  // `nlm <anything...>` and forwards every token verbatim — subcommands,
  // flags, positional args — streaming stdio and propagating the exit code.
  //
  // The variadic `[args...]` collects every remaining token. allowUnknownOption
  // stops commander from rejecting nlm's own flags; allowExcessArguments stops
  // it from rejecting extra positionals; helpOption(false) keeps `--help` from
  // being intercepted so nlm shows its own help. passThroughOptions is NOT used
  // — it requires enablePositionalOptions on parent commands we don't own.
  // The same action handles the no-args case: an empty argv is forwarded so the
  // user sees nlm's own top-level help, not commander's.
  root
    .command("nlm [args...]")
    .description("NotebookLM CLI (full passthrough to the `nlm` binary)")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (args: string[]) => {
      const code = await runNlmPassthrough(cfg(), args ?? []);
      process.exit(code);
    });
}
