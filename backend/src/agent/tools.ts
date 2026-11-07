import { z } from "zod";
import { PLAN_SECTIONS, SECTION_TITLES } from "./sections";

/**
 * The three agent tools. They are deterministic and simple on purpose:
 * the interesting part of the project is the loop that drives them (see agent.ts).
 */

export const PROJECT_TYPES = ["cafe_restaurant", "booking", "ecommerce", "portfolio", "other"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Context the server passes to tools. It is never controlled by the model. */
export interface ToolContext {
  hasPreviousPlan: boolean;
}

// ---------------------------------------------------------------------------
// analyze_prompt
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: Record<Exclude<ProjectType, "other">, RegExp> = {
  cafe_restaurant: /\b(caf[eé]s?|coffee|restaurants?|bistro|bakery|diner|eatery|food|menu|bar|pizzeria|canteen)\b/i,
  booking: /\b(railway|railways|train|trains|ticket|tickets|booking|bookings|reservations?|seat|seats|bus|flight|flights|hotel|appointment|event tickets?)\b/i,
  ecommerce: /\b(e-?commerce|shop|store|online store|sell|selling|products?|cart|checkout|marketplace|retail)\b/i,
  portfolio: /\b(portfolio|personal (site|website|page)|resume|cv|showcase|my work|photographer|freelancer)\b/i,
};

const CHECKS: Record<string, RegExp> = {
  purpose: /\b(so that|in order to|to (help|allow|let|enable|sell|book|show|showcase|attract|increase|manage)|purpose|goal|for (customers|users|people|students|travell?ers))\b/i,
  target_users: /\b(users?|customers?|clients?|visitors?|students?|travell?ers?|passengers?|admins?|staff|owners?|audience|guests?|members?|buyers?|sellers?)\b/i,
  pages_features: /\b(pages?|features?|menu|cart|checkout|search|filter|dashboard|gallery|contact|about|blog|login|booking|reservation|form|profile|order(ing)?|tracking|reviews?|admin panel)\b/i,
  design_style: /\b(design|style|theme|colou?rs?|minimal(ist)?|modern|dark mode|light mode|brand(ing)?|look and feel|ui|ux|layout|font|elegant|playful|clean)\b/i,
  tech_stack: /\b(react|next(\.js)?|vue|angular|svelte|node|express|django|flask|laravel|php|python|java|spring|mongodb|postgres(ql)?|mysql|sqlite|firebase|supabase|tailwind|typescript|wordpress|shopify|aws|vercel)\b/i,
  constraints: /\b(budget|deadline|within|weeks?|days?|months?|must|should not|only|limit(ed)?|constraint|compliance|gdpr|scale|performance|mobile[- ]first|offline|languages?|multilingual)\b/i,
  login: /\b(login|log in|sign ?in|sign ?up|register|registration|accounts?|auth(entication)?|password|otp|profile)\b/i,
  payment: /\b(payment|pay|paid|checkout|stripe|razorpay|paypal|upi|card|billing|subscription|refund|price|pricing)\b/i,
};

const CHANGE_WORDS =
  /^\s*(add|remove|delete|change|update|modify|replace|rename|extend|include|drop|switch|make it|also|redesign|improve|fix)\b|\b(add|remove|change|update|modify|replace)\s+(a|an|the|online|new)\b/i;

export const analyzePromptArgs = z.object({
  prompt: z.string({ required_error: "prompt is required" }).min(1, "prompt must not be empty"),
});

export function analyzePrompt(args: z.infer<typeof analyzePromptArgs>, ctx: ToolContext) {
  const text = args.prompt.trim();
  const words = text.split(/\s+/).filter(Boolean);

  // Pick the project type with the most keyword hits; "other" if none.
  let projectType: ProjectType = "other";
  let best = 0;
  for (const [type, re] of Object.entries(TYPE_KEYWORDS)) {
    const hits = (text.match(new RegExp(re.source, "gi")) || []).length;
    if (hits > best) {
      best = hits;
      projectType = type as ProjectType;
    }
  }

  const present: string[] = [];
  const missing: string[] = [];
  for (const [name, re] of Object.entries(CHECKS)) {
    (re.test(text) ? present : missing).push(name);
  }

  const isChange = ctx.hasPreviousPlan || CHANGE_WORDS.test(text);
  return {
    word_count: words.length,
    project_type: projectType,
    request_kind: isChange ? "change_to_existing" : "new_build",
    has_previous_plan: ctx.hasPreviousPlan,
    present,
    missing,
    note:
      "Every item in 'missing' must be handled in section 3: ask a question only if it changes what gets built, otherwise record a labelled assumption.",
  };
}

// ---------------------------------------------------------------------------
// get_template
// ---------------------------------------------------------------------------

interface DomainTemplate {
  label: string;
  roles: string[];
  entities: string[];
  pages: string[];
  implicit_requirements: string[];
  blocking_question_hints: string[];
}

const TEMPLATES: Record<ProjectType, DomainTemplate> = {
  cafe_restaurant: {
    label: "Cafe / restaurant website",
    roles: ["Guest", "Customer", "Admin (owner/staff)"],
    entities: ["MenuCategory", "MenuItem", "Order", "OrderItem", "Reservation", "Customer", "Location", "OpeningHours"],
    pages: ["Home", "Menu", "About", "Gallery", "Contact & location", "Reservation", "Admin: menu management"],
    implicit_requirements: [
      "Menu with categories, prices, dietary labels and availability",
      "Opening hours, address, map and contact details",
      "Mobile-first layout (most visitors are on phones)",
      "Admin can edit menu items and prices without a developer",
      "Basic SEO (local business schema, meta tags)",
    ],
    blocking_question_hints: [
      "Is online ordering needed, or only table reservations, or only an informational site?",
      "If ordering: pickup, delivery or both, and is online payment required?",
    ],
  },
  booking: {
    label: "Booking / ticketing website",
    roles: ["Guest", "Passenger (registered user)", "Admin (operator)"],
    entities: ["User", "Route", "Station", "Train", "Schedule", "Seat", "Booking", "Passenger", "Payment", "Ticket"],
    pages: ["Home / search", "Search results", "Seat selection", "Passenger details", "Payment", "Booking confirmation", "My bookings", "Login / register", "Admin: schedules & inventory"],
    implicit_requirements: [
      "Seat inventory must never be double-booked (transactional seat hold with expiry)",
      "Booking reference / PNR generation and e-ticket",
      "Cancellation and refund rules",
      "Payment gateway integration with idempotent callbacks",
      "Search by source, destination and date with availability",
    ],
    blocking_question_hints: [
      "Is this a real operator with its own inventory, or an aggregator using an external railway API?",
      "Is online payment in the MVP, and which gateway/country?",
    ],
  },
  ecommerce: {
    label: "E-commerce website",
    roles: ["Guest", "Customer", "Admin"],
    entities: ["User", "Product", "Category", "Cart", "CartItem", "Order", "OrderItem", "Payment", "Address", "Inventory"],
    pages: ["Home", "Product listing", "Product details", "Cart", "Checkout", "Order confirmation", "Order history", "Login / register", "Admin: products & orders"],
    implicit_requirements: [
      "Stock is checked at checkout to prevent overselling",
      "Prices and totals are calculated on the server",
      "Order status lifecycle (pending, paid, shipped, delivered, cancelled)",
      "Payment gateway with webhook verification",
      "Search and category filters",
    ],
    blocking_question_hints: [
      "What is being sold (physical, digital, services) and to which countries?",
      "Which payment gateway and currency?",
    ],
  },
  portfolio: {
    label: "Portfolio website",
    roles: ["Visitor", "Owner (admin)"],
    entities: ["Project", "Skill", "Testimonial", "ContactMessage"],
    pages: ["Home / hero", "Projects", "Project details", "About", "Contact"],
    implicit_requirements: [
      "Fast load and good SEO (static generation where possible)",
      "Contact form with spam protection",
      "Easy way to add new projects",
      "Accessible, responsive layout",
    ],
    blocking_question_hints: ["Whose portfolio is it and what kind of work is shown (design, code, photography)?"],
  },
  other: {
    label: "General website",
    roles: ["Visitor", "Registered user (if needed)", "Admin"],
    entities: ["User", "ContentItem", "ContactMessage"],
    pages: ["Home", "Main feature page(s)", "About", "Contact", "Admin"],
    implicit_requirements: [
      "Responsive layout",
      "Basic SEO and analytics",
      "Admin can manage content",
      "Contact or feedback channel",
    ],
    blocking_question_hints: ["What is the main action a visitor should take on the site?"],
  },
};

export const getTemplateArgs = z.object({
  project_type: z.enum(PROJECT_TYPES, {
    errorMap: () => ({ message: `project_type must be one of: ${PROJECT_TYPES.join(", ")}` }),
  }),
});

export function getTemplate(args: z.infer<typeof getTemplateArgs>) {
  const t = TEMPLATES[args.project_type];
  return {
    project_type: args.project_type,
    label: t.label,
    sections: PLAN_SECTIONS.map((s) => ({ heading: `## ${s.n}. ${s.title}`, must_contain: s.mustContain })),
    typical_roles: t.roles,
    typical_entities: t.entities,
    typical_pages: t.pages,
    implicit_requirements: t.implicit_requirements,
    blocking_question_hints: t.blocking_question_hints,
  };
}

// ---------------------------------------------------------------------------
// score_prompt
// ---------------------------------------------------------------------------

/** Keywords used to recognise each section heading, tolerant to small wording changes. */
const SECTION_MATCHERS: RegExp[] = [
  /intent/i,
  /requirement/i,
  /ambiguit|question/i,
  /scope/i,
  /user|journey|role/i,
  /architecture/i,
  /technolog|tech stack/i,
  /database|data model/i,
  /ui|ux|design/i,
  /task/i,
  /risk/i,
  /validation|acceptance|testing/i,
];

interface Section {
  index: number; // 0-based index into PLAN_SECTIONS
  heading: string;
  body: string;
}

/** Splits a Markdown plan into its numbered sections ("## 1. Intent", "### 2) Requirements", ...). */
export function splitSections(plan: string): Section[] {
  const lines = plan.split(/\r?\n/);
  const found: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const m = line.match(/^\s*#{1,4}\s*(?:section\s*)?(\d{1,2})\s*[.):-]?\s*(.+?)\s*#*\s*$/i);
    const n = m ? Number(m[1]) : NaN;
    if (m && n >= 1 && n <= 12 && SECTION_MATCHERS[n - 1].test(m[2])) {
      current = { index: n - 1, heading: line.trim(), body: "" };
      found.push(current);
    } else if (current) {
      current.body += line + "\n";
    }
  }
  return found;
}

const BULLET = /^\s*(?:[-*+]|\d+[.)]|\|)\s+/;

export const scorePromptArgs = z.object({
  plan: z.string({ required_error: "plan is required" }).min(1, "plan must not be empty"),
});

export function scorePrompt(args: z.infer<typeof scorePromptArgs>) {
  const sections = splitSections(args.plan);
  const byIndex = new Map<number, Section>();
  for (const s of sections) if (!byIndex.has(s.index)) byIndex.set(s.index, s);
  const feedback: string[] = [];

  // 1) All 12 sections present, in order (4 points)
  const missing = SECTION_TITLES.filter((_, i) => !byIndex.has(i));
  const inOrder = sections.every((s, i) => i === 0 || s.index >= sections[i - 1].index);
  let sectionPts = missing.length === 0 ? 4 : Math.floor(((12 - missing.length) / 12) * 4);
  if (missing.length) feedback.push(`Add the missing sections: ${missing.join(", ")}.`);
  if (missing.length === 0 && !inOrder) {
    sectionPts = 3;
    feedback.push("Put the 12 sections in the required order (1. Intent ... 12. Validation).");
  }

  // 2) Requirements tagged Confirmed or Assumed (2 points)
  const reqLines = (byIndex.get(1)?.body ?? "").split("\n").filter((l) => BULLET.test(l) && !/^\s*\|\s*-+/.test(l));
  const tagged = reqLines.filter((l) => /\b(confirmed|assumed)\b/i.test(l));
  let labelPts = 0;
  if (reqLines.length >= 3 && tagged.length / reqLines.length >= 0.8) labelPts = 2;
  else if (tagged.length > 0) labelPts = 1;
  if (labelPts < 2)
    feedback.push(`Tag every requirement [Confirmed] or [Assumed] (${tagged.length}/${reqLines.length} requirement lines are tagged).`);

  // 3) MVP separated from later scope (1 point)
  const scope = byIndex.get(3)?.body ?? "";
  const scopePts = /\bMVP\b/i.test(scope) && /\b(optional|future|later|phase 2)\b/i.test(scope) ? 1 : 0;
  if (!scopePts) feedback.push("Split Scope into separate MVP, Optional and Future enhancement lists.");

  // 4) Tasks list their dependencies (2 points)
  const taskLines = (byIndex.get(9)?.body ?? "")
    .split("\n")
    .filter((l) => /^\s*(?:[-*+]\s*|\|\s*)?(?:\*\*)?(?:T\d+|\d+[.)])/i.test(l));
  const withDeps = taskLines.filter((l) => /depends? on|dependenc|after T?\d/i.test(l));
  let depPts = 0;
  if (taskLines.length >= 3 && withDeps.length / taskLines.length >= 0.8) depPts = 2;
  else if (withDeps.length > 0) depPts = 1;
  if (depPts < 2)
    feedback.push(`Number every task and end it with "Depends on: ..." (${withDeps.length}/${taskLines.length} tasks list dependencies).`);

  // 5) Acceptance criteria present (1 point)
  const validation = byIndex.get(11)?.body ?? "";
  const acceptPts =
    /acceptance criteria/i.test(validation) && validation.split("\n").filter((l) => BULLET.test(l)).length >= 2 ? 1 : 0;
  if (!acceptPts) feedback.push("Add an 'Acceptance criteria' list (at least 2 testable items) to section 12.");

  const score = sectionPts + labelPts + scopePts + depPts + acceptPts;
  return {
    score,
    max: 10,
    passed: score >= 7,
    breakdown: {
      sections_present: `${sectionPts}/4 (${12 - missing.length}/12 sections${inOrder ? "" : ", out of order"})`,
      requirements_labelled: `${labelPts}/2`,
      mvp_separated: `${scopePts}/1`,
      task_dependencies: `${depPts}/2`,
      acceptance_criteria: `${acceptPts}/1`,
    },
    feedback: feedback.length ? feedback : ["All scoring rules met."],
  };
}

/**
 * Score of the user's raw idea, on the same 0-10 scale. A one-line idea has none of the plan
 * structure, so it is rated on how much of the analyze_prompt checklist it already covers.
 */
export function scoreOriginalPrompt(prompt: string): number {
  const a = analyzePrompt({ prompt }, { hasPreviousPlan: false });
  const coverage = a.present.length / (a.present.length + a.missing.length); // 0..1
  const typeKnown = a.project_type !== "other" ? 1 : 0;
  const lengthBonus = a.word_count >= 40 ? 1 : 0;
  return Math.min(10, 1 + typeKnown + lengthBonus + Math.round(coverage * 7));
}

// ---------------------------------------------------------------------------
// Registry used by the agent loop
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema of the arguments, sent to the model. */
  parameters: Record<string, unknown>;
  schema: z.ZodTypeAny;
  run: (args: any, ctx: ToolContext) => unknown;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "analyze_prompt",
    description:
      "ALWAYS call first. Analyzes the user's raw website idea: word count, detected project type, whether it is a new build or a change to an existing project, and which planning inputs (purpose, target users, pages/features, design style, tech stack, constraints, login, payment) are present or missing. The missing list feeds section 3 (Ambiguities and questions).",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string", description: "The user's prompt or change request, verbatim." } },
      required: ["prompt"],
    },
    schema: analyzePromptArgs,
    run: analyzePrompt,
  },
  {
    name: "get_template",
    description:
      "Returns the 12-section plan template for a project type, plus the typical roles, entities, pages and implicit requirements of that domain. Call it after analyze_prompt, with the project_type that analyze_prompt returned.",
    parameters: {
      type: "object",
      properties: {
        project_type: { type: "string", enum: [...PROJECT_TYPES], description: "Project type from analyze_prompt." },
      },
      required: ["project_type"],
    },
    schema: getTemplateArgs,
    run: getTemplate,
  },
  {
    name: "score_prompt",
    description:
      "Scores a complete draft plan from 0 to 10 with fixed rules: all 12 sections present in order (4), requirements tagged Confirmed/Assumed (2), MVP separated from later scope (1), tasks list dependencies (2), acceptance criteria present (1). Returns the score and concrete feedback. Call it on the FULL draft plan before giving the final answer.",
    parameters: {
      type: "object",
      properties: { plan: { type: "string", description: "The complete Markdown draft plan with all 12 sections." } },
      required: ["plan"],
    },
    schema: scorePromptArgs,
    run: scorePrompt,
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
