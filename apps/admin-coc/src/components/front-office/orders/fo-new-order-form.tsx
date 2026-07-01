"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { CreateLeadOrderInput } from "@/lib/front-office/types";

const EMPTY: CreateLeadOrderInput = {
  clientName: "",
  niche: "",
  state: "",
  volume: 100,
  campaignType: "Fresh leads",
  crmPackage: "GHL Starter + SA360 AI",
  aiVoiceAddon: false,
  deliveryDestination: "",
};

export function FoNewOrderForm({ onCreated }: { onCreated?: () => void }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/front-office/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.ok) {
        setForm(EMPTY);
        setMessage(`Order ${data.order.id} created (mock).`);
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
      <h2 className="text-sm font-semibold text-slate-900">New order (mock)</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="clientName">Client name</Label>
          <Input
            id="clientName"
            required
            value={form.clientName}
            onChange={(e) => setForm({ ...form, clientName: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="niche">Niche</Label>
          <Input
            id="niche"
            required
            value={form.niche}
            onChange={(e) => setForm({ ...form, niche: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="state">State</Label>
          <Input
            id="state"
            required
            maxLength={2}
            value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="volume">Volume</Label>
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
      {message ? (
        <p className="text-xs text-slate-600">{message}</p>
      ) : null}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create order"}
      </Button>
    </form>
  );
}
