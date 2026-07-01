import type { FrontOfficeDashboardResponse } from "../types";

export function getMockDashboard(
  role: "admin" | "client" | "agent" = "admin"
): FrontOfficeDashboardResponse {
  const clientFilter =
    role === "client" ? ["Summit Insurance Group"] : ["Summit Insurance Group", "Pacific Solar Co", "Desert HVAC Pros"];

  return {
    generatedAt: new Date().toISOString(),
    availability: "available",
    dataSource: "mock",
    filters: {
      campaigns: ["Q2 Aged Solar", "Fresh Insurance TX", "HVAC Summer Push"],
      clients: clientFilter,
      dateRanges: [
        { key: "today", label: "Today" },
        { key: "7d", label: "Last 7 days" },
        { key: "30d", label: "Last 30 days" },
        { key: "mtd", label: "Month to date" },
      ],
    },
    kpis: [
      {
        key: "leadsDelivered",
        label: "Leads Delivered",
        value: role === "client" ? 142 : 803,
        delta: "+6% vs last week",
        tone: "good",
      },
      {
        key: "appointmentsBooked",
        label: "Appointments Booked",
        value: role === "client" ? 38 : 214,
        delta: "+4% vs last week",
        tone: "good",
      },
      {
        key: "liveTransfers",
        label: "Live Transfers",
        value: role === "client" ? 12 : 47,
        delta: "3 pending connect",
        tone: "neutral",
      },
      {
        key: "pickupRate",
        label: "Pickup Rate",
        value: "68%",
        delta: "+2 pts",
        tone: "good",
      },
      {
        key: "showRate",
        label: "Show Rate",
        value: "74%",
        delta: "-1 pt",
        tone: "warn",
      },
      {
        key: "soldIssued",
        label: "Sold / Issued",
        value: role === "client" ? 9 : 41,
        delta: "2 issued today",
        tone: "good",
      },
      {
        key: "deliveryFailures",
        label: "Delivery Failures",
        value: role === "client" ? 2 : 9,
        delta: "3 retriable",
        tone: "bad",
      },
      {
        key: "trustScore",
        label: "Trust Score",
        value: "92",
        delta: "All critical checks pass",
        tone: "good",
      },
    ],
    urgentTasks: [
      {
        id: "task-1",
        title: "2 delivery failures need retry — Pacific Solar Co",
        severity: "critical",
        href: "/front-office/lead-delivery?status=failed",
        at: new Date(Date.now() - 15 * 60000).toISOString(),
      },
      {
        id: "task-2",
        title: "GHL connection degraded for Desert HVAC Pros",
        severity: "high",
        href: "/front-office/trust",
        at: new Date(Date.now() - 45 * 60000).toISOString(),
      },
      {
        id: "task-3",
        title: "Order ORD-1042 awaiting compliance review",
        severity: "medium",
        href: "/front-office/orders",
        at: new Date(Date.now() - 2 * 3600000).toISOString(),
      },
    ],
    recentDeliveries: [
      {
        id: "del-1",
        leadName: "Maria Gonzalez",
        clientName: "Summit Insurance Group",
        status: "delivered",
        at: new Date(Date.now() - 8 * 60000).toISOString(),
        campaign: "Fresh Insurance TX",
      },
      {
        id: "del-2",
        leadName: "James Chen",
        clientName: "Pacific Solar Co",
        status: "in_progress",
        at: new Date(Date.now() - 22 * 60000).toISOString(),
        campaign: "Q2 Aged Solar",
      },
      {
        id: "del-3",
        leadName: "Robert Williams",
        clientName: "Desert HVAC Pros",
        status: "failed",
        at: new Date(Date.now() - 35 * 60000).toISOString(),
        campaign: "HVAC Summer Push",
      },
      {
        id: "del-4",
        leadName: "Sarah Kim",
        clientName: "Summit Insurance Group",
        status: "delivered",
        at: new Date(Date.now() - 51 * 60000).toISOString(),
        campaign: "Fresh Insurance TX",
      },
      {
        id: "del-5",
        leadName: "David Martinez",
        clientName: "Pacific Solar Co",
        status: "delivered",
        at: new Date(Date.now() - 78 * 60000).toISOString(),
        campaign: "Q2 Aged Solar",
      },
    ],
  };
}
