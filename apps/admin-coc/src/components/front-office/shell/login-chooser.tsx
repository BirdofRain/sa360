import Link from "next/link";
import { Building2, Shield } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function LoginChooserPage({
  nextPath = "/front-office",
}: {
  nextPath?: string;
}) {
  const adminHref = `/login?next=${encodeURIComponent(nextPath)}`;
  const clientHref = `/portal/login?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-slate-950 to-slate-900 px-4 py-12">
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
            SA360
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Front Office</h1>
          <p className="mt-2 text-sm text-slate-400">
            Sign in with your existing operator or client credentials.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-slate-700/60 bg-slate-900/80">
            <CardHeader className="pb-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-slate-800">
                <Shield className="size-4 text-slate-300" aria-hidden />
              </div>
              <CardTitle className="text-base text-white">Operator</CardTitle>
              <CardDescription className="text-slate-400">
                Admin C.O.C. access — full operational visibility.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={adminHref} className={cn(buttonVariants(), "w-full")}>
                Sign in as operator
              </Link>
            </CardContent>
          </Card>

          <Card className="border-slate-700/60 bg-slate-900/80">
            <CardHeader className="pb-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-slate-800">
                <Building2 className="size-4 text-slate-300" aria-hidden />
              </div>
              <CardTitle className="text-base text-white">Client</CardTitle>
              <CardDescription className="text-slate-400">
                Client portal access — your leads, orders, and trust status.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={clientHref}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "w-full border-slate-600 bg-transparent text-white hover:bg-slate-800"
                )}
              >
                Sign in as client
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
