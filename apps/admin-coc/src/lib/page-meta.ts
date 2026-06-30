export type PageMeta = {
  title: string;
  description?: string;
};

const routes: { prefix: string; meta: PageMeta }[] = [
  {
    prefix: "/clients/",
    meta: {
      title: "Client Detail",
      description: "Client profile, GHL destination, routing rules, and readiness.",
    },
  },
  {
    prefix: "/lead-fulfillment",
    meta: {
      title: "Lead Fulfillment Overview",
      description:
        "LF1 intake, proof, verification, inventory, orders, and fulfillment activity across the Lead Fulfillment OS.",
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
      description: "Legacy/retainer voice visibility for existing client support paths.",
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
      description: "Onboard clients, GHL subaccounts, routing rules, and portal prep.",
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
      description: "Fulfillment, signal engine, and legacy support toggles.",
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
    prefix: "/support-tickets",
    meta: {
      title: "Support Tickets",
      description: "Track issues, requests, and operational support items.",
    },
  },
  {
    prefix: "/launch-kanban",
    meta: {
      title: "Launch Kanban",
      description:
        "Lead Fulfillment OS roadmap priorities - strategy, proof, inventory, orders, fulfillment, dashboard, and boundaries.",
    },
  },
  {
    prefix: "/workflow",
    meta: {
      title: "Workflow Map",
      description:
        "Lead Fulfillment OS module map: LF1-LF6 plus legacy/retainer and deprecated boundaries.",
    },
  },
  {
    prefix: "/architecture",
    meta: {
      title: "System Architecture",
      description:
        "Lead fulfillment architecture, lifecycle audit engine, and optional downstream delivery adapters.",
    },
  },
];

const home: PageMeta = {
  title: "Command Center",
  description: "Live fulfillment operations health across proof, verification, inventory, orders, and delivery audit.",
};

export function resolvePageMeta(pathname: string): PageMeta {
  for (const r of routes) {
    if (pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)) {
      return r.meta;
    }
  }
  return home;
}
