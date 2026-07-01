"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CreateLeadOrderInput, FrontOfficeRole } from "@/lib/front-office/types";

const EMPTY: CreateLeadOrderInput = {
  clientName: "",
  niche: "",
  states: [],
  state: "",
  volume: 100,
  campaignType: "Fresh leads",
  crmPackage: "GHL Starter + SA360 AI",
  aiVoiceAddon: false,
  deliveryDestination: "",
  notes: "",
};

export function FoNewOrderForm({
  role,
  onCreated,
}: {
  role: FrontOfficeRole;
  onCreated?: () => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [statesText, setStatesText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const states = statesText
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const payload: CreateLeadOrderInput = {
      ...form,
      states,
      state: states[0] ?? "",
    };
    try {
      const res = await fetch("/api/front-office/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setForm(EMPTY);
        setStatesText("");
        setMessage(`Order ${data.order.orderNumber ?? data.order.id} submitted.`);
        onCreated?.();
      } else {
        setMessage(data.error ?? "Failed to create order.");
      }
    } catch {
      setMessage("Failed to create order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-slate-900">
        {role === "client" ? "Submit new order" : "Create order (admin)"}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {role === "admin" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="clientName">Client name</Label>
            <Input
              id="clientName"
              required
              value={form.clientName}
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            />
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="niche">Niche / product</Label>
          <Input
            id="niche"
            required
            value={form.niche}
            onChange={(e) => setForm({ ...form, niche: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="productType">Product type (optional)</Label>
          <Input
            id="productType"
            value={form.productType ?? ""}
            onChange={(e) => setForm({ ...form, productType: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="states">State(s)</Label>
          <Input
            id="states"
            required
            placeholder="TX, FL, AZ"
            value={statesText}
            onChange={(e) => setStatesText(e.target.value.toUpperCase())}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="volume">Lead volume</Label>
          <Input
            id="volume"
            type="number"
            min={1}
            required
            value={form.volume}
            onChange={(e) => setForm({ ...form, volume: Number(e.target.value) })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="campaignType">Campaign type</Label>
          <Select
            id="campaignType"
            value={form.campaignType}
            onChange={(e) => setForm({ ...form, campaignType: e.target.value })}
          >
            <option value="Fresh leads">Fresh leads</option>
            <option value="Aged leads">Aged leads</option>
            <option value="Live transfer">Live transfer</option>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="crmPackage">CRM package</Label>
          <Select
            id="crmPackage"
            value={form.crmPackage}
            onChange={(e) => setForm({ ...form, crmPackage: e.target.value })}
          >
            <option value="GHL Starter">GHL Starter</option>
            <option value="GHL Starter + SA360 AI">GHL Starter + SA360 AI</option>
            <option value="GHL Pro + SA360 routing">GHL Pro + SA360 routing</option>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="requestedStartDate">Requested start date</Label>
          <Input
            id="requestedStartDate"
            type="date"
            value={form.requestedStartDate ?? ""}
            onChange={(e) => setForm({ ...form, requestedStartDate: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="deliveryDestination">Delivery destination</Label>
          <Input
            id="deliveryDestination"
            required
            placeholder="GHL subaccount · location name"
            value={form.deliveryDestination}
            onChange={(e) => setForm({ ...form, deliveryDestination: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            rows={3}
            placeholder="Campaign goals, pacing, or setup notes"
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <input
            id="aiVoiceAddon"
            type="checkbox"
            checked={form.aiVoiceAddon}
            onChange={(e) => setForm({ ...form, aiVoiceAddon: e.target.checked })}
            className="size-4 rounded border-slate-300"
          />
          <Label htmlFor="aiVoiceAddon" className="font-normal">
            AI / voice add-on
          </Label>
        </div>
      </div>
      {message ? <p className="text-xs text-slate-600">{message}</p> : null}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : role === "client" ? "Submit order" : "Create order"}
      </Button>
    </form>
  );
}
