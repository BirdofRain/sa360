import { useState } from "react";
import { Sidebar, NavKey } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { CommandCenter } from "./components/pages/CommandCenter";
import { WebhookMonitor } from "./components/pages/WebhookMonitor";
import { SynthflowMonitor } from "./components/pages/SynthflowMonitor";
import { ClientsPage } from "./components/pages/Clients";
import { ClientDetail } from "./components/pages/ClientDetail";
import { ReviewQueue } from "./components/pages/ReviewQueue";
import { TimelinePage } from "./components/pages/Timeline";
import { SettingsPage } from "./components/pages/Settings";
import { LibraryPage } from "./components/pages/Library";

const TITLES: Record<NavKey, { title: string; subtitle?: string }> = {
  command: { title: "Command Center", subtitle: "Live operational health across all clients" },
  webhooks: { title: "Webhook Monitor", subtitle: "All inbound + outbound webhook activity" },
  synthflow: { title: "Synthflow Voice Monitor", subtitle: "Inbound caller lookups & agent routing" },
  clients: { title: "Clients & Subaccounts", subtitle: "Configuration and feature toggles" },
  client_detail: { title: "Client Detail", subtitle: "Full client operational profile" },
  review: { title: "Review Queue", subtitle: "Items requiring admin attention" },
  timeline: { title: "Event Timeline", subtitle: "Per-contact debug timeline" },
  settings: { title: "Settings & Environment", subtitle: "System configuration" },
  library: { title: "Component Library", subtitle: "Reusable UI primitives for handoff" },
};

export default function App() {
  const [active, setActive] = useState<NavKey>("command");
  const meta = TITLES[active];

  return (
    <div className="flex h-screen min-h-screen w-full bg-slate-50 text-slate-900" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
      <Sidebar active={active} onNav={setActive} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar env="production" title={meta.title} subtitle={meta.subtitle} />
        <main className="flex-1 overflow-auto">
          {active === "command" && <CommandCenter />}
          {active === "webhooks" && <WebhookMonitor />}
          {active === "synthflow" && <SynthflowMonitor />}
          {active === "clients" && <ClientsPage onOpenClient={() => setActive("client_detail")} />}
          {active === "client_detail" && <ClientDetail />}
          {active === "review" && <ReviewQueue />}
          {active === "timeline" && <TimelinePage />}
          {active === "settings" && <SettingsPage />}
          {active === "library" && <LibraryPage />}
        </main>
      </div>
    </div>
  );
}
