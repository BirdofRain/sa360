"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleBadgeLabel } from "@/lib/front-office/nav";
import type { FrontOfficeDataSource } from "@/lib/front-office/types";

import { useFrontOfficeSession } from "./front-office-session-context";

export function FrontOfficeHeader({
  title,
  subtitle,
  dataSource,
  onMenuClick,
}: {
  title: string;
  subtitle?: string;
  dataSource?: "mock" | "live" | "partial_live" | "mixed";
  onMenuClick?: () => void;
}) {
  const session = useFrontOfficeSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle ? (
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {dataSource && dataSource !== "live" ? (
          <span className="hidden rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 sm:inline-flex">
            {dataSource === "partial_live"
              ? "Live + preview"
              : dataSource === "mixed"
                ? "Live + preview"
                : "Preview data"}
          </span>
        ) : null}
        <span className="hidden text-xs text-slate-500 sm:inline">
          {session.displayName}
        </span>
        {session.isDevPreview ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" className="text-xs" />}
            >
              Dev: {roleBadgeLabel(session.role)}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["admin", "client", "agent"] as const).map((role) => (
                <DropdownMenuItem
                  key={role}
                  onClick={() => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("role", role);
                    router.push(`${window.location.pathname}?${params.toString()}`);
                  }}
                >
                  {roleBadgeLabel(role)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {roleBadgeLabel(session.role)}
          </span>
        )}
      </div>
    </header>
  );
}
