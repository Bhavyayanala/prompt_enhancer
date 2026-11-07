/** The 12 plan sections, in the required order. Single source of truth for the prompt, template and scorer. */
export const PLAN_SECTIONS = [
  {
    n: 1,
    title: "Intent",
    mustContain:
      "Product intent, primary objective, business intent, functional intent, technical intent, and intent classification (new build / new feature / modification / redesign; domain; size). Describe what the user actually wants to build, not just their words.",
  },
  {
    n: 2,
    title: "Requirements",
    mustContain:
      "Functional, non-functional (performance, security, accessibility, responsiveness) and implicit requirements. Every requirement is one bullet with an ID (FR-1, NFR-1, IR-1) and a [Confirmed] or [Assumed] tag.",
  },
  {
    n: 3,
    title: "Ambiguities and questions",
    mustContain:
      "Missing information. Only questions that block the plan are asked. Every other gap becomes a labelled assumption (A-1, A-2 ...).",
  },
  {
    n: 4,
    title: "Scope",
    mustContain: "Three separate lists: MVP, Optional, Future enhancements. Keep the MVP small.",
  },
  {
    n: 5,
    title: "Users and journeys",
    mustContain: "User roles, permissions for each role, and the main step-by-step workflow of each role.",
  },
  {
    n: 6,
    title: "Architecture",
    mustContain: "Frontend, backend, database and integrations, and how they connect (request flow).",
  },
  {
    n: 7,
    title: "Technology",
    mustContain: "Recommended technologies, each with a one-line reason.",
  },
  {
    n: 8,
    title: "Database plan",
    mustContain: "Entities with key fields, relationships (1-N, N-N) and constraints (unique, not null, foreign keys, checks).",
  },
  {
    n: 9,
    title: "UI/UX plan",
    mustContain:
      "Page inventory, components per page, interactions, and design behaviour (responsive, loading, empty and error states, accessibility).",
  },
  {
    n: 10,
    title: "Task breakdown",
    mustContain: 'Numbered, executable development tasks (T1, T2 ...), each ending with "Depends on: ..." (or "Depends on: none").',
  },
  {
    n: 11,
    title: "Risks",
    mustContain: "Security issues, edge cases and possible failures, each with a mitigation.",
  },
  {
    n: 12,
    title: "Validation",
    mustContain: "Acceptance criteria (testable, Given/When/Then or checklist) and testing requirements (unit, integration, end-to-end).",
  },
] as const;

export const SECTION_TITLES: string[] = PLAN_SECTIONS.map((s) => s.title);
