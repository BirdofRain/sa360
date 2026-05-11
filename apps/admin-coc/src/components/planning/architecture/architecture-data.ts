import {
  Boxes,
  Building2,
  Cog,
  Database,
  Globe,
  LayoutDashboard,
  PhoneOutgoing,
  Server,
  ShieldCheck,
  Target,
  Workflow,
  Zap,
} from "lucide-react";

import type { ArchitectureFlow, ArchitectureTier } from "./architecture-types";

export const ARCHITECTURE_TIERS: ArchitectureTier[] = [
  {
    id: "source",
    label: "Source / CRM Backbone",
    caption: "Where leads originate and where canonical contact records live.",
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
          "Source of truth for contacts, calendars, custom values, and outbound channels. Owned by client.",
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
    ],
  },
  {
    id: "app",
    label: "SA360 Application",
    caption: "The owned platform layer.",
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
          "Public API: receives GHL lifecycle webhooks, serves Synthflow lookups, validates payloads, writes lifecycle records.",
        icon: Server,
        status: "LIVE",
      },
      {
        id: "admin-api",
        name: "Admin API",
        caption: "/admin/v1",
        description:
          "Server-key-gated admin endpoints for the C.O.C. dashboard. Exposes webhook requests, Synthflow lookups, outbound results, and summary metrics.",
        icon: ShieldCheck,
        status: "LIVE",
      },
      {
        id: "worker",
        name: "Worker",
        caption: "BullMQ",
        description:
          "Background jobs: Meta CAPI dispatch, retry queues, lifecycle re-processing.",
        icon: Cog,
        status: "LIVE",
      },
      {
        id: "coc",
        name: "Admin C.O.C.",
        caption: "Next.js dashboard",
        description:
          "Internal operations console — webhook monitor, Synthflow voice, review queue, clients, and planning surfaces.",
        icon: LayoutDashboard,
        status: "LIVE",
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
          "LifecycleEvent, LeadAttribution, InboundContactIndex, WebhookRequestLog, SynthflowRequestLog, future ReviewItem + FeatureFlag.",
        icon: Database,
        status: "LIVE",
      },
      {
        id: "valkey",
        name: "Valkey",
        caption: "Redis-compatible",
        description:
          "BullMQ queues, rate-limit counters, future flag/lookup cache.",
        icon: Zap,
        status: "LIVE",
      },
    ],
  },
  {
    id: "external",
    label: "External Services",
    caption: "Third-party systems SA360 calls or is called by.",
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
          "Inbound caller lookup + outbound call execution. Calls SA360 for known-caller context; SA360 dispatches outbound calls and captures results.",
        icon: PhoneOutgoing,
        status: "LIVE",
      },
      {
        id: "meta",
        name: "Meta CAPI",
        caption: "Signal Engine",
        description:
          "Outbound conversion + lifecycle signal endpoint. SA360 worker dispatches qualified events.",
        icon: Target,
        status: "BUILDING",
      },
    ],
  },
  {
    id: "future",
    label: "Future Platform",
    caption: "Post-beta surface area.",
    tone: {
      container: "border-slate-200 bg-slate-50/60",
      accent: "bg-slate-400",
      eyebrow: "text-slate-700",
    },
    blocks: [
      {
        id: "embedded",
        name: "GHL Embedded App",
        caption: "Client onboarding iframe",
        description:
          "SA360 onboarding + per-client config UI loaded inside GHL as an embedded app. Uses scoped client + admin APIs.",
        icon: Globe,
        status: "FUTURE",
      },
      {
        id: "platform-extras",
        name: "Platform Extras",
        caption: "Backlog",
        description:
          "Orgs, manager-scoped dashboards, agent scorecards, dialer integration — sized once beta is live.",
        icon: Boxes,
        status: "FUTURE",
      },
    ],
  },
];

export const ARCHITECTURE_FLOWS: ArchitectureFlow[] = [
  {
    id: "flow-lifecycle",
    title: "GHL Lifecycle Webhook → Meta Dispatch",
    description:
      "Canonical lead path: a GHL workflow webhook is authenticated, validated, persisted, and queued for downstream Meta signal dispatch.",
    status: "LIVE",
    steps: [
      { ref: "ghl-workflows" },
      { ref: "api" },
      { ref: "postgres" },
      { ref: "worker" },
      { ref: "meta" },
    ],
  },
  {
    id: "flow-synthflow-lookup",
    title: "Synthflow Inbound Lookup",
    description:
      "Voice AI hits SA360 for known-caller context, falling back to a GHL contact lookup when the inbound number is not in InboundContactIndex.",
    status: "LIVE",
    steps: [
      { ref: "synthflow" },
      { ref: "api" },
      { ref: "postgres" },
      { ref: "ghl-crm" },
      { ref: "Synthflow custom values", freeform: true },
    ],
  },
  {
    id: "flow-coc-read",
    title: "Admin C.O.C. → Admin API → Observability",
    description:
      "Read path for the internal operations dashboard. All admin queries are server-side; the admin key never reaches the browser.",
    status: "LIVE",
    steps: [
      { ref: "coc" },
      { ref: "admin-api" },
      { ref: "postgres" },
      { ref: "Operator screens", freeform: true },
    ],
  },
  {
    id: "flow-embedded",
    title: "Future GHL Embedded App → SA360 APIs",
    description:
      "Client-facing onboarding inside GHL. Talks to the same SA360 platform via per-client scoped admin and client APIs.",
    status: "FUTURE",
    steps: [
      { ref: "embedded" },
      { ref: "admin-api" },
      { ref: "api" },
      { ref: "postgres" },
    ],
  },
];
