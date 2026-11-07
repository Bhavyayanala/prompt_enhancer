#!/usr/bin/env node
/**
 * Terminal entry point. Reuses the exact same validation, LLM client and agent loop as the API.
 *
 *   node dist/cli.js "develop a cafe website"
 *   node dist/cli.js "develop a website for railway ticket booking" --style technical --verbose
 *   node dist/cli.js "add online food ordering" --previous plan.md
 */
import fs from "node:fs";
import { parseArgs } from "node:util";

const HELP = `Prompt Enhancer CLI

Usage:
  node dist/cli.js "<your website idea>" [options]

Options:
  -s, --style <short|detailed|technical>  Plan depth (default: detailed)
  -v, --verbose                           Print every agent step (tool, input, output)
  -p, --previous <file>                   Previous plan (Markdown file); the prompt becomes a change request
  -o, --out <file>                        Also write the enhanced plan to this file
      --json                              Print the full JSON response instead of text
      --debug                             Show backend log lines on stderr
  -h, --help                              Show this help
`;

const c = {
  bold: (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (process.stderr.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (process.stdout.isTTY ? `\x1b[36m${s}\x1b[0m` : s),
};

function short(value: unknown, max = 220): string {
  const s = JSON.stringify(value);
  return s.length > max ? s.slice(0, max) + `… (${s.length} chars)` : s;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        style: { type: "string", short: "s" },
        verbose: { type: "boolean", short: "v" },
        previous: { type: "string", short: "p" },
        out: { type: "string", short: "o" },
        json: { type: "boolean" },
        debug: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    console.error(c.red(`Error: ${(err as Error).message}`));
    console.error(HELP);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exit(values.help ? 0 : 2);
  }
  if (!values.debug) process.env.LOG_SILENT = "1";

  // Imported after LOG_SILENT is set so config/logging pick it up.
  const { runAgent } = await import("./agent/agent");
  const { getConfig } = await import("./lib/config");
  const { AppError } = await import("./lib/errors");
  const { createLlmClient } = await import("./llm/client");
  const { validateEnhanceInput } = await import("./routes/validate");

  try {
    const previousPlan = values.previous ? fs.readFileSync(values.previous, "utf8") : null;
    const input = validateEnhanceInput({ prompt: positionals.join(" "), style: values.style, previousPlan });
    const cfg = getConfig();
    const llm = createLlmClient(cfg);

    if (!values.json) {
      console.log(c.dim(`Enhancing with ${llm.provider} (${llm.model}), style=${input.style}${previousPlan ? ", mode=update" : ""} ...`));
    }

    const result = await runAgent(input, {
      llm,
      maxSteps: cfg.maxSteps,
      onStep: (s) => {
        if (!values.verbose || values.json) return;
        console.log(`${c.cyan(`[step ${s.step}]`)} ${c.bold(s.tool)} ${s.ok ? c.green("ok") : c.yellow("error")} ${c.dim(`${s.durationMs}ms`)}`);
        console.log(`  input:  ${short(s.input)}`);
        console.log(`  output: ${short(s.output)}`);
      },
    });

    if (values.out) fs.writeFileSync(values.out, result.enhanced + "\n");

    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const line = "─".repeat(72);
    console.log(`\n${line}\n${c.bold("ENHANCED PROMPT")}\n${line}\n`);
    console.log(result.enhanced);
    console.log(`\n${line}\n${c.bold("CLARIFYING QUESTIONS")}`);
    console.log(result.questions.length ? result.questions.map((q, i) => `  ${i + 1}. ${q}`).join("\n") : "  (none)");
    console.log(`\n${c.bold("ASSUMPTIONS")}`);
    console.log(result.assumptions.length ? result.assumptions.map((a) => `  - ${a}`).join("\n") : "  (none)");
    if (result.changes.length) {
      console.log(`\n${c.bold("CHANGES")}`);
      console.log(result.changes.map((x) => `  - ${x}`).join("\n"));
    }
    console.log(`\n${line}`);
    console.log(`${c.bold("SCORE")}  before ${result.score.before}/10  →  after ${c.green(String(result.score.after))}/10`);
    console.log(c.dim(`${result.steps.length} agent steps · ${result.meta.modelTurns} model turns · ${(result.meta.durationMs / 1000).toFixed(1)}s`));
    if (result.warning) console.log(c.yellow(`WARNING: ${result.warning}`));
  } catch (err) {
    if (err instanceof AppError) {
      console.error(c.red(`Error (${err.status}): ${err.message}`));
    } else if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      console.error(c.red(`Error: file not found: ${values.previous}`));
    } else {
      console.error(c.red(`Error: ${(err as Error)?.message ?? String(err)}`));
    }
    process.exit(1);
  }
}

main();
