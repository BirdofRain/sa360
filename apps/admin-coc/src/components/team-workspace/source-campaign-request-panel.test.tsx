import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import type { SourceCampaignRequestActionResult, SourceCampaignRequestEcho } from "@/app/actions/source-campaign-request";
import type { SourceCampaignReviewView } from "@/lib/team-workspace/source-campaign-review";
import type { SourceCampaignRequestView } from "@/lib/team-workspace/source-campaign-request";

type SubmitInput = SourceCampaignRequestEcho & { clientAccountId: string; requestId: string };

const submits: SubmitInput[] = [];
const rejects: { requestId: string; expectedRevision: number; setupRevision: number }[] = [];
const refreshCalls: string[] = [];
let submitImpl: (input: SubmitInput) => Promise<SourceCampaignRequestActionResult> = async (input) => storedRequest(input);
let rejectImpl: (input: { requestId: string }) => Promise<SourceCampaignRequestActionResult> = async (input) => storedRejection(input.requestId);
let submitGate: Promise<void> | null = null;

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/navigation") {
    return { useRouter: () => ({ refresh: () => refreshCalls.push("refresh"), push: () => undefined, replace: () => undefined }) };
  }
  if (request === "@/app/actions/source-campaign-request") {
    return {
      submitSourceCampaignRequestAction: async (input: SubmitInput) => {
        submits.push(input);
        if (submitGate) await submitGate;
        return submitImpl(input);
      },
      rejectSourceCampaignRequestAction: async (input: { requestId: string; expectedRevision: number; setupRevision: number }) => {
        rejects.push(input);
        return rejectImpl(input);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let Panel: typeof import("./source-campaign-request-panel.tsx").SourceCampaignRequestPanel;

test.before(async () => {
  ({ SourceCampaignRequestPanel: Panel } = await import("./source-campaign-request-panel.tsx"));
});

test.afterEach(() => {
  cleanup();
  submits.length = 0;
  rejects.length = 0;
  refreshCalls.length = 0;
  submitGate = null;
  submitImpl = async (input) => storedRequest(input);
  rejectImpl = async (input) => storedRejection(input.requestId);
});

test("the panel has no operational action", () => {
  const source = [
    readFileSync(new URL("./source-campaign-request-panel.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../../app/actions/source-campaign-request.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.equal(/\bApply\b/.test(source), false);
  assert.equal(/\bApprove\b/.test(source), false);
  assert.equal(/\bActivate\b/.test(source), false);
  assert.equal(/confirm association/i.test(source), false);
  assert.equal(source.includes("source-funnels"), false);
  assert.equal(source.includes("routing/rules"), false);
  render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview()} request={readyHead()} />);
  assert.equal(screen.queryByRole("button", { name: /apply|approve|activate|confirm association/i }), null);
});

test("a missing or incomplete saved setup cannot be submitted", () => {
  const missing = render(<Panel clientAccountId="alex_gross" setup={null} draft={matchingDraft()} review={null} request={readyHead(null)} />);
  assert.equal(screen.getByRole("button", { name: "Submit proposal" }).hasAttribute("disabled"), true);
  assert.equal(document.querySelector("[data-request-step='draft_saved']")?.getAttribute("data-state"), "current");
  missing.rerender(
    <Panel
      clientAccountId="alex_gross"
      setup={savedSetup({ providerCampaignId: "" })}
      draft={{ providerFunnelId: "funnel-1", providerCampaignId: "" }}
      review={readyReview()}
      request={readyHead(null)}
    />
  );
  assert.equal(screen.getByRole("button", { name: "Submit proposal" }).hasAttribute("disabled"), true);
  assert.match(screen.getByText(/missing a funnel id or page URL, or a campaign id/).textContent ?? "", /campaign id/);
  assert.equal(document.querySelector("[data-request-step='draft_saved']")?.getAttribute("data-state"), "current");
  assert.equal(document.querySelector("[data-request-step='source_reviewed']")?.getAttribute("data-state"), "waiting");
  assert.equal(submits.length, 0);
});

test("a saved draft submits once, reloads, and retries the same request id", async () => {
  let release: () => void = () => undefined;
  submitGate = new Promise((resolve) => {
    release = resolve;
  });
  render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview()} request={readyHead(null)} />);
  const button = screen.getByRole("button", { name: "Submit proposal" });
  fireEvent.click(button);
  fireEvent.click(button);
  assert.equal(submits.length, 1);
  release();
  await screen.findByText(/The API stored this proposal/);
  assert.equal(submits.length, 1);
  assert.equal(submits[0]?.providerFunnelId, "funnel-1");
  assert.equal(submits[0]?.parentUrlKey, "go.example.com/vet");
  assert.equal(submits[0]?.providerCampaignId, "camp-1");
  assert.equal(submits[0]?.expectedRevision, 4);
  assert.equal(submits[0]?.setupRevision, 2);
  assert.equal(refreshCalls.length, 1);
  assert.equal(/confirmed association/i.test(document.body.textContent ?? ""), false);

  cleanup();
  submits.length = 0;
  refreshCalls.length = 0;
  let attempts = 0;
  submitImpl = async (input) => {
    attempts += 1;
    if (attempts === 1) {
      return {
        ok: false,
        uncertain: true,
        stored: false,
        retainRequestId: true,
        code: "UNCERTAIN",
        message: "The request did not finish. Retry uses the same request id.",
        status: null,
        revision: null,
        requestId: null,
        replayed: false,
        supersededRequestId: null,
        sent: input,
      };
    }
    return storedRequest(input);
  };
  render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview()} request={readyHead(null)} />);
  fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
  const retry = await screen.findByRole("button", { name: "Retry the same request" });
  fireEvent.click(retry);
  await screen.findByText(/The API stored this proposal/);
  assert.equal(submits.length, 2);
  assert.equal(submits[0]?.requestId, submits[1]?.requestId);
});

test("an unsaved edit and an open proposal need a save and an explicit replacement", () => {
  render(
    <Panel
      clientAccountId="alex_gross"
      setup={savedSetup()}
      draft={{ providerFunnelId: "not-saved", providerCampaignId: "camp-1" }}
      review={readyReview()}
      request={readyHead()}
    />
  );
  assert.equal(screen.getByRole("button", { name: "Submit proposal" }).hasAttribute("disabled"), true);
  assert.match(document.querySelector("[data-request-step='draft_saved']")?.textContent ?? "", /Save the onboarding draft/);
  assert.equal(submits.length, 0);
});

test("replacing an open proposal requires the checkbox, and rejection uses a new request id", async () => {
  render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview()} request={readyHead()} />);
  const submit = screen.getByRole("button", { name: "Submit proposal" });
  assert.equal(submit.hasAttribute("disabled"), true);
  fireEvent.click(screen.getByRole("checkbox", { name: /Replace the open proposal/ }));
  assert.equal(screen.getByRole("button", { name: "Submit proposal" }).hasAttribute("disabled"), false);
  fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
  await screen.findByText(/previous open proposal was replaced/);
  assert.equal(submits[0]?.replaceOpenProposal, true);
  assert.notEqual(submits[0]?.requestId, "44444444-4444-4444-8444-444444444444");

  cleanup();
  submits.length = 0;
  render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview()} request={readyHead()} />);
  fireEvent.click(screen.getByRole("button", { name: "Reject open proposal" }));
  await screen.findByText(/rejected by this operator/);
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0]?.expectedRevision, 4);
  assert.equal(rejects[0]?.setupRevision, 2);
  assert.notEqual(rejects[0]?.requestId, "44444444-4444-4444-8444-444444444444");
  assert.equal(submits.length, 0);
});

test("an older open proposal is rejected or replaced with the newer chain revision", async () => {
  const request: SourceCampaignRequestView = {
    availability: "ready",
    revision: 2,
    openRequest: {
      requestId: "44444444-4444-4444-8444-444444444444",
      status: "requested",
      revision: 1,
      setupRevision: 2,
      providerFunnelId: "funnel-1",
      parentUrlKey: "go.example.com/vet",
      providerCampaignId: "camp-1",
      requestedAssociation: true,
      createdAt: "2026-11-10T16:00:00.000Z",
    },
  };
  render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview()} request={request} />);
  assert.match(screen.getByText("Request-chain revision").parentElement?.textContent ?? "", /2/);
  assert.match(screen.getByText("Proposal revision").parentElement?.textContent ?? "", /1/);
  assert.match(screen.getByText("Proposal setup revision").parentElement?.textContent ?? "", /2/);
  assert.equal(screen.getByText("funnel-1").textContent, "funnel-1");
  assert.match(document.body.textContent ?? "", /Nov 10, 2026/);
  assert.equal(screen.getByRole("button", { name: "Submit proposal" }).hasAttribute("disabled"), true);
  assert.equal(screen.queryByRole("button", { name: /apply|approve|activate|confirm association/i }), null);

  fireEvent.click(screen.getByRole("checkbox", { name: /Replace the open proposal/ }));
  fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
  await screen.findByText(/previous open proposal was replaced/);
  assert.equal(submits[0]?.expectedRevision, 2);
  assert.equal(submits[0]?.setupRevision, 2);
  assert.equal(submits[0]?.replaceOpenProposal, true);

  cleanup();
  submits.length = 0;
  render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview()} request={request} />);
  fireEvent.click(screen.getByRole("button", { name: "Reject open proposal" }));
  await screen.findByText(/rejected by this operator/);
  assert.equal(rejects[0]?.expectedRevision, 2);
  assert.equal(rejects[0]?.setupRevision, 2);
  assert.notEqual(rejects[0]?.requestId, request.openRequest?.requestId);
});

test("an ownership conflict stays distinct from operator rejection", async () => {
  submitImpl = async () => ({
    ok: false,
    uncertain: false,
    stored: true,
    retainRequestId: false,
    code: "source_owned_by_other_client",
    message: "The API recorded a rejection at request revision 5 because a matching source belongs to another client. This was not an operator rejection. Status: rejected.",
    status: "rejected",
    revision: 5,
    requestId: "11111111-1111-4111-8111-111111111111",
    replayed: false,
    supersededRequestId: null,
    sent: null,
  });
  render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview({ sourceStatus: "confirmed_for_other_client" })} request={readyHead(null)} />);
  fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
  const status = await screen.findByRole("status");
  assert.match(status.textContent ?? "", /not an operator rejection/);
  assert.match(document.body.textContent ?? "", /does not move the source/);
  assert.equal(refreshCalls.length, 1);
});

test("a stale revision and a thrown request stay recoverable", async () => {
  submitImpl = async () => ({
    ok: false,
    uncertain: false,
    stored: false,
    retainRequestId: false,
    code: "revision_conflict",
    message: "The request chain changed. Reload before trying again. Nothing new was stored from this attempt.",
    status: null,
    revision: null,
    requestId: null,
    replayed: false,
    supersededRequestId: null,
    sent: null,
  });
  const first = render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview()} request={readyHead(null)} />);
  fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
  await screen.findByText(/Nothing new was stored/);
  assert.equal(screen.queryByRole("button", { name: "Retry the same request" }), null);
  first.unmount();

  submitImpl = async () => {
    throw new Error("network down");
  };
  render(<Panel clientAccountId="alex_gross" setup={savedSetup()} draft={matchingDraft()} review={readyReview()} request={readyHead(null)} />);
  fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
  const retry = await screen.findByRole("button", { name: "Retry the same request" });
  const requestId = screen.getByText(/Unconfirmed request id/).textContent;
  submitImpl = async (input) => storedRequest(input);
  fireEvent.click(retry);
  await screen.findByText(/The API stored this proposal/);
  assert.equal(submits.at(-1)?.requestId, requestId?.replace("Unconfirmed request id ", ""));
  assert.equal(screen.getByRole("button", { name: "Reload request chain" }).hasAttribute("disabled"), false);
});

test("disabled flags render the chain as not loaded and do not submit", () => {
  render(
    <Panel
      clientAccountId="alex_gross"
      setup={savedSetup()}
      draft={matchingDraft()}
      review={readyReview()}
      request={{ availability: "disabled", reason: "request_flag", message: "Formal source and campaign requests are turned off. The check above is still a read." }}
    />
  );
  assert.equal(screen.getAllByText(/turned off/).length > 0, true);
  assert.equal(screen.getAllByText("Not loaded").length > 0, true);
  assert.equal(screen.getByRole("button", { name: "Submit proposal" }).hasAttribute("disabled"), true);
  fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
  assert.equal(submits.length, 0);
});

function savedSetup(data: { providerFunnelId?: string; providerCampaignId?: string; nextgenFunnelUrl?: string | null } = {}) {
  return {
    revision: 2,
    repairRequired: false,
    data: {
      providerFunnelId: "funnel-1",
      providerCampaignId: "camp-1",
      nextgenFunnelUrl: "https://Go.Example.com/vet/?v=9",
      ...data,
    },
  };
}

function matchingDraft() {
  return { providerFunnelId: "funnel-1", providerCampaignId: "camp-1" };
}

function readyReview(overrides: Partial<SourceCampaignReviewView> = {}): SourceCampaignReviewView {
  return {
    availability: "ready",
    disposition: "saved_request",
    revision: 2,
    requested: { trafficSourceName: null, providerFunnelId: "funnel-1", providerCampaignId: "camp-1" },
    sourceStatus: "registered_unconfirmed",
    campaignStatus: "no_matching_rule",
    sourceAssociated: false,
    deliveryActivated: false,
    deliveryConfirmed: false,
    liveRouting: false,
    campaignOwnership: "none",
    attention: [],
    ...overrides,
  };
}

function readyHead(open: SourceCampaignRequestView | null = undefined as unknown as SourceCampaignRequestView): SourceCampaignRequestView {
  if (open && "availability" in open) return open;
  return {
    availability: "ready",
    revision: 4,
    openRequest:
      open === null
        ? null
        : {
            requestId: "44444444-4444-4444-8444-444444444444",
            status: "requested",
            revision: 4,
            setupRevision: 2,
            providerFunnelId: "funnel-1",
            parentUrlKey: "go.example.com/vet",
            providerCampaignId: "camp-1",
            requestedAssociation: true,
            createdAt: "2026-11-10T16:04:00.000Z",
          },
  };
}

function storedRequest(input: SubmitInput): SourceCampaignRequestActionResult {
  return {
    ok: true,
    uncertain: false,
    stored: true,
    retainRequestId: false,
    code: null,
    message: input.replaceOpenProposal
      ? "The API stored this proposal at request revision 5. The previous open proposal was replaced. Status: requested. Next step: operational review."
      : "The API stored this proposal at request revision 5. Status: requested. Next step: operational review.",
    status: "requested",
    revision: 5,
    requestId: input.requestId,
    replayed: false,
    supersededRequestId: input.replaceOpenProposal ? "44444444-4444-4444-8444-444444444444" : null,
    sent: input,
  };
}

function storedRejection(requestId: string): SourceCampaignRequestActionResult {
  return {
    ok: true,
    uncertain: false,
    stored: true,
    retainRequestId: false,
    code: null,
    message: "The open proposal was rejected by this operator at request revision 6. Status: rejected.",
    status: "rejected",
    revision: 6,
    requestId,
    replayed: false,
    supersededRequestId: null,
    sent: null,
  };
}
