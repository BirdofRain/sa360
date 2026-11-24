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
  if (request.includes("life-agent-launch-pilot.module.css")) {
    return { boundary: "boundary" };
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

test("the index pilot adds no identity line and keeps the existing names", () => {
  render(
    <TeamWorkspaceIndexPilot>
      <header>
        <h1>Team Workspace</h1>
        <p>Named team access is not turned on. An admin session is required.</p>
      </header>
      <section aria-label="Clients">
        <label className="text-slate-800" htmlFor="team-workspace-client-filter">
          Find a client
        </label>
        <input id="team-workspace-client-filter" />
      </section>
      <a className="text-sky-800" href="https://example.invalid/clients">
        Clients and subaccounts
      </a>
      <button type="button" data-slot="button">
        Create client
      </button>
    </TeamWorkspaceIndexPilot>
  );

  assert.equal(screen.queryByText("SA360 · Life Agent Launch"), null);
  assert.equal(screen.queryByText(/Life Agent Launch/), null);
  assert.equal(document.querySelector("[data-lal-pilot]")?.getAttribute("data-lal-pilot"), "team-workspace-index");
  assert.equal(screen.getByLabelText("Find a client").id, "team-workspace-client-filter");
  assert.equal(screen.getByText("Named team access is not turned on. An admin session is required.").tagName, "P");
  assert.equal(
    screen.getByRole("link", { name: "Clients and subaccounts" }).getAttribute("href"),
    "https://example.invalid/clients"
  );
  assert.equal((screen.getByRole("button", { name: "Create client" }) as HTMLButtonElement).type, "button");
});

test("only the repeated Team Workspace title is marked for hiding", async () => {
  const { TeamWorkspaceDisabled, TeamWorkspaceIntro, TeamWorkspaceMessage } = await import("./workspace-states.tsx");
  render(
    <TeamWorkspaceIndexPilot>
      <TeamWorkspaceIntro />
      <TeamWorkspaceMessage title="Clients could not be loaded" body="The client list could not be loaded." />
      <TeamWorkspaceDisabled />
    </TeamWorkspaceIndexPilot>
  );

  const repeated = screen.getAllByRole("heading", { name: "Team Workspace" });
  assert.equal(repeated.length, 2);
  for (const heading of repeated) {
    assert.equal(heading.getAttribute("data-team-workspace-repeated-title"), "");
  }
  assert.equal(
    screen.getByRole("heading", { name: "Clients could not be loaded" }).hasAttribute("data-team-workspace-repeated-title"),
    false
  );
  assert.equal(
    screen.getByRole("heading", { name: "Team Workspace is turned off" }).hasAttribute("data-team-workspace-repeated-title"),
    false
  );
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
  assert.doesNotMatch(css, /DD0426|logo-dark|logo-light|SA360 · Life Agent Launch/);
  assert.match(css, /#006fff/i);
  assert.doesNotMatch(css, /Figtree|font-lal-heading/);
  assert.match(css, /font-family:\s*var\(--font-inter\)/);
  assert.doesNotMatch(readFileSync(join(here, "team-workspace-index-pilot.tsx"), "utf8"), /next\/font|Figtree/);
  assert.match(css, /label\.text-slate-800\)\s*\{[^}]*background-color:\s*var\(--lal-night-sky\)/);
  assert.match(css, /data-team-workspace-repeated-title\]\)\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(css, /:global\(header\) > :global\(h1\)/);
  assert.match(css, /\[data-slot="button"\]:not\(\.bg-primary\)/);
  assert.match(css, /padding:\s*8px;/);
  assert.doesNotMatch(css, /8px 4px 4px/);
  assert.match(indexPage, /TeamWorkspaceIndexPilot/);
  for (const source of [detailPage, dashboardLayout, rootLayout, tailwind, globals]) {
    assert.equal(source.includes("TeamWorkspaceIndexPilot"), false);
    assert.equal(source.includes("life-agent-launch-pilot"), false);
    assert.equal(source.includes("lal-pilot"), false);
  }
});
