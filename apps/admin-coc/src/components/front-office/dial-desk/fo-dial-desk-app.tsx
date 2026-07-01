"use client";

import { useState } from "react";

import { DISPOSITION_LABELS } from "@/lib/front-office/display";
import type { DialDeskResponse, DialDisposition } from "@/lib/front-office/types";
import { FoContactCard } from "./fo-contact-card";
import { FoContactSidePanel } from "./fo-contact-side-panel";
import { FoDialActions } from "./fo-dial-actions";
import { FoDialQueue } from "./fo-dial-queue";

export function FoDialDeskApp({ data }: { data: DialDeskResponse }) {
  const [activeUid, setActiveUid] = useState(data.activeContact?.leadUid ?? data.queue[0]?.leadUid);
  const [lastLogged, setLastLogged] = useState<string | null>(null);

  const contact =
    activeUid === data.activeContact?.leadUid
      ? data.activeContact
      : data.activeContact;

  function handleDisposition(d: DialDisposition) {
    setLastLogged(DISPOSITION_LABELS[d]);
  }

  if (!contact) {
    return <p className="text-sm text-slate-500">No contacts in queue.</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="lg:col-span-3">
        <FoDialQueue
          items={data.queue}
          activeUid={activeUid}
          onSelect={setActiveUid}
        />
      </div>
      <div className="space-y-4 lg:col-span-5">
        <FoContactCard contact={contact} />
        <FoDialActions onDisposition={handleDisposition} lastLogged={lastLogged} />
      </div>
      <div className="lg:col-span-4">
        <FoContactSidePanel contact={contact} />
      </div>
    </div>
  );
}
