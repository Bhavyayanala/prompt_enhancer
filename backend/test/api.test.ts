import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { AppError } from "../src/lib/errors";
import { GeminiClient } from "../src/llm/gemini";
import { call, fakeLlm, final, FINAL_GOOD, GOOD_PLAN } from "./fakeLlm";

const happy = () =>
  fakeLlm([
    () => call("analyze_prompt", { prompt: "develop a cafe website" }),
    () => call("get_template", { project_type: "cafe_restaurant" }),
    () => call("score_prompt", { plan: GOOD_PLAN }),
    () => final(FINAL_GOOD),
  ]);

const failing = (kind: ConstructorParameters<typeof AppError>[0]) =>
  fakeLlm([
    () => {
      throw new AppError(kind, `simulated ${kind}`);
    },
  ]);

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await request(createApp(happy)).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /api/enhance", () => {
  const app = createApp(happy);

  it("returns the enhanced plan, lists, score and steps", async () => {
    const res = await request(app).post("/api/enhance").send({ prompt: "develop a cafe website", style: "detailed", previousPlan: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ original: "develop a cafe website", warning: null, score: { after: 10 } });
    expect(res.body.steps).toHaveLength(3);
    expect(res.body.steps[0]).toMatchObject({ step: 1, tool: "analyze_prompt" });
    expect(Array.isArray(res.body.questions)).toBe(true);
    expect(Array.isArray(res.body.assumptions)).toBe(true);
  });

  it.each([
    [{}, /required/],
    [{ prompt: "" }, /empty/],
    [{ prompt: "   " }, /empty/],
    [{ prompt: 42 }, /string/],
    [{ prompt: "x".repeat(2001) }, /2000/],
    [{ prompt: "ok", style: "fancy" }, /style/],
    [{ prompt: "ok", previousPlan: 5 }, /previousPlan/],
  ])("400 for invalid body %#", async (body, msg) => {
    const res = await request(app).post("/api/enhance").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msg);
  });

  it("400 for malformed JSON, without crashing", async () => {
    const res = await request(app).post("/api/enhance").set("content-type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid JSON/);
    expect((await request(app).get("/api/health")).status).toBe(200);
  });

  it.each([
    ["config", 500],
    ["rate_limit", 429],
    ["upstream", 502],
    ["timeout", 504],
  ] as const)("maps %s errors to %i", async (kind, status) => {
    const res = await request(createApp(() => failing(kind))).post("/api/enhance").send({ prompt: "cafe" });
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(/simulated/);
  });

  it("500 with a clear message when the key is missing", async () => {
    const prev = { p: process.env.LLM_PROVIDER, k: process.env.GEMINI_API_KEY };
    process.env.LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "";
    const res = await request(createApp()).post("/api/enhance").send({ prompt: "cafe" });
    process.env.LLM_PROVIDER = prev.p;
    process.env.GEMINI_API_KEY = prev.k;
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/GEMINI_API_KEY is not set/);
  });
});

describe("Gemini client error mapping (fetch mocked)", () => {
  const KEY = "test-key-not-a-real-key-123456";
  afterEach(() => vi.unstubAllGlobals());

  const geminiApp = () => createApp(() => new GeminiClient(KEY, "gemini-2.5-flash", 200));

  it("invalid key -> 500 and the key never appears in the response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: `API key not valid: ${KEY}` } }), { status: 400 })));
    const res = await request(geminiApp()).post("/api/enhance").send({ prompt: "cafe" });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/missing or invalid/);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it("429 -> 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    expect((await request(geminiApp()).post("/api/enhance").send({ prompt: "cafe" })).status).toBe(429);
  });

  it("503 -> 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect((await request(geminiApp()).post("/api/enhance").send({ prompt: "cafe" })).status).toBe(502);
  });

  it("slow provider -> 504", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(init.signal!.reason))),
      ),
    );
    const res = await request(geminiApp()).post("/api/enhance").send({ prompt: "cafe" });
    expect(res.status).toBe(504);
  });

  it("sends tools as native function declarations and the key in a header", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: FINAL_GOOD }] } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await request(geminiApp()).post("/api/enhance").send({ prompt: "cafe" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(String(init.body));
    expect(body.tools[0].functionDeclarations.map((f: any) => f.name)).toEqual(["analyze_prompt", "get_template", "score_prompt"]);
  });
});
