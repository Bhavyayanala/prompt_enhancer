import { describe, expect, it } from "vitest";
import { analyzePrompt, getTemplate, getTemplateArgs, scoreOriginalPrompt, scorePrompt } from "../src/agent/tools";
import { GOOD_PLAN, WEAK_PLAN } from "./fakeLlm";

describe("analyze_prompt", () => {
  it("detects project types", () => {
    const ctx = { hasPreviousPlan: false };
    expect(analyzePrompt({ prompt: "develop a cafe website" }, ctx).project_type).toBe("cafe_restaurant");
    expect(analyzePrompt({ prompt: "develop a website for railway ticket booking" }, ctx).project_type).toBe("booking");
    expect(analyzePrompt({ prompt: "online store to sell shoes" }, ctx).project_type).toBe("ecommerce");
    expect(analyzePrompt({ prompt: "my developer portfolio" }, ctx).project_type).toBe("portfolio");
    expect(analyzePrompt({ prompt: "a site about astronomy" }, ctx).project_type).toBe("other");
  });

  it("reports present and missing inputs and the request kind", () => {
    const r = analyzePrompt({ prompt: "cafe website with login and stripe payment for students, built in react" }, { hasPreviousPlan: false });
    expect(r.present).toEqual(expect.arrayContaining(["login", "payment", "tech_stack", "target_users"]));
    expect(r.missing).toContain("design_style");
    expect(r.request_kind).toBe("new_build");
    expect(analyzePrompt({ prompt: "add online food ordering" }, { hasPreviousPlan: false }).request_kind).toBe("change_to_existing");
    expect(analyzePrompt({ prompt: "cafe" }, { hasPreviousPlan: true }).request_kind).toBe("change_to_existing");
  });
});

describe("get_template", () => {
  it("returns 12 sections and domain entities", () => {
    const t = getTemplate({ project_type: "booking" });
    expect(t.sections).toHaveLength(12);
    expect(t.typical_entities).toEqual(expect.arrayContaining(["Booking", "Seat", "Payment"]));
  });
  it("rejects unknown project types", () => {
    expect(getTemplateArgs.safeParse({ project_type: "spaceship" }).success).toBe(false);
  });
});

describe("score_prompt", () => {
  it("gives a full score to a plan that meets every rule", () => {
    expect(scorePrompt({ plan: GOOD_PLAN }).score).toBe(10);
  });
  it("gives a low score with feedback to a weak plan", () => {
    const r = scorePrompt({ plan: WEAK_PLAN });
    expect(r.score).toBeLessThan(7);
    expect(r.passed).toBe(false);
    expect(r.feedback.join(" ")).toMatch(/missing sections/i);
  });
  it("rates a raw one-line idea low", () => {
    expect(scoreOriginalPrompt("develop a cafe website")).toBeLessThanOrEqual(3);
  });
});
