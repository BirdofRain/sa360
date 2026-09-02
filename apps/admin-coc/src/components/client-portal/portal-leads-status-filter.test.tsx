import assert from "node:assert/strict";
import module from "node:module";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const pushes: string[] = [];
const refreshes: number[] = [];

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "next/navigation") {
    return {
      useRouter: () => ({
        push: (href: string) => {
          pushes.push(href);
        },
        refresh: () => {
          refreshes.push(Date.now());
        },
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function loadFilter() {
  return import("./portal-leads-status-filter.tsx");
}

afterEach(() => {
  cleanup();
  pushes.length = 0;
  refreshes.length = 0;
});

describe("PortalLeadsStatusFilter navigation", () => {
  it("default All state marks All current and keeps Delivered shareable", async () => {
    const { PortalLeadsStatusFilter } = await loadFilter();
    render(<PortalLeadsStatusFilter active="all" />);
    const all = screen.getByRole("link", { name: "All" });
    const delivered = screen.getByRole("link", { name: "Delivered" });
    assert.equal(all.getAttribute("href"), "/portal/leads");
    assert.equal(all.getAttribute("aria-current"), "page");
    assert.equal(delivered.getAttribute("href"), "/portal/leads?status=delivered");
    assert.equal(delivered.getAttribute("aria-current"), null);
    assert.ok(screen.getByRole("navigation", { name: "Lead status" }));
  });

  it("supported status filter marks Delivered current", async () => {
    const { PortalLeadsStatusFilter } = await loadFilter();
    render(<PortalLeadsStatusFilter active="delivered" />);
    assert.equal(
      screen.getByRole("link", { name: "Delivered" }).getAttribute("aria-current"),
      "page"
    );
    assert.equal(screen.getByRole("link", { name: "All" }).getAttribute("aria-current"), null);
  });

  it("filter pills wrap instead of forcing horizontal page overflow", async () => {
    const { PortalLeadsStatusFilter } = await loadFilter();
    const { container } = render(<PortalLeadsStatusFilter active="all" />);
    const nav = container.querySelector("nav");
    assert.ok(nav);
    assert.match(nav.className, /flex-wrap/);
    assert.match(nav.className, /max-w-full/);
  });

  it("All click from Delivered pushes /portal/leads and refreshes the RSC tree", async () => {
    const { PortalLeadsStatusFilter } = await loadFilter();
    render(<PortalLeadsStatusFilter active="delivered" />);
    fireEvent.click(screen.getByRole("link", { name: "All" }));
    assert.deepEqual(pushes, ["/portal/leads"]);
    assert.equal(refreshes.length, 1);
  });

  it("Delivered click from All pushes the delivered query and refreshes", async () => {
    const { PortalLeadsStatusFilter } = await loadFilter();
    render(<PortalLeadsStatusFilter active="all" />);
    fireEvent.click(screen.getByRole("link", { name: "Delivered" }));
    assert.deepEqual(pushes, ["/portal/leads?status=delivered"]);
    assert.equal(refreshes.length, 1);
  });

  it("modified All click keeps the native href and does not soft-navigate", async () => {
    const { PortalLeadsStatusFilter } = await loadFilter();
    render(<PortalLeadsStatusFilter active="delivered" />);
    fireEvent.click(screen.getByRole("link", { name: "All" }), { metaKey: true });
    assert.deepEqual(pushes, []);
    assert.equal(refreshes.length, 0);
    assert.equal(screen.getByRole("link", { name: "All" }).getAttribute("href"), "/portal/leads");
  });

  it("repeated All ↔ Delivered clicks keep pushing the exact customer-safe hrefs", async () => {
    const { PortalLeadsStatusFilter } = await loadFilter();
    render(<PortalLeadsStatusFilter active="all" />);
    fireEvent.click(screen.getByRole("link", { name: "Delivered" }));
    fireEvent.click(screen.getByRole("link", { name: "All" }));
    fireEvent.click(screen.getByRole("link", { name: "Delivered" }));
    fireEvent.click(screen.getByRole("link", { name: "All" }));
    assert.deepEqual(pushes, [
      "/portal/leads?status=delivered",
      "/portal/leads",
      "/portal/leads?status=delivered",
      "/portal/leads",
    ]);
    assert.equal(refreshes.length, 4);
  });
});
