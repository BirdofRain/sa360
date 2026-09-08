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
  assert.ok(getStarted.every((link) => link.getAttribute("href") === "/get-started/register"));
  assert.ok(screen.getByRole("link", { name: "Create account" }).getAttribute("href") === "/get-started/register");
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
  assert.equal(continueLink.getAttribute("href"), "/portal/login?next=%2Fportal%2Forders%2Fnew");
  assert.ok(screen.getByText(/not a charge/i));
  cleanup();
});

test("need-an-account copy routes to public registration without claiming checkout", () => {
  render(<AgedVetLanding />);
  assert.ok(screen.getByRole("heading", { name: "Need an account?" }));
  assert.ok(screen.getByRole("link", { name: "Create account" }));
  assert.ok(screen.getAllByText(/payment confirmation and approval/i).length >= 1);
  assert.equal(screen.queryByText(/does not create a login/i), null);
  cleanup();
});
