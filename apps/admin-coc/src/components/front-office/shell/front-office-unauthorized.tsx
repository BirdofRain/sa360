import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import type { FrontOfficeSession } from "@/lib/front-office/types";
import { cn } from "@/lib/utils";

export function FrontOfficeUnauthorized({
  session,
}: {
  session: FrontOfficeSession;
}) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Not available for your role</h2>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        This page is not accessible with your current{" "}
        <span className="font-medium text-slate-700">{session.role}</span> session.
      </p>
      <Link href="/front-office" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>
        Back to dashboard
      </Link>
    </div>
  );
}
