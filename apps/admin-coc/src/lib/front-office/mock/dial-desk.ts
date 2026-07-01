import type { DialDeskResponse } from "../types";

export function getMockDialDesk(): DialDeskResponse {
  const queue = [
    {
      leadUid: "FO-2026-00821",
      leadName: "Maria Gonzalez",
      phoneMasked: "(512) ***-4821",
      priority: "hot" as const,
      campaign: "Fresh Insurance TX",
      lastTouchAt: new Date(Date.now() - 8 * 60000).toISOString(),
    },
    {
      leadUid: "FO-2026-00818",
      leadName: "Sarah Kim",
      phoneMasked: "(713) ***-3390",
      priority: "warm" as const,
      campaign: "Fresh Insurance TX",
      lastTouchAt: new Date(Date.now() - 51 * 60000).toISOString(),
    },
    {
      leadUid: "FO-2026-00816",
      leadName: "Emily Johnson",
      phoneMasked: "(505) ***-2210",
      priority: "standard" as const,
      campaign: "Fresh Insurance TX",
    },
    {
      leadUid: "FO-2026-00814",
      leadName: "Lisa Anderson",
      phoneMasked: "(915) ***-9903",
      priority: "warm" as const,
      campaign: "Q2 Aged Solar",
      lastTouchAt: new Date(Date.now() - 145 * 60000).toISOString(),
    },
  ];

  return {
    queue,
    activeContact: {
      leadUid: "FO-2026-00821",
      name: "Maria Gonzalez",
      phoneMasked: "(512) ***-4821",
      email: "m.gonzalez@example.com",
      source: "Vendor CSV · Fresh",
      campaign: "Fresh Insurance TX",
      aiStatus: "engaged",
      timeline: [
        {
          at: new Date(Date.now() - 8 * 60000).toISOString(),
          summary: "Lead delivered to Summit Insurance Group",
        },
        {
          at: new Date(Date.now() - 6 * 60000).toISOString(),
          summary: "AI first touch SMS sent",
        },
        {
          at: new Date(Date.now() - 4 * 60000).toISOString(),
          summary: "Contact replied — interested in quote",
        },
        {
          at: new Date(Date.now() - 2 * 60000).toISOString(),
          summary: "AI escalated to human agent",
        },
      ],
      notes: [
        "Interested in whole-life policy",
        "Prefers afternoon callbacks",
      ],
    },
    dataSource: "mock",
  };
}
