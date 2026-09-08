"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, Shield, X } from "lucide-react";

import {
  PUBLIC_PORTAL_SIGN_IN_HREF,
} from "@/lib/public-site/lead-request-preview";
import { cn } from "@/lib/utils";

const navLinkClass =
  "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium text-[#d7e3ee] transition hover:bg-white/5 hover:text-white";

export function PublicSiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#071422]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/get-started" className="flex min-h-11 items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full border border-[#e4c36a]/40 bg-[#e4c36a]/10 text-[#e4c36a]">
            <Shield className="size-4" aria-hidden />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight text-white">
              Aged Vet Leads
            </span>
            <span className="block text-[11px] text-[#9bb0c3]">Veteran leads for insurance agents</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Public">
          <a href="#preview" className={navLinkClass}>
            Build a request
          </a>
          <a href="#how-it-works" className={navLinkClass}>
            How it works
          </a>
          <a href="#get-started" className={navLinkClass}>
            Get started
          </a>
          <Link
            href={PUBLIC_PORTAL_SIGN_IN_HREF}
            className="ml-2 inline-flex min-h-11 items-center justify-center rounded-full border border-[#e4c36a]/40 bg-[#e4c36a] px-4 text-sm font-semibold text-[#071422] hover:bg-[#f3d98a]"
          >
            Sign in
          </Link>
        </nav>

        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/15 text-white md:hidden"
          aria-expanded={open}
          aria-controls="avl-mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
      </div>

      {open ? (
        <nav
          id="avl-mobile-nav"
          className="grid gap-1 border-t border-white/10 px-4 py-3 md:hidden"
          aria-label="Public mobile"
        >
          <a href="#preview" className={navLinkClass} onClick={() => setOpen(false)}>
            Build a request
          </a>
          <a href="#how-it-works" className={navLinkClass} onClick={() => setOpen(false)}>
            How it works
          </a>
          <a href="#get-started" className={navLinkClass} onClick={() => setOpen(false)}>
            Get started
          </a>
          <Link
            href={PUBLIC_PORTAL_SIGN_IN_HREF}
            className={cn(
              navLinkClass,
              "border border-[#e4c36a]/40 bg-[#e4c36a] font-semibold text-[#071422] hover:bg-[#f3d98a] hover:text-[#071422]"
            )}
            onClick={() => setOpen(false)}
          >
            Sign in
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
