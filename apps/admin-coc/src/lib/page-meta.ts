export type PageMeta = {
  title: string;
  description?: string;
};

const routes: { prefix: string; meta: PageMeta }[] = [
  {
    prefix: "/webhooks",
    meta: {
      title: "Webhook Monitor",
      description: "GHL lifecycle requests, status, and payloads (API wiring pending).",
    },
  },
  {
    prefix: "/synthflow",
    meta: {
      title: "Synthflow Voice",
      description: "Inbound lookup traffic and caller resolution.",
    },
  },
  {
    prefix: "/clients",
    meta: {
      title: "Clients / Subaccounts",
      description: "Client accounts and GHL subaccount links.",
    },
  },
  {
    prefix: "/review",
    meta: {
      title: "Review Queue",
      description: "Schema issues, unknown subaccounts, dispatch failures.",
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
      title: "Settings",
      description: "Environment, shortcuts, and admin preferences.",
    },
  },
];

const home: PageMeta = {
  title: "Command Center",
  description: "Webhook volume, voice lookups, queue health, and open reviews.",
};

export function resolvePageMeta(pathname: string): PageMeta {
  for (const r of routes) {
    if (pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)) {
      return r.meta;
    }
  }
  return home;
}
