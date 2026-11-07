import type { ChatSession, LlmClient, ModelTurn, ToolResult } from "../src/llm/types";

/** A scripted model: each entry decides the next turn from the tool results it just received. */
export type Script = Array<(results: ToolResult[]) => ModelTurn | Promise<ModelTurn>>;

export function fakeLlm(script: Script): LlmClient & { received: ToolResult[][] } {
  const received: ToolResult[][] = [];
  return {
    provider: "fake",
    model: "fake-1",
    received,
    startChat(): ChatSession {
      let i = 0;
      const next = async (results: ToolResult[]) => {
        received.push(results);
        const fn = script[Math.min(i++, script.length - 1)];
        return fn(results);
      };
      return { send: async () => next([]), sendToolResults: async (r) => next(r) };
    },
  };
}

export const call = (name: string, args: unknown, id = `c_${Math.random().toString(36).slice(2, 8)}`): ModelTurn => ({
  text: "",
  toolCalls: [{ id, name, args }],
});
export const final = (text: string): ModelTurn => ({ text, toolCalls: [] });

export const GOOD_PLAN = `## 1. Intent
- Cafe site
## 2. Requirements
- FR-1: Menu page [Confirmed]
- FR-2: Reservations [Assumed]
- NFR-1: Fast [Assumed]
## 3. Ambiguities and questions
- Is online ordering needed?
- A-1: Single location
## 4. Scope
**MVP**
- Menu
**Optional**
- Reviews
**Future enhancements**
- App
## 5. Users and journeys
- Customer
## 6. Architecture
- React + Express
## 7. Technology
- React: popular
## 8. Database plan
- MenuItem
## 9. UI/UX plan
- Home
## 10. Task breakdown
- T1: Setup. Depends on: none
- T2: Menu API. Depends on: T1
- T3: Menu page. Depends on: T2
## 11. Risks
- XSS
## 12. Validation
**Acceptance criteria**
- Menu loads
- Reservation is saved`;

export const WEAK_PLAN = `## 1. Intent
- Cafe site
## 2. Requirements
- Menu page
- Reservations
## 4. Scope
- Menu`;

export const FINAL_GOOD = `<plan>\n${GOOD_PLAN}\n</plan>\n<questions>\n- Is online ordering needed?\n</questions>\n<assumptions>\n- A-1: Single location\n</assumptions>\n<changes>\n- None\n</changes>`;
