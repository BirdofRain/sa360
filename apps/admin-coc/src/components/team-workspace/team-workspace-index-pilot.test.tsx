import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import module from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "next/font/google") {
    return {
      Figtree: () => ({ variable: "--font-lal-heading", className: "figtree" }),
    };
  }
  if (request.includes("life-agent-launch-pilot.module.css")) {
    return { boundary: "boundary", identity: "identity" };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "../../..");

let TeamWorkspaceIndexPilot: typeof import("./team-workspace-index-pilot.tsx").TeamWorkspaceIndexPilot;

test.before(async () => {
  ({ TeamWorkspaceIndexPilot } = await import("./team-workspace-index-pilot.tsx"));
});

test.afterEach(() => {
  cleanup();
});

test("the index pilot keeps the existing names and stays a text identity", () => {
  render(
    <TeamWorkspaceIndexPilot>
      <header>
        <h1>Team Workspace</h1>
      </header>
      <a className="text-sky-800" href="https://example.invalid/clients">
        Clients and subaccounts
      </a>
      <button type="button" data-slot="button">
        Create client
      </button>
    </TeamWorkspaceIndexPilot>
  );

  const identity = screen.getByText("SA360 · Life Agent Launch");
  assert.equal(identity.tagName, "P");
  assert.equal(identity.closest("a"), null);
  assert.equal(identity.parentElement?.getAttribute("data-lal-pilot"), "team-workspace-index");
  assert.equal(screen.getByRole("heading", { name: "Team Workspace" }).tagName, "H1");
  assert.equal(
    screen.getByRole("link", { name: "Clients and subaccounts" }).getAttribute("href"),
    "https://example.invalid/clients"
  )
  assert.equal((screen.getByRole("button", { name: "Create client" }) as HTMLButtonElement).type, "button");
});

test("the pilot stylesheet records the website commit and stays on the index", () => {
  const css = readFileSync(join(here, "life-agent-launch-pilot.module.css"), "utf8");
  const indexPage = readFileSync(join(appRoot, "src/app/(dashboard)/team-workspace/page.tsx"), "utf8");
  const detailPage = readFileSync(
    join(appRoot, "src/app/(dashboard)/team-workspace/[clientAccountId]/page.tsx"),
    "utf8"
  );
  const dashboardLayout = readFileSync(join(appRoot, "src/app/(dashboard)/layout.tsx"), "utf8");
  const rootLayout = readFileSync(join(appRoot, "src/app/layout.tsx"), "utf8");
  const tailwind = readFileSync(join(appRoot, "tailwind.config.ts"), "utf8");
  const globals = readFileSync(join(appRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /e10d4d76e3ec8dc7b9553fd670e5ece84091df74/);
  assert.doesNotMatch(css, /DD0426|logo-dark|logo-light/);
  assert.match(css, /#006fff/i);
  assert.match(indexPage, /TeamWorkspaceIndexPilot/);
  for (const source of [detailPage, dashboardLayout, rootLayout, tailwind, globals]) {
    assert.equal(source.includes("TeamWorkspaceIndexPilot"), false);
    assert.equal(source.includes("life-agent-launch-pilot"), false);
    assert.equal(source.includes("lal-pilot"), false);
  }
});
