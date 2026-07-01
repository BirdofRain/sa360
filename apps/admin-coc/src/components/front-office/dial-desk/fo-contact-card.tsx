import type { DialDeskContact } from "@/lib/front-office/types";

export function FoContactCard({ contact }: { contact: DialDeskContact }) {
  const aiLabel =
    contact.aiStatus === "engaged"
      ? "AI engaged"
      : contact.aiStatus === "needs_human"
        ? "Needs human"
        : "AI idle";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{contact.name}</h2>
          <p className="mt-1 text-sm text-slate-500">{contact.phoneMasked}</p>
          {contact.email ? (
            <p className="text-sm text-slate-500">{contact.email}</p>
          ) : null}
        </div>
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800">
          {aiLabel}
        </span>
      </div>
      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Source</dt>
          <dd className="font-medium text-slate-800">{contact.source}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Campaign</dt>
          <dd className="font-medium text-slate-800">{contact.campaign}</dd>
        </div>
      </dl>
    </div>
  );
}
