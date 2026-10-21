import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { AdminCocAccessProvider } from "@/components/auth/admin-coc-access";
import { ADMIN_COC_ROLE_OBSERVER } from "@/lib/admin-coc-observer-access";
import { OBSERVER_DOCUMENT_PATHS } from "@/lib/admin-coc-observer-access";

const navState = { pathname: "/" };

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "next/navigation") {
    return {
      usePathname: () => navState.pathname,
      useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let SidebarNav: typeof import("./sidebar-nav.tsx").SidebarNav;

test.before(async () => {
  process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED = "false";
  process.env.NEXT_PUBLIC_SA360_BULK_SOURCE_IMPORTS_ENABLED = "false";
  ({ SidebarNav } = await import("./sidebar-nav.tsx"));
});

test.afterEach(() => {
  cleanup();
  navState.pathname = "/";
});

test("admin sidebar shows Team and keeps Admin Tools collapsed", () => {
  render(<SidebarNav />);

  assert.equal(screen.getByRole("link", { name: "Orders" }).getAttribute("href"), "/front-office/orders");
  assert.equal(screen.getByRole("link", { name: "Clients & Subaccounts" }).getAttribute("href"), "/clients");
  assert.equal(screen.queryByRole("link", { name: "Review Queue" }), null);
  assert.equal(screen.queryByRole("link", { name: "Feature Flags" }), null);

  const toggle = screen.getByRole("button", { name: "Admin Tools" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  fireEvent.click(toggle);
  assert.equal(screen.getByRole("link", { name: "Feature Flags" }).getAttribute("href"), "/flags");
  assert.equal(screen.getByRole("link", { name: "Front Office" }).getAttribute("href"), "/front-office");
  assert.equal(screen.queryByRole("link", { name: "Review Queue" }), null);
});

test("admin tools expand for an open admin page and orders stay the active orders link", () => {
  navState.pathname = "/front-office/orders";
  const { unmount } = render(<SidebarNav />);
  const orders = screen.getByRole("link", { name: "Orders" });
  assert.equal(orders.getAttribute("aria-current"), "page");
  assert.equal(screen.getByRole("button", { name: "Admin Tools" }).getAttribute("aria-expanded"), "false");
  unmount();

  navState.pathname = "/flags";
  render(<SidebarNav />);
  assert.equal(screen.getByRole("button", { name: "Admin Tools" }).getAttribute("aria-expanded"), "true");
  assert.equal(screen.getByRole("link", { name: "Feature Flags" }).getAttribute("aria-current"), "page");
  assert.equal(screen.getByRole("link", { name: "Front Office" }).getAttribute("aria-current"), null);
});

test("front office orders does not also mark the Front Office link active", () => {
  navState.pathname = "/front-office/orders";
  render(<SidebarNav />);
  fireEvent.click(screen.getByRole("button", { name: "Admin Tools" }));
  assert.equal(screen.getByRole("link", { name: "Orders" }).getAttribute("aria-current"), "page");
  assert.equal(screen.getByRole("link", { name: "Front Office" }).getAttribute("aria-current"), null);
});

test("observer sidebar is the existing allowlist and has no admin groups", () => {
  navState.pathname = "/webhooks";
  render(
    <AdminCocAccessProvider role={ADMIN_COC_ROLE_OBSERVER}>
      <SidebarNav />
    </AdminCocAccessProvider>
  );

  assert.equal(screen.queryByRole("button", { name: "Admin Tools" }), null);
  assert.equal(screen.queryByText("Team"), null);
  assert.equal(screen.queryByRole("link", { name: "Orders" }), null);
  assert.equal(screen.queryByRole("link", { name: "Clients & Subaccounts" }), null);
  assert.equal(screen.queryByRole("link", { name: "Fulfillment Ops" }), null);
  assert.equal(screen.queryByRole("link", { name: "Review Queue" }), null);

  const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
  assert.equal(links.length, OBSERVER_DOCUMENT_PATHS.length);
  assert.deepEqual([...links].sort(), [...OBSERVER_DOCUMENT_PATHS].sort());
  assert.equal(screen.getByRole("link", { name: "Webhook Monitor" }).getAttribute("aria-current"), "page");
});
