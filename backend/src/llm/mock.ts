import type { ChatSession, LlmClient, ModelTurn, ToolResult, ToolSpec } from "./types";

/**
 * Offline demo provider (LLM_PROVIDER=mock).
 *
 * It is NOT an AI model. It is a scripted stand-in that drives the real agent loop through the
 * same tool-calling path as Gemini/Groq (analyze_prompt -> get_template -> score_prompt -> final),
 * so the app, the CLI, Docker and the tests can be exercised without an API key.
 * Plans it writes are assembled from the get_template output, so they are generic.
 */
export class MockClient implements LlmClient {
  readonly provider = "mock";
  readonly model = "scripted-demo";

  startChat(_opts: { system: string; tools: ToolSpec[] }): ChatSession {
    let idea = "";
    let previousPlan: string | null = null;
    let analysis: any = null;
    let template: any = null;
    let draft = "";
    let n = 0;
    const id = () => `mock_${++n}`;

    return {
      send: async (userText: string): Promise<ModelTurn> => {
        const blocks = [...userText.matchAll(/"""\n([\s\S]*?)\n"""/g)].map((m) => m[1]);
        idea = blocks[0] ?? userText;
        previousPlan = blocks[1] ?? null;
        return { text: "", toolCalls: [{ id: id(), name: "analyze_prompt", args: { prompt: idea } }] };
      },
      sendToolResults: async (results: ToolResult[]): Promise<ModelTurn> => {
        const r = results[0];
        const out: any = r.result;
        if (out && typeof out === "object" && "error" in out) {
          return { text: "", toolCalls: [] };
        }
        if (r.name === "analyze_prompt") {
          analysis = out;
          return { text: "", toolCalls: [{ id: id(), name: "get_template", args: { project_type: out.project_type } }] };
        }
        if (r.name === "get_template") {
          template = out;
          draft = previousPlan ? applyChange(previousPlan, idea) : buildPlan(idea, analysis, template);
          return { text: "", toolCalls: [{ id: id(), name: "score_prompt", args: { plan: draft } }] };
        }
        // score_prompt -> final answer
        const questions = previousPlan ? ["None"] : (template?.blocking_question_hints ?? []).slice(0, 2);
        const assumptions = previousPlan ? ["A-x: Existing plan decisions stay unchanged."] : assumptionsFor(analysis);
        const changes = previousPlan
          ? [`Added requirement, scope item, task and acceptance criterion for: "${idea}"`]
          : ["None"];
        return {
          text: `<plan>\n${draft}\n</plan>\n<questions>\n${questions.map((q: string) => `- ${q}`).join("\n")}\n</questions>\n<assumptions>\n${assumptions.map((a) => `- ${a}`).join("\n")}\n</assumptions>\n<changes>\n${changes.map((c) => `- ${c}`).join("\n")}\n</changes>`,
          toolCalls: [],
        };
      },
    };
  }
}

const ASSUMPTION_TEXT: Record<string, string> = {
  purpose: "The site's goal is to attract customers and let them complete the main action online.",
  target_users: "Target users are local customers on mobile and desktop.",
  pages_features: "Pages follow the typical set for this kind of site (see section 9).",
  design_style: "Clean, modern, accessible design with the business's brand colours.",
  tech_stack: "React + Node.js/Express + PostgreSQL (see section 7).",
  constraints: "Small team, MVP in about 4 weeks, single country and language.",
  login: "Customers can browse without an account; login is only needed for personal features.",
  payment: "No online payment in the MVP unless the answer to question 2 says otherwise.",
};

function assumptionsFor(analysis: any): string[] {
  const missing: string[] = analysis?.missing ?? [];
  return missing.map((m, i) => `A-${i + 1}: ${ASSUMPTION_TEXT[m] ?? m}`);
}

function buildPlan(idea: string, a: any, t: any): string {
  const roles: string[] = t.typical_roles;
  const entities: string[] = t.typical_entities;
  const pages: string[] = t.typical_pages;
  const implicit: string[] = t.implicit_requirements;
  const label: string = t.label;
  const tag = (key: string) => (a.present.includes(key) ? "[Confirmed]" : "[Assumed]");
  const assumptions = assumptionsFor(a);

  const tasks = [
    "Set up the repository, React frontend, Express API, PostgreSQL and CI. Depends on: none",
    `Create the database schema and migrations for ${entities.slice(0, 5).join(", ")}. Depends on: T1`,
    "Build authentication and role-based access for Admin. Depends on: T1, T2",
    `Build the public pages: ${pages.slice(0, 4).join(", ")}. Depends on: T1`,
    `Build the core flow on ${pages.slice(1, 4).join(" -> ")} with API endpoints. Depends on: T2, T4`,
    "Build the admin screens to manage content and records. Depends on: T3, T5",
    "Add validation, loading, empty and error states on every page. Depends on: T4, T5, T6",
    "Write unit, integration and end-to-end tests for the MVP flows. Depends on: T5, T6",
    "Deploy frontend and backend with environment configuration. Depends on: T7, T8",
  ];

  return `## 1. Intent
- **Product intent:** ${label} based on the idea "${idea}".
- **Primary objective:** let ${roles[1] ?? roles[0]} complete the main action online with minimum friction.
- **Business intent:** bring in more customers and reduce manual work for the ${roles[roles.length - 1]}.
- **Functional intent:** public information pages, the core ${a.project_type.replace("_", " ")} flow, and an admin area.
- **Technical intent:** a responsive web app with a REST API and a relational database.
- **Classification:** ${a.request_kind === "new_build" ? "New build" : "Modification"}; domain: ${a.project_type}; size: small (MVP in about 4 weeks).

## 2. Requirements
**Functional**
- FR-1: Visitors can view ${pages.slice(0, 3).join(", ")}. ${tag("pages_features")}
- FR-2: ${roles[1] ?? "Users"} can complete the core flow (${pages.slice(1, 4).join(" -> ")}). [Assumed]
- FR-3: ${roles[roles.length - 1]} can create, edit and delete ${entities.slice(0, 2).join(" and ")} records. [Assumed]
- FR-4: Login/registration for personal features. ${tag("login")}
- FR-5: Online payment handling. ${tag("payment")}
**Non-functional**
- NFR-1: Pages load in under 2 seconds on 4G (Lighthouse performance >= 85). [Assumed]
- NFR-2: HTTPS everywhere, hashed passwords, input validation on the server. [Assumed]
- NFR-3: WCAG 2.1 AA accessibility (contrast, keyboard navigation, alt text). [Assumed]
- NFR-4: Responsive from 360px phones to 1440px desktops. [Assumed]
**Implicit**
${implicit.map((r, i) => `- IR-${i + 1}: ${r}. [Assumed]`).join("\n")}

## 3. Ambiguities and questions
**Blocking questions**
${(t.blocking_question_hints as string[]).slice(0, 2).map((q, i) => `${i + 1}. ${q}`).join("\n")}
**Assumptions (non-blocking gaps)**
${assumptions.length ? assumptions.map((x) => `- ${x}`).join("\n") : "- None"}

## 4. Scope
**MVP**
- ${pages.slice(0, 4).join(", ")}
- Core flow for ${roles[1] ?? roles[0]} and admin management of ${entities.slice(0, 2).join(" and ")}
**Optional**
- Email notifications, reviews/ratings, analytics dashboard
**Future enhancements**
- Mobile app, loyalty programme, multi-language, multiple locations

## 5. Users and journeys
${roles.map((r) => `- **${r}**: ${r.startsWith("Admin") ? "full access to the admin area" : r.startsWith("Guest") || r.startsWith("Visitor") ? "read-only access to public pages" : "own data only"}.`).join("\n")}
- **Main journey (${roles[1] ?? roles[0]}):** ${pages.slice(0, 4).join(" -> ")} -> confirmation.
- **Admin journey:** login -> admin dashboard -> manage ${entities.slice(0, 2).join("/")} -> publish.

## 6. Architecture
- **Frontend:** React SPA, calls the backend over HTTPS/JSON.
- **Backend:** Node.js + Express REST API, JWT auth, validation layer.
- **Database:** PostgreSQL accessed through an ORM.
- **Integrations:** email provider${a.present.includes("payment") ? ", payment gateway" : ""}, maps.
- **Flow:** Browser -> React -> Express API -> PostgreSQL; admin uses the same API with an Admin role.

## 7. Technology
- React + Vite: fast, widely known, component based.
- Node.js + Express: simple REST API in the same language as the frontend.
- PostgreSQL: relational data with constraints and transactions.
- Prisma ORM: typed schema and migrations.
- Tailwind CSS: quick, consistent responsive styling.

## 8. Database plan
${entities.map((e) => `- **${e}**: id (PK), created_at, updated_at, plus domain fields.`).join("\n")}
- **Relationships:** ${entities[0]} 1-N ${entities[1]}; ${entities[2] ?? entities[1]} N-1 ${entities[entities.length - 1]}.
- **Constraints:** unique emails, NOT NULL on required fields, foreign keys with ON DELETE RESTRICT, CHECK price >= 0.

## 9. UI/UX plan
${pages.map((p) => `- **${p}**: header/navigation, main content, footer; clear primary action.`).join("\n")}
- **Behaviour:** mobile-first, skeleton loaders, friendly empty states, inline form validation, error toasts, keyboard accessible.

## 10. Task breakdown
${tasks.map((x, i) => `- T${i + 1}: ${x}`).join("\n")}

## 11. Risks
- Security: injection and XSS. Mitigation: parameterised queries, output escaping, validation.
- Auth: weak passwords or stolen tokens. Mitigation: bcrypt, short-lived JWT, rate-limited login.
- Edge case: concurrent updates to the same record. Mitigation: transactions and optimistic locking.
- Failure: third-party integration down. Mitigation: retries, clear error message, admin alert.

## 12. Validation
**Acceptance criteria**
- Given a visitor on a phone, when they open Home, then the page loads in under 2 seconds and is readable.
- Given a ${roles[1] ?? "user"}, when they complete the core flow, then they see a confirmation.
- Given an Admin, when they edit a ${entities[1] ?? entities[0]}, then the change is visible on the public site.
**Testing requirements**
- Unit tests for services and validation, integration tests for every API endpoint, end-to-end tests for the MVP journeys.`;
}

/** Minimal "preserve and extend" update used by the demo provider for change requests. */
function applyChange(plan: string, change: string): string {
  const insertAfterSection = (text: string, sectionNo: number, line: string) => {
    const next = new RegExp(`^##\\s*${sectionNo + 1}\\.`, "m");
    const m = text.match(next);
    if (!m || m.index === undefined) return text.trimEnd() + "\n" + line + "\n";
    return text.slice(0, m.index).trimEnd() + "\n" + line + "\n\n" + text.slice(m.index);
  };
  const maxFr = Math.max(0, ...[...plan.matchAll(/FR-(\d+)/g)].map((m) => Number(m[1])));
  const maxT = Math.max(0, ...[...plan.matchAll(/\bT(\d+)\b/g)].map((m) => Number(m[1])));
  let out = plan;
  out = insertAfterSection(out, 2, `- FR-${maxFr + 1}: ${change} [Confirmed]`);
  out = out.replace(/(\*\*MVP\*\*\n)/, `$1- ${change}\n`);
  out = insertAfterSection(out, 10, `- T${maxT + 1}: Implement "${change}" end to end (API, UI, tests). Depends on: T${Math.max(1, maxT - 1)}`);
  out = out.trimEnd() + `\n- Given the change "${change}", when it is used, then it works without breaking existing flows.`;
  return out;
}
