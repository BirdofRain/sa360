export type PageMeta = {
  title: string;
  description?: string;
};

const routes: { prefix: string; meta: PageMeta }[] = [
  {
    prefix: "/clients/detail",
    meta: {
      title: "Client Detail",
      description: "Full client operational profile (API wiring pending).",
    },
  },
  {
    prefix: "/webhooks",
    meta: {
      title: "Webhook Monitor",
      description: "All inbound webhook activity — GHL lifecycle requests, status, payloads.",
    },
  },
  {
    prefix: "/synthflow",
    meta: {
      title: "Synthflow Voice Monitor",
      description: "Inbound caller lookups & routing signals.",
    },
  },
  {
    prefix: "/lead-timeline",
    meta: {
      title: "Lead Timeline",
      description: "Per-lead chronological events across webhooks, lifecycle, and voice.",
    },
  },
  {
    prefix: "/routing-dry-run",
    meta: {
      title: "Routing Dry Run",
      description:
        "Review how SA360 would route incoming leads before delivery is enabled (dry-run only).",
    },
  },
  {
    prefix: "/timeline",
    meta: {
      title: "Event Timeline",
      description: "Redirects to lead timeline — use Webhook Monitor or /lead-timeline.",
    },
  },
  {
    prefix: "/clients",
    meta: {
      title: "Clients & Subaccounts",
      description: "Configuration, accounts, and GHL subaccount links.",
    },
  },
  {
    prefix: "/review",
    meta: {
      title: "Review Queue",
      description: "Items requiring admin attention.",
    },
  },
  {
    prefix: "/flags",
    meta: {
      title: "Feature Flags",
      description: "Voice, Meta sync, replay, and product toggles.",
    },
  },
  {
    prefix: "/settings",
    meta: {
      title: "Settings & Environment",
      description: "System configuration and shortcuts.",
    },
  },
  {
    prefix: "/launch-kanban",
    meta: {
      title: "Launch Kanban",
      description:
        "Launch and cutover priorities — done, this week, next, blocked, and later.",
    },
  },
  {
    prefix: "/workflow",
    meta: {
      title: "Workflow Map",
      description:
        "Module map: intake, routing, GHL delivery, voice, portal, onboarding, retention.",
    },
  },
  {
    prefix: "/architecture",
    meta: {
      title: "System Architecture",
      description:
        "Phase 4I tiers, data stores, integrations, and primary delivery flows.",
    },
  },
];

const home: PageMeta = {
  title: "Command Center",
  description: "Live operational health across clients — webhooks, voice, queue, reviews.",
};

export function resolvePageMeta(pathname: string): PageMeta {
  for (const r of routes) {
    if (pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)) {
      return r.meta;
    }
  }
  return home;
}
