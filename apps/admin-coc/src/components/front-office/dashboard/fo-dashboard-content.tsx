"use client";

import { useState } from "react";

import { FoAvailabilityToggle } from "@/components/front-office/shared/fo-availability-toggle";
import { FoFilterBar } from "@/components/front-office/shared/fo-filter-bar";
import { FoKpiGrid } from "@/components/front-office/shared/fo-kpi-grid";
import { FoPreviewBanner } from "@/components/front-office/shared/fo-preview-banner";
import { FoRecentDeliveryFeed } from "@/components/front-office/dashboard/fo-recent-delivery-feed";
import { FoUrgentTasksPanel } from "@/components/front-office/dashboard/fo-urgent-tasks-panel";
import type { FrontOfficeDashboardResponse } from "@/lib/front-office/types";

export function FoDashboardContent({ data }: { data: FrontOfficeDashboardResponse }) {
  const [availability, setAvailability] = useState(data.availability);

  return (
    <div className="space-y-6">
      <FoPreviewBanner dataSource={data.dataSource} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <FoAvailabilityToggle value={availability} onChange={setAvailability} />
        <p className="text-xs text-slate-500">
          Updated {new Date(data.generatedAt).toLocaleString()}
        </p>
      </div>
      <FoFilterBar
        campaigns={data.filters.campaigns}
        clients={data.filters.clients}
        dateRanges={data.filters.dateRanges}
      />
      <FoKpiGrid kpis={data.kpis} />
      <div className="grid gap-4 lg:grid-cols-2">
        <FoUrgentTasksPanel tasks={data.urgentTasks} />
        <FoRecentDeliveryFeed events={data.recentDeliveries} />
      </div>
    </div>
  );
}
