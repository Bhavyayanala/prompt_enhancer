import { describe, expect, it } from "vitest";
import { parseFinalAnswer, runAgent } from "../src/agent/agent";
import { AppError } from "../src/lib/errors";
import { call, fakeLlm, final, FINAL_GOOD, GOOD_PLAN, WEAK_PLAN } from "./fakeLlm";

const input = { prompt: "develop a cafe website" };

describe("agent loop", () => {
  it("runs analyze -> template -> score -> final and logs every step", async () => {
    const llm = fakeLlm([
      () => call("analyze_prompt", { prompt: "develop a cafe website" }),
      () => call("get_template", { project_type: "cafe_restaurant" }),
      () => call("score_prompt", { plan: GOOD_PLAN }),
      () => final(FINAL_GOOD),
    ]);
    const r = await runAgent(input, { llm });
    expect(r.steps.map((s) => s.tool)).toEqual(["analyze_prompt", "get_template", "score_prompt"]);
    expect(r.steps.every((s) => s.ok)).toBe(true);
    expect(r.enhanced).toContain("## 12. Validation");
    expect(r.questions).toEqual(["Is online ordering needed?"]);
    expect(r.assumptions).toEqual(["A-1: Single location"]);
    expect(r.score.after).toBe(10);
    expect(r.score.before).toBeLessThan(r.score.after);
    expect(r.warning).toBeNull();
  });

  it("improves and re-scores when the first score is below 7", async () => {
    const llm = fakeLlm([
      () => call("analyze_prompt", { prompt: "x" }),
      () => call("get_template", { project_type: "cafe_restaurant" }),
      () => call("score_prompt", { plan: WEAK_PLAN }),
      (res) => {
        expect((res[0].result as any).score).toBeLessThan(7);
        return call("score_prompt", { plan: GOOD_PLAN });
      },
      () => final(FINAL_GOOD),
    ]);
    const r = await runAgent(input, { llm });
    expect(r.steps.filter((s) => s.tool === "score_prompt")).toHaveLength(2);
    expect(r.score.after).toBe(10);
  });

  it("sends an error back for an unknown tool and lets the model recover", async () => {
    const llm = fakeLlm([
      () => call("analyze_prompt", { prompt: "x" }),
      () => call("delete_database", {}),
      (res) => {
        expect((res[0].result as any).error).toMatch(/Unknown tool "delete_database"/);
        return call("score_prompt", { plan: GOOD_PLAN });
      },
      () => final(FINAL_GOOD),
    ]);
    const r = await runAgent(input, { llm });
    expect(r.steps[1]).toMatchObject({ tool: "delete_database", ok: false });
    expect(r.enhanced).toContain("## 1. Intent");
  });

  it("sends an error back for bad or missing arguments", async () => {
    const llm = fakeLlm([
      () => call("analyze_prompt", { prompt: "x" }),
      () => call("get_template", { project_type: "spaceship" }),
      (res) => {
        expect((res[0].result as any).error).toMatch(/project_type must be one of/);
        return call("score_prompt", {});
      },
      (res) => {
        expect((res[0].result as any).error).toMatch(/plan/);
        return call("score_prompt", { plan: GOOD_PLAN });
      },
      () => final(FINAL_GOOD),
    ]);
    const r = await runAgent(input, { llm });
    expect(r.steps.map((s) => s.ok)).toEqual([true, false, false, true]);
    expect(r.warning).toBeNull();
  });

  it("handles unparseable JSON arguments from the provider", async () => {
    const llm = fakeLlm([
      () => ({ text: "", toolCalls: [{ id: "1", name: "analyze_prompt", args: undefined, argsError: "Arguments were not valid JSON." }] }),
      (res) => {
        expect((res[0].result as any).error).toMatch(/not valid JSON/);
        return call("analyze_prompt", { prompt: "x" });
      },
      () => call("score_prompt", { plan: GOOD_PLAN }),
      () => final(FINAL_GOOD),
    ]);
    const r = await runAgent(input, { llm });
    expect(r.steps[0].ok).toBe(false);
    expect(r.score.after).toBe(10);
  });

  it("requires analyze_prompt first", async () => {
    const llm = fakeLlm([
      () => call("get_template", { project_type: "cafe_restaurant" }),
      (res) => {
        expect((res[0].result as any).error).toMatch(/analyze_prompt must be called first/);
        return call("analyze_prompt", { prompt: "x" });
      },
      () => call("score_prompt", { plan: GOOD_PLAN }),
      () => final(FINAL_GOOD),
    ]);
    const r = await runAgent(input, { llm });
    expect(r.steps[0].ok).toBe(false);
  });

  it("stops at 5 steps, returns the best draft and sets the warning", async () => {
    const llm = fakeLlm([
      () => call("analyze_prompt", { prompt: "x" }),
      () => call("score_prompt", { plan: WEAK_PLAN }),
      () => call("score_prompt", { plan: GOOD_PLAN }),
      () => call("score_prompt", { plan: WEAK_PLAN }),
      () => call("score_prompt", { plan: WEAK_PLAN }),
      () => call("score_prompt", { plan: WEAK_PLAN }), // 6th tool call: over the limit
    ]);
    const r = await runAgent(input, { llm, maxSteps: 5 });
    expect(r.steps).toHaveLength(5);
    expect(r.warning).toBe("step limit reached");
    expect(r.enhanced).toBe(GOOD_PLAN);
    expect(r.questions).toEqual(["Is online ordering needed?"]);
  });

  it("asks the model to score once if it tries to finish without score_prompt", async () => {
    const llm = fakeLlm([
      () => call("analyze_prompt", { prompt: "x" }),
      () => final(FINAL_GOOD),
      () => call("score_prompt", { plan: GOOD_PLAN }),
      () => final(FINAL_GOOD),
    ]);
    const r = await runAgent(input, { llm });
    expect(r.steps.map((s) => s.tool)).toEqual(["analyze_prompt", "score_prompt"]);
  });

  it("propagates provider errors when no draft exists yet", async () => {
    const llm = fakeLlm([
      () => {
        throw new AppError("rate_limit", "rate limited");
      },
    ]);
    await expect(runAgent(input, { llm })).rejects.toMatchObject({ status: 429 });
  });

  it("returns the best draft with a warning if the provider fails after a scored draft", async () => {
    const llm = fakeLlm([
      () => call("analyze_prompt", { prompt: "x" }),
      () => call("score_prompt", { plan: GOOD_PLAN }),
      () => {
        throw new AppError("upstream", "boom");
      },
    ]);
    const r = await runAgent(input, { llm });
    expect(r.enhanced).toBe(GOOD_PLAN);
    expect(r.warning).toMatch(/AI provider error/);
  });
});

describe("parseFinalAnswer", () => {
  it("parses tagged blocks and drops 'None'", () => {
    const p = parseFinalAnswer(FINAL_GOOD);
    expect(p.plan.startsWith("## 1. Intent")).toBe(true);
    expect(p.changes).toEqual([]);
  });
  it("falls back to section 3 when tags are missing", () => {
    const p = parseFinalAnswer("Here you go:\n" + GOOD_PLAN);
    expect(p.plan.startsWith("## 1. Intent")).toBe(true);
    expect(p.questions).toEqual(["Is online ordering needed?"]);
    expect(p.assumptions).toEqual(["A-1: Single location"]);
  });
});
