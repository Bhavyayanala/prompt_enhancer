import { AppError, redact } from "../lib/errors";
import { logger } from "../lib/logger";
import type { LlmClient, ModelTurn, ToolCall, ToolResult } from "../llm/types";
import { buildSystemPrompt, buildUserMessage, type PlanStyle } from "./systemPrompt";
import { scoreOriginalPrompt, scorePrompt, splitSections, TOOL_NAMES, TOOLS, type ToolContext } from "./tools";

export interface EnhanceInput {
  prompt: string;
  style?: PlanStyle;
  previousPlan?: string | null;
}

export interface StepLog {
  step: number;
  tool: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  durationMs: number;
}

export interface EnhanceResult {
  original: string;
  enhanced: string;
  questions: string[];
  assumptions: string[];
  changes: string[];
  score: { before: number; after: number };
  steps: StepLog[];
  warning: string | null;
  meta: { provider: string; model: string; style: PlanStyle; mode: "new" | "update"; modelTurns: number; durationMs: number };
}

export interface AgentOptions {
  llm: LlmClient;
  /** Maximum tool calls per run (the brief requires 5). */
  maxSteps?: number;
  /** Called after every tool call, used by the CLI --verbose flag. */
  onStep?: (step: StepLog) => void;
}

const STEP_LIMIT_WARNING = "step limit reached";

/**
 * The enhancer agent loop:
 *  1. send the prompt + tool definitions to the model
 *  2. if the model asks for a tool, run it and send the result back
 *  3. repeat until the model gives a final answer or the step limit is reached
 *  4. return the final plan plus the full step log
 * Shared by the HTTP route and the CLI.
 */
export async function runAgent(input: EnhanceInput, opts: AgentOptions): Promise<EnhanceResult> {
  const started = Date.now();
  const style: PlanStyle = input.style ?? "detailed";
  const previousPlan = input.previousPlan?.trim() ? input.previousPlan.trim() : null;
  const maxSteps = opts.maxSteps ?? 5;
  const ctx: ToolContext = { hasPreviousPlan: !!previousPlan };

  const steps: StepLog[] = [];
  const drafts: { plan: string; score: number }[] = [];
  let warning: string | null = null;
  let modelTurns = 0;
  let nudged = false;

  const chat = opts.llm.startChat({
    system: buildSystemPrompt(style, maxSteps),
    tools: TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters })),
  });

  const bestDraft = () => drafts.reduce<(typeof drafts)[number] | null>((b, d) => (!b || d.score >= b.score ? d : b), null);

  const finish = (finalText: string | null, warn: string | null): EnhanceResult => {
    let parsed = finalText ? parseFinalAnswer(finalText) : null;
    const best = bestDraft();
    // If the final text is not a usable plan, fall back to the best scored draft.
    if (!parsed || splitSections(parsed.plan).length < 6) {
      if (best) {
        parsed = { ...fromSection3(best.plan), plan: best.plan, changes: [] };
        if (!warn && finalText) warn = "final answer was not a valid plan; returned the best scored draft";
      } else if (!parsed) {
        throw new AppError("upstream", "The AI model finished without producing a plan. Please try again.");
      }
    }
    const after = scorePrompt({ plan: parsed.plan }).score;
    const result: EnhanceResult = {
      original: input.prompt,
      enhanced: parsed.plan,
      questions: parsed.questions,
      assumptions: parsed.assumptions,
      changes: parsed.changes,
      score: { before: scoreOriginalPrompt(input.prompt), after },
      steps,
      warning: warn,
      meta: { provider: opts.llm.provider, model: opts.llm.model, style, mode: previousPlan ? "update" : "new", modelTurns, durationMs: Date.now() - started },
    };
    logger.info("agent finished", { steps: steps.length, after, warning: warn, durationMs: result.meta.durationMs });
    return result;
  };

  const ask = async (fn: () => Promise<ModelTurn>): Promise<ModelTurn> => {
    modelTurns++;
    return fn();
  };

  let turn: ModelTurn;
  turn = await ask(() => chat.send(buildUserMessage(input.prompt, previousPlan)));

  // Hard guard on model turns as well, so a model that never calls a tool and never finishes cannot loop forever.
  const maxTurns = maxSteps + 4;

  while (true) {
    if (turn.toolCalls.length === 0) {
      // Enforce "score_prompt before finishing" once, while there is budget left.
      const scored = steps.some((s) => s.tool === "score_prompt" && s.ok);
      if (!scored && !nudged && steps.length < maxSteps && modelTurns < maxTurns) {
        nudged = true;
        logger.warn("model tried to finish without score_prompt; asking it to score first");
        const retry = await safeAsk(() =>
          chat.send(
            "You have not called score_prompt yet. Call score_prompt with your full draft plan now, then give the final answer in the required format.",
          ),
        );
        if (!retry) return finish(turn.text, warning ?? "AI provider failed after a draft was written");
        turn = retry;
        continue;
      }
      return finish(turn.text, warning);
    }

    const results: ToolResult[] = [];
    let limitHit = false;
    for (const call of turn.toolCalls) {
      if (steps.length >= maxSteps) {
        limitHit = true;
        break;
      }
      const log = executeTool(call, steps.length + 1, ctx, steps);
      steps.push(log);
      opts.onStep?.(log);
      if (log.ok && call.name === "score_prompt") {
        drafts.push({ plan: String((call.args as any).plan), score: (log.output as any).score });
      }
      results.push({ id: call.id, name: call.name, result: log.output });
    }

    if (limitHit || modelTurns >= maxTurns) {
      logger.warn(STEP_LIMIT_WARNING, { steps: steps.length, modelTurns });
      return finish(null, STEP_LIMIT_WARNING);
    }

    const next = await safeAsk(() => chat.sendToolResults(results));
    if (!next) return finish(null, warning ?? "AI provider failed after a draft was written");
    turn = next;
  }

  /** Model call that, once a draft exists, degrades to "return best draft" instead of failing the run. */
  async function safeAsk(fn: () => Promise<ModelTurn>): Promise<ModelTurn | null> {
    try {
      return await ask(fn);
    } catch (err) {
      if (drafts.length === 0) throw err;
      warning = `AI provider error after a draft was scored (${err instanceof AppError ? err.message : "unknown error"}); returned the best draft`;
      logger.warn("model call failed after draft", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}

/** Runs one tool call safely. Unknown tools, bad arguments and tool crashes become error results for the model. */
function executeTool(call: ToolCall, stepNo: number, ctx: ToolContext, previous: StepLog[]): StepLog {
  const t0 = Date.now();
  const done = (output: unknown, ok: boolean): StepLog => {
    const log: StepLog = { step: stepNo, tool: call.name || "(missing name)", input: call.args ?? null, output, ok, durationMs: Date.now() - t0 };
    logger.info("agent step", {
      step: stepNo,
      tool: log.tool,
      ok,
      input: redact(JSON.stringify(log.input ?? null)).slice(0, 200),
      output: redact(JSON.stringify(output ?? null)).slice(0, 300),
    });
    return log;
  };

  const tool = TOOLS.find((t) => t.name === call.name);
  if (!tool) {
    return done({ error: `Unknown tool "${call.name}". Available tools: ${TOOL_NAMES.join(", ")}.` }, false);
  }
  if (call.argsError) {
    return done({ error: `Invalid arguments for ${call.name}: ${call.argsError}` }, false);
  }
  // Order rule from the brief: analyze_prompt must come first.
  if (call.name !== "analyze_prompt" && !previous.some((s) => s.tool === "analyze_prompt" && s.ok)) {
    return done({ error: "analyze_prompt must be called first. Call analyze_prompt with the user's prompt." }, false);
  }
  const parsed = tool.schema.safeParse(call.args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");
    return done({ error: `Invalid arguments for ${call.name}: ${issues}` }, false);
  }
  try {
    return done(tool.run(parsed.data, ctx), true);
  } catch (err) {
    logger.error("tool threw", { tool: call.name, error: err instanceof Error ? err.message : String(err) });
    return done({ error: `Tool ${call.name} failed: ${err instanceof Error ? err.message : "unknown error"}` }, false);
  }
}

// ---------------------------------------------------------------------------
// Final answer parsing
// ---------------------------------------------------------------------------

function block(text: string, tag: string): string | null {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|$)`, "i"));
  return m ? m[1].trim() : null;
}

function listItems(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "").trim())
    .filter((l) => l && !/^(none|n\/a|-)\.?$/i.test(l));
}

/** Questions / assumptions recovered from section 3 when the model did not send separate blocks. */
function fromSection3(plan: string): { questions: string[]; assumptions: string[] } {
  const s3 = splitSections(plan).find((s) => s.index === 2)?.body ?? "";
  const items = listItems(s3).filter((l) => !/^\*\*.*\*\*$/.test(l));
  return {
    questions: items.filter((l) => l.endsWith("?")),
    assumptions: items.filter((l) => !l.endsWith("?") && /\bA-\d+|assum/i.test(l)),
  };
}

export function parseFinalAnswer(raw: string): { plan: string; questions: string[]; assumptions: string[]; changes: string[] } {
  const text = raw.replace(/^```[a-z]*\n?|```\s*$/gim, "").trim();
  let plan = block(text, "plan");
  if (!plan) {
    // No tags: take everything from the first section heading up to any trailing block.
    const start = text.search(/^#{1,4}\s*1[.)]?\s*Intent/im);
    plan = (start >= 0 ? text.slice(start) : text).split(/<questions>|<assumptions>|<changes>/i)[0].trim();
  }
  const fallback = fromSection3(plan);
  const q = block(text, "questions");
  const a = block(text, "assumptions");
  return {
    plan,
    questions: q !== null ? listItems(q) : fallback.questions,
    assumptions: a !== null ? listItems(a) : fallback.assumptions,
    changes: listItems(block(text, "changes")),
  };
}
