import {
  Boxes,
  Building2,
  Cog,
  Database,
  Globe,
  LayoutDashboard,
  MessageSquare,
  Network,
  Phone,
  PhoneOutgoing,
  Route,
  Send,
  Server,
  Shield,
  ShieldCheck,
  Target,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

import type { ArchitectureFlow, ArchitectureTier } from "./architecture-types";

export const ARCHITECTURE_TIERS: ArchitectureTier[] = [
  {
    id: "source",
    label: "Source / CRM Backbone",
    caption: "Where leads originate and client-facing sales work happens.",
    tone: {
      container: "border-blue-200 bg-blue-50/40",
      accent: "bg-blue-500",
      eyebrow: "text-blue-700",
    },
    blocks: [
      {
        id: "ghl-crm",
        name: "GoHighLevel",
        caption: "CRM Backbone",
        description:
          "Source of truth for contacts, calendars, custom values, and outbound channels. Owned by the client subaccount.",
        icon: Building2,
        status: "LIVE",
      },
      {
        id: "ghl-workflows",
        name: "GHL Workflows",
        caption: "M1 / M2 / M3",
        description:
          "Modular GHL automations that stamp routing fields and emit lifecycle webhooks into SA360.",
        icon: Workflow,
        status: "LIVE",
      },
      {
        id: "ghl-opportunities",
        name: "GHL Opportunities / Pipelines",
        caption: "Client work board",
        description:
          "Client-facing board for leads, appointments, follow-up, and sales status. SA360 writes opportunities/stages and receives lifecycle signals back.",
        icon: Network,
        status: "PRIORITY",
      },
    ],
  },
  {
    id: "app",
    label: "SA360 Application",
    caption: "The owned platform layer between CRM and delivery.",
    tone: {
      container: "border-violet-200 bg-violet-50/40",
      accent: "bg-violet-500",
      eyebrow: "text-violet-700",
    },
    blocks: [
      {
        id: "api",
        name: "SA360 API",
        caption: "Fastify",
        description:
          "Public API: GHL lifecycle webhooks, Synthflow lookups, routing dry-run, delivery orchestration endpoints.",
        icon: Server,
        status: "LIVE",
      },
      {
        id: "admin-api",
        name: "Admin API",
        caption: "/admin/v1",
        description:
          "Server-key-gated admin endpoints for C.O.C., kanban, routing dry-run, delivery review, and observability.",
        icon: ShieldCheck,
        status: "LIVE",
      },
      {
        id: "worker",
        name: "Worker",
        caption: "BullMQ",
        description:
          "Background jobs: Meta CAPI dispatch, delivery plan processing, retries, lifecycle re-processing.",
        icon: Cog,
        status: "LIVE",
      },
      {
        id: "coc",
        name: "Admin C.O.C.",
        caption: "Internal ops console",
        description:
          "Internal operations dashboard — webhook monitor, routing dry-run, delivery readiness, review queue, and planning surfaces. Separate from client portal.",
        icon: LayoutDashboard,
        status: "LIVE",
      },
      {
        id: "client-portal",
        name: "Client Portal",
        caption: "/portal",
        description:
          "Client-facing dashboard with login/session protection and live scoped metrics. Beta for first pilot clients.",
        icon: Users,
        status: "BETA",
      },
      {
        id: "routing-engine",
        name: "Routing Engine",
        caption: "Dry-run matcher",
        description:
          "Campaign/client matching, dry-run decisions, review-required routing, and CampaignRoutingRule evaluation.",
        icon: Route,
        status: "LIVE",
      },
      {
        id: "delivery-orchestrator",
        name: "Delivery Orchestrator",
        caption: "Shadow → canary",
        description:
          "Shadow plans, readiness checks, adapter simulations, duplicate-risk review, and guarded live canary delivery (disabled in prod by default).",
        icon: Send,
        status: "BUILDING",
      },
    ],
  },
  {
    id: "data",
    label: "Data",
    caption: "Persistence + ephemeral state.",
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
          "LifecycleEvent, LeadAttribution, InboundContactIndex, WebhookRequestLog, RoutingDryRunDecision, CampaignRoutingRule, LeadDeliveryPlan, LeadDuplicateRiskAssessment, GhlDeliveryAdapterRun, GhlLiveDeliveryRun — plus client/onboarding records in progress.",
        icon: Database,
        status: "LIVE",
      },
      {
        id: "valkey",
        name: "Valkey / Redis",
        caption: "Queues + cache",
        description: "BullMQ queues, rate-limit counters, and hot-path caches.",
        icon: Zap,
        status: "LIVE",
      },
      {
        id: "config-store",
        name: "Future Config Store",
        caption: "Planned",
        description:
          "Optional centralized config for routing rules and feature flags if Postgres + env vars need a dedicated layer.",
        icon: Boxes,
        status: "FUTURE",
      },
    ],
  },
  {
    id: "external",
    label: "External Services",
    caption: "Third-party systems SA360 integrates with.",
    tone: {
      container: "border-teal-200 bg-teal-50/40",
      accent: "bg-teal-500",
      eyebrow: "text-teal-700",
    },
    blocks: [
      {
        id: "synthflow",
        name: "Synthflow",
        caption: "Voice AI",
        description:
          "Voice AI: inbound caller lookup, outbound call capture, and routing signals back into SA360.",
        icon: PhoneOutgoing,
        status: "LIVE",
      },
      {
        id: "closebot",
        name: "CloseBot",
        caption: "AI conversation",
        description:
          "AI conversation and booking source used in client automations and appointment generation.",
        icon: MessageSquare,
        status: "LIVE",
      },
      {
        id: "meta",
        name: "Meta CAPI",
        caption: "Signal Engine",
        description:
          "Conversion and lifecycle signal dispatch for optimization events from the SA360 worker.",
        icon: Target,
        status: "LIVE",
      },
      {
        id: "ghl-api",
        name: "GoHighLevel API",
        caption: "Write transport",
        description:
          "Real GHL write transport behind delivery readiness and live canary gates. Code-complete; production adapter disabled until cutover.",
        icon: Globe,
        status: "DISABLED IN PROD",
      },
      {
        id: "first-orion",
        name: "First Orion",
        caption: "Number health",
        description: "Number reputation / number health system under evaluation.",
        icon: Shield,
        status: "FUTURE",
      },
      {
        id: "jasper",
        name: "Jasper Vocal Agent",
        caption: "Live transfers",
        description: "Potential live transfer / vocal agent path being explored alongside Synthflow.",
        icon: Phone,
        status: "EXPLORING",
      },
    ],
  },
  {
    id: "future",
    label: "Future Platform",
    caption: "Post-pilot client experience and scale.",
    tone: {
      container: "border-slate-200 bg-slate-50/60",
      accent: "bg-slate-400",
      eyebrow: "text-slate-700",
    },
    blocks: [
      {
        id: "embedded",
        name: "GHL Embedded App / Custom Menu Link",
        caption: "Client entry point",
        description:
          "Client access inside GHL for SA360 portal and action center — scoped metrics and lead actions.",
        icon: Globe,
        status: "NEXT",
      },
      {
        id: "onboarding-ui",
        name: "Client Onboarding UI",
        caption: "Internal setup",
        description:
          "Internal setup for client profile, subaccount, routing rules, campaigns, snapshot verification, and readiness checklist.",
        icon: Users,
        status: "NEXT",
      },
      {
        id: "platform-extras",
        name: "Platform Extras",
        caption: "Scale",
        description:
          "Org dashboards, manager views, sidecar tools, and agent scorecards after first-client cutover.",
        icon: Boxes,
        status: "FUTURE",
      },
    ],
  },
];

export const ARCHITECTURE_FLOWS: ArchitectureFlow[] = [
  {
    id: "flow-intake-routing",
    title: "A. Master Lead Intake → SA360 Routing",
    description:
      "Facebook / master lead source → GHL intake → SA360 lifecycle webhook → Postgres → Routing Engine → Routing Dry Run.",
    status: "LIVE",
    steps: [
      { ref: "Master Lead Source", freeform: true },
      { ref: "ghl-workflows" },
      { ref: "api" },
      { ref: "postgres" },
      { ref: "routing-engine" },
      { ref: "Routing Dry Run", freeform: true },
    ],
  },
  {
    id: "flow-shadow-delivery",
    title: "B. SA360 Routing → Shadow Delivery",
    description:
      "Routing decision → shadow delivery plan → duplicate risk → delivery readiness → GHL adapter simulation.",
    status: "LIVE",
    steps: [
      { ref: "routing-engine" },
      { ref: "delivery-orchestrator" },
      { ref: "postgres" },
      { ref: "Duplicate Risk Review", freeform: true },
      { ref: "GHL Adapter Simulation", freeform: true },
    ],
  },
  {
    id: "flow-live-canary",
    title: "C. Guarded Live Canary",
    description:
      "Delivery plan → live canary preflight → assertLiveDeliveryAllowed → duplicate-risk guard → GHL live transport → client GHL contact/opportunity/workflow. Manual only; disabled in production until cutover.",
    status: "DISABLED IN PROD",
    steps: [
      { ref: "delivery-orchestrator" },
      { ref: "ghl-api" },
      { ref: "ghl-crm" },
      { ref: "ghl-opportunities" },
      { ref: "Zapier legacy (until cutover)", freeform: true },
    ],
  },
  {
    id: "flow-ghl-lifecycle",
    title: "D. Client GHL Activity → SA360 Lifecycle",
    description:
      "GHL workflows, opportunities, and appointments → lifecycle webhook → SA360 API → C.O.C. and client portal read models.",
    status: "BUILDING",
    steps: [
      { ref: "ghl-workflows" },
      { ref: "ghl-opportunities" },
      { ref: "api" },
      { ref: "postgres" },
      { ref: "coc" },
      { ref: "client-portal" },
    ],
  },
  {
    id: "flow-client-portal",
    title: "E. Client Portal",
    description:
      "Client login/session → client-scoped dashboard API → Postgres summary/read models → /portal dashboard.",
    status: "BETA",
    steps: [
      { ref: "client-portal" },
      { ref: "api" },
      { ref: "postgres" },
      { ref: "Client metrics", freeform: true },
    ],
  },
  {
    id: "flow-embedded",
    title: "F. Future GHL Embedded Client Experience",
    description:
      "GHL custom menu link / embedded portal → SA360 client portal / action center → scoped client metrics and lead actions.",
    status: "NEXT",
    steps: [
      { ref: "embedded" },
      { ref: "client-portal" },
      { ref: "api" },
      { ref: "postgres" },
    ],
  },
];
