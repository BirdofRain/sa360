import {
  Boxes,
  Building2,
  Cog,
  Database,
  Globe,
  LayoutDashboard,
  Network,
  Route,
  Send,
  Server,
  ShieldCheck,
  Target,
  Users,
  Workflow,
} from "lucide-react";

import type { ArchitectureFlow, ArchitectureTier } from "./architecture-types";

export const ARCHITECTURE_TIERS: ArchitectureTier[] = [
  {
    id: "sources",
    label: "Lead Sources + Capture",
    caption: "Where leads and consent records originate before fulfillment processing.",
    tone: {
      container: "border-blue-200 bg-blue-50/40",
      accent: "bg-blue-500",
      eyebrow: "text-blue-700",
    },
    blocks: [
      {
        id: "source-connectors",
        name: "Source Connectors",
        caption: "FB, webforms, vendors",
        description:
          "Lead capture inputs from Facebook, webforms, LeadCapture, CSV/manual imports, and partner vendors with source metadata.",
        icon: Globe,
        status: "BUILDING",
      },
      {
        id: "ghl-workflows",
        name: "Existing GHL Workflows",
        caption: "Lifecycle ingress",
        description:
          "Current GHL workflow/webhook pathways remain intact for lifecycle ingress and compatibility during transition.",
        icon: Workflow,
        status: "LIVE",
      },
      {
        id: "legacy-crm",
        name: "Client CRM Systems",
        caption: "Retainer support only",
        description:
          "Client CRM environments continue as downstream and maintenance surfaces; SA360 is not positioned as a new CRM replacement.",
        icon: Building2,
        status: "LEGACY / RETAINER ONLY",
      },
    ],
  },
  {
    id: "fulfillment",
    label: "SA360 Lead Fulfillment OS",
    caption: "Proof-backed lead supply, verification, inventory, ordering, and fulfillment control plane.",
    tone: {
      container: "border-violet-200 bg-violet-50/40",
      accent: "bg-violet-500",
      eyebrow: "text-violet-700",
    },
    blocks: [
      {
        id: "fulfillment-api",
        name: "SA360 API",
        caption: "Fastify",
        description:
          "Lead intake, proof packet handling, verification/dedupe, inventory, order, and fulfillment service endpoints.",
        icon: Server,
        status: "BUILDING",
      },
      {
        id: "delivery-adapter",
        name: "Lead Fulfillment Delivery Adapter",
        caption: "GHL and export outputs",
        description:
          "Downstream delivery adapter for client destinations, including optional GHL delivery and optional Google Sheet backup/export.",
        icon: Send,
        status: "PRIORITY",
      },
      {
        id: "lifecycle-engine",
        name: "Lifecycle Signal Engine",
        caption: "Audit + outcomes",
        description:
          "Retained lifecycle event engine for fulfillment audit trails, reporting, and outcome visibility across lead operations.",
        icon: Target,
        status: "LIVE",
      },
      {
        id: "coc",
        name: "Admin C.O.C.",
        caption: "Internal visibility",
        description:
          "Internal C.O.C. visibility for proof, routing, fulfillment, delivery audit, and operational review surfaces.",
        icon: LayoutDashboard,
        status: "LIVE",
      },
      {
        id: "buyer-dashboard",
        name: "Lead Buyer Dashboard",
        caption: "Simple buyer UX",
        description:
          "Simple client-facing ordering and delivery dashboard (orders, fulfillment progress, delivered leads, proof packet).",
        icon: Users,
        status: "NEXT",
      },
      {
        id: "fulfillment-matcher",
        name: "Fulfillment Matcher",
        caption: "Priority reservations",
        description:
          "Matches verified available inventory to active orders using state, niche, quantity, proof/verification status, duplicate rules, and order priority.",
        icon: Route,
        status: "PRIORITY",
      },
      {
        id: "admin-api",
        name: "Admin API",
        caption: "/admin/v1",
        description:
          "Server-key-gated admin endpoints for C.O.C. planning, launch Kanban, routing dry run, delivery readiness, and operational controls.",
        icon: ShieldCheck,
        status: "LIVE",
      },
    ],
  },
  {
    id: "data",
    label: "Data + Processing",
    caption: "Persistence and background processing for fulfillment and audit workflows.",
    tone: {
      container: "border-orange-200 bg-orange-50/40",
      accent: "bg-orange-500",
      eyebrow: "text-orange-700",
    },
    blocks: [
      {
        id: "postgres",
        name: "Postgres",
        caption: "Primary store",
        description:
          "Stores lifecycle events, proof/verification artifacts, inventory states, orders, reservations, and delivery audit rows.",
        icon: Database,
        status: "LIVE",
      },
      {
        id: "worker",
        name: "Worker",
        caption: "BullMQ",
        description:
          "Processes fulfillment jobs, retry flows, lifecycle signal dispatch, and operational backfill/re-processing tasks.",
        icon: Cog,
        status: "LIVE",
      },
      {
        id: "valkey",
        name: "Valkey / Redis",
        caption: "Queues + cache",
        description: "Queue coordination, rate-limits, and hot-path cache support for fulfillment processing.",
        icon: Network,
        status: "LIVE",
      },
      {
        id: "config-store",
        name: "Future Config Store",
        caption: "Planned",
        description:
          "Optional centralized policy/config layer if Postgres plus env-backed configuration requires dedicated separation.",
        icon: Boxes,
        status: "FUTURE",
      },
    ],
  },
  {
    id: "destinations",
    label: "Destinations + Integrations",
    caption: "Client delivery destinations and reporting integrations.",
    tone: {
      container: "border-teal-200 bg-teal-50/40",
      accent: "bg-teal-500",
      eyebrow: "text-teal-700",
    },
    blocks: [
      {
        id: "ghl-destination",
        name: "GoHighLevel Destination",
        caption: "Optional destination",
        description:
          "Optional downstream destination for contact/opportunity/workflow updates through guarded delivery adapter controls.",
        icon: Building2,
        status: "LIVE",
      },
      {
        id: "sheet-export",
        name: "Google Sheet Backup / Export",
        caption: "Optional backup",
        description:
          "Optional backup/export destination for clients needing sheet redundancy. Not a primary product identity.",
        icon: Globe,
        status: "LEGACY / RETAINER ONLY",
      },
      {
        id: "meta",
        name: "Meta Signal Dispatch",
        caption: "Signal engine output",
        description:
          "Lifecycle and conversion signals remain available for optimization/reporting where eligible.",
        icon: Target,
        status: "LIVE",
      },
    ],
  },
  {
    id: "boundaries",
    label: "Roadmap Boundaries",
    caption: "Legacy support and deprecated roadmap constraints.",
    tone: {
      container: "border-rose-200 bg-rose-50/60",
      accent: "bg-rose-500",
      eyebrow: "text-rose-700",
    },
    blocks: [
      {
        id: "legacy-voice",
        name: "Synthflow / CloseBot / Voice Support",
        caption: "Retainer support only",
        description:
          "Maintain existing voice and AI integrations for existing clients without net-new roadmap expansion.",
        icon: Workflow,
        status: "LEGACY / RETAINER ONLY",
      },
      {
        id: "deprecated-channel-expansion",
        name: "Blue/Green and advanced channel expansion",
        caption: "Do not build",
        description:
          "Do not build new roadmap work centered on blue/green expansion, advanced channel selection, or Orion-style CRM/AI competition.",
        icon: Route,
        status: "DEPRECATED / DO NOT BUILD",
      },
    ],
  },
];

export const ARCHITECTURE_FLOWS: ArchitectureFlow[] = [
  {
    id: "flow-intake-proof",
    title: "A. Lead Capture -> Proof Vault",
    description:
      "Lead sources flow into SA360 intake, proof packet assembly, and consent/source evidence capture before fulfillment eligibility.",
    status: "BUILDING",
    steps: [
      { ref: "source-connectors" },
      { ref: "ghl-workflows" },
      { ref: "fulfillment-api" },
      { ref: "postgres" },
      { ref: "lifecycle-engine" },
    ],
  },
  {
    id: "flow-verify-inventory",
    title: "B. Verification + Dedupe -> Inventory Queue",
    description:
      "Verification/suppression/duplicate checks determine whether a lead becomes available inventory or is held for review.",
    status: "PRIORITY",
    steps: [
      { ref: "fulfillment-api" },
      { ref: "fulfillment-matcher" },
      { ref: "postgres" },
      { ref: "Hold for review", freeform: true },
      { ref: "Available inventory", freeform: true },
    ],
  },
  {
    id: "flow-orders-fulfillment",
    title: "C. Buyer Orders -> Fulfillment Matching",
    description:
      "Lead orders activate reservation and matching logic using quantity, state, niche, proof status, verification status, and order priority.",
    status: "PRIORITY",
    steps: [
      { ref: "buyer-dashboard" },
      { ref: "admin-api" },
      { ref: "fulfillment-matcher" },
      { ref: "postgres" },
      { ref: "delivery-adapter" },
    ],
  },
  {
    id: "flow-delivery-adapter",
    title: "D. Fulfillment Delivery Adapter (Guarded)",
    description:
      "Manual-gated fulfillment delivery runs through optional GHL destination and optional sheet backup/export with existing safety controls preserved.",
    status: "LIVE",
    steps: [
      { ref: "delivery-adapter" },
      { ref: "ghl-destination" },
      { ref: "sheet-export" },
      { ref: "coc" },
      { ref: "buyer-dashboard" },
    ],
  },
  {
    id: "flow-audit-visibility",
    title: "E. Lifecycle Signals -> C.O.C. Visibility",
    description:
      "Lifecycle event ingestion remains active for proof, routing, fulfillment, and delivery audit/reporting views.",
    status: "LIVE",
    steps: [
      { ref: "lifecycle-engine" },
      { ref: "fulfillment-api" },
      { ref: "postgres" },
      { ref: "coc" },
      { ref: "buyer-dashboard" },
    ],
  },
  {
    id: "flow-legacy-boundary",
    title: "F. Legacy Support Boundary",
    description:
      "Existing CRM and voice pathways continue for retainer clients only while deprecated roadmap bets remain out of scope.",
    status: "LEGACY / RETAINER ONLY",
    steps: [
      { ref: "legacy-crm" },
      { ref: "legacy-voice" },
      { ref: "deprecated-channel-expansion" },
      { ref: "coc" },
    ],
  },
];
