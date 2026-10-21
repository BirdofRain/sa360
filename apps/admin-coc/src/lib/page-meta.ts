export type PageMeta = {
  title: string;
  description?: string;
};

const routes: { prefix: string; meta: PageMeta }[] = [
  {
    prefix: "/orders",
    meta: {
      title: "Orders",
      description: "Confirm payment and approve lead orders. Activation stays in Fulfillment Ops.",
    },
  },
  {
    prefix: "/meta-review",
    meta: {
      title: "Meta App Review",
      description: "Allowlisted, permission-specific Meta Graph API evidence.",
    },
  },
  {
    prefix: "/front-office/orders",
    meta: {
      title: "Lead Orders",
      description: "Confirm payment and approve lead orders.",
    },
  },
  {
    prefix: "/front-office",
    meta: {
      title: "Front Office",
      description: "Legacy front office shell for inventory, delivery, and dial-desk pages.",
    },
  },
  {
    prefix: "/source-intake/imports",
    meta: {
      title: "Bulk Imports",
      description: "Import source leads in bulk.",
    },
  },
  {
    prefix: "/source-intake",
    meta: {
      title: "Source Intake Queue",
      description: "Review inbound source leads before routing and delivery.",
    },
  },
  {
    prefix: "/fulfillment-ops",
    meta: {
      title: "Fulfillment Ops",
      description: "Activate orders, reserve inventory, and release delivery work.",
    },
  },
  {
    prefix: "/lead-inventory",
    meta: {
      title: "Lead Inventory",
      description: "Browse inventory lots and the inventory review queue.",
    },
  },
  {
    prefix: "/facebook-intake",
    meta: {
      title: "Facebook Intake",
      description: "Facebook capture intake diagnostics.",
    },
  },
  {
    prefix: "/automation-dashboard",
    meta: {
      title: "Automation Visibility",
      description: "Workflow progression, appointments, and signal health.",
    },
  },
  {
    prefix: "/direct-delivery-demo",
    meta: {
      title: "Direct Delivery Demo",
      description: "Controlled direct-delivery demonstration.",
    },
  },
  {
    prefix: "/ghl-connections",
    meta: {
      title: "GHL Connections",
      description: "GoHighLevel connection configuration.",
    },
  },
  {
    prefix: "/delivery-readiness",
    meta: {
      title: "Delivery Readiness",
      description: "Review delivery plans before live delivery is enabled.",
    },
  },
  {
    prefix: "/action-center",
    meta: {
      title: "Action Center",
      description: "Operator action center.",
    },
  },
  {
    prefix: "/agent-workspace",
    meta: {
      title: "Agent Workspace",
      description: "Agent workspace frame.",
    },
  },
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
    prefix: "/planning/pivot-archive",
    meta: {
      title: "Pivot Archive",
      description:
        "Read-only historical snapshot of pre-pivot roadmap and architecture for comparison against Lead Fulfillment OS.",
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

function matchesPagePrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  const boundary = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return pathname.startsWith(boundary);
}

export function resolvePageMeta(pathname: string): PageMeta {
  for (const r of routes) {
    if (matchesPagePrefix(pathname, r.prefix)) {
      return r.meta;
    }
  }
  return home;
}
