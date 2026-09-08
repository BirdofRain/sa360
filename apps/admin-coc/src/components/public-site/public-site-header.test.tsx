import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PublicSiteHeader } from "./public-site-header.tsx";

test("header exposes get started and sign in, and opens a mobile menu", () => {
  render(<PublicSiteHeader />);
  assert.equal(screen.getByRole("link", { name: /Aged Vet Leads/i }).getAttribute("href"), "/get-started");
  assert.equal(screen.getByRole("link", { name: "Sign in" }).getAttribute("href"), "/portal/login");
  assert.equal(screen.getByRole("link", { name: "Get started" }).getAttribute("href"), "/get-started/register");
  assert.ok(screen.getByRole("navigation", { name: "Public" }));
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  assert.ok(screen.getByRole("navigation", { name: "Public mobile" }));
  cleanup();
});
