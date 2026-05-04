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
    prefix: "/timeline",
    meta: {
      title: "Event Timeline",
      description: "Per-contact debug timeline (API wiring pending).",
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
