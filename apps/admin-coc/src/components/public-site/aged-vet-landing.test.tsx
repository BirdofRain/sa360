import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AgedVetLanding } from "./aged-vet-landing.tsx";

test("public landing is Veteran-agent messaging with sign-in and get-started routing", () => {
  render(<AgedVetLanding />);
  assert.ok(screen.getByRole("heading", { name: /Veteran leads, built for agents/i }));
  const signIn = screen.getAllByRole("link", { name: "Sign in" });
  assert.ok(signIn.length >= 2);
  assert.ok(signIn.every((link) => link.getAttribute("href") === "/portal/login"));
  const getStarted = screen.getAllByRole("link", { name: "Get started" });
  assert.ok(getStarted.length >= 2);
  const headerGetStarted = getStarted.filter(
    (link) => link.getAttribute("href") === "/get-started/register"
  );
  assert.ok(headerGetStarted.length >= 1);
  const heroGetStarted = getStarted.find((link) =>
    (link.getAttribute("href") ?? "").startsWith("/get-started/register?")
  );
  assert.ok(heroGetStarted);
  const createHref = screen.getByRole("link", { name: "Create account" }).getAttribute("href") ?? "";
  const createUrl = new URL(createHref, "https://example.test");
  assert.equal(createUrl.pathname, "/get-started/register");
  assert.equal(createUrl.searchParams.get("states"), "TX,FL");
  assert.equal(createUrl.searchParams.get("qty"), "100");
  assert.equal(createUrl.searchParams.get("freshness"), "aged-30-90");
  assert.equal(createUrl.searchParams.get("niche"), "vet");
  assert.equal(createUrl.searchParams.get("crmPackage"), null);
  assert.ok(screen.getByRole("link", { name: "I have an invite" }).getAttribute("href") === "/portal/invite");
  assert.equal(screen.queryByText(/GHL/i), null);
  assert.equal(screen.queryByText(/Stripe/i), null);
  assert.equal(screen.queryByText(/agedvetleads\.com/i), null);
  cleanup();
});

test("interactive preview updates the request ticket and continues to portal order create", () => {
  render(<AgedVetLanding />);
  fireEvent.click(screen.getByRole("button", { name: "250 leads" }));
  fireEvent.click(screen.getByRole("button", { name: /Fresh\. New Veteran inquiries/i }));
  const ticket = screen.getByRole("heading", { name: "Veteran lead request" }).parentElement;
  assert.ok(ticket);
  assert.ok(ticket.textContent?.includes("250"));
  assert.ok(ticket.textContent?.includes("Fresh"));
  const continueLink = screen.getByRole("link", { name: "Sign in to submit this request" });
  const href = continueLink.getAttribute("href") ?? "";
  const next = new URL(href, "https://example.test").searchParams.get("next");
  assert.ok(next);
  const orderUrl = new URL(next, "https://example.test");
  assert.equal(orderUrl.pathname, "/portal/orders/new");
  assert.equal(orderUrl.searchParams.get("qty"), "250");
  assert.equal(orderUrl.searchParams.get("freshness"), "fresh");
  assert.equal(orderUrl.searchParams.get("niche"), "vet");
  assert.equal(orderUrl.searchParams.get("crmPackage"), null);
  const createUrl = new URL(
    screen.getByRole("link", { name: "Create account" }).getAttribute("href") ?? "",
    "https://example.test"
  );
  assert.equal(createUrl.pathname, "/get-started/register");
  assert.equal(createUrl.searchParams.get("qty"), "250");
  assert.equal(createUrl.searchParams.get("freshness"), "fresh");
  assert.equal(createUrl.searchParams.get("niche"), "vet");
  assert.ok(screen.getByText(/not a charge/i));
  cleanup();
});

test("need-an-account copy routes to public registration without claiming checkout", () => {
  render(<AgedVetLanding />);
  assert.ok(screen.getByRole("heading", { name: "Need an account?" }));
  const createHref = screen.getByRole("link", { name: "Create account" }).getAttribute("href") ?? "";
  assert.match(createHref, /^\/get-started\/register\?/);
  assert.equal(createHref.includes("crmPackage"), false);
  assert.ok(screen.getAllByText(/payment confirmation and approval/i).length >= 1);
  assert.equal(screen.queryByText(/does not create a login/i), null);
  cleanup();
});
