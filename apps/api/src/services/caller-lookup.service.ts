export type CallerLookupRecord = {
  first_name: string;
  last_name: string;
  lead_state: string;
  ghl_contact_id: string;
  assigned_agent_name: string;
  lifecycle_stage: string;
  appointment_status: string;
  policy_status: string;
};

export interface CallerLookupService {
  lookupByPhone(phoneE164: string): Promise<CallerLookupRecord | null>;
}

type MakeLookupApiResponse = {
  status?: string;
  results?: {
    data?: {
      first_name?: string;
      last_name?: string;
      lead_state?: string;
      ghl_contact_id?: string;
      assigned_agent_name?: string;
      lifecycle_stage?: string;
      appointment_status?: string;
      policy_status?: string;
    };
  };
};

function pickStr(v: unknown): string {
  if (typeof v === "string") {
    return v;
  }
  if (v === null || v === undefined) {
    return "";
  }
  return String(v);
}

function mapMakeData(data: NonNullable<MakeLookupApiResponse["results"]>["data"]): CallerLookupRecord | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    first_name: pickStr(data.first_name),
    last_name: pickStr(data.last_name),
    lead_state: pickStr(data.lead_state),
    ghl_contact_id: pickStr(data.ghl_contact_id),
    assigned_agent_name: pickStr(data.assigned_agent_name),
    lifecycle_stage: pickStr(data.lifecycle_stage),
    appointment_status: pickStr(data.appointment_status),
    policy_status: pickStr(data.policy_status),
  };
}

export function createMakeCallerLookupService(
  baseUrl: string,
  timeoutMs: number
): CallerLookupService {
  return {
    async lookupByPhone(phoneE164: string): Promise<CallerLookupRecord | null> {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: phoneE164 }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return null;
      }

      const json = (await response.json().catch(() => null)) as MakeLookupApiResponse | null;
      if (!json || json.status !== "success") {
        return null;
      }

      return mapMakeData(json.results?.data);
    },
  };
}

/** Factory: only `"make"` mode is wired in this version; other modes resolve to a no-op lookup. */
export function createCallerLookupService(
  lookupMode: string,
  makeLookupUrl: string | undefined,
  makeTimeoutMs: number
): CallerLookupService {
  if (lookupMode === "make" && makeLookupUrl) {
    return createMakeCallerLookupService(makeLookupUrl, makeTimeoutMs);
  }

  return {
    async lookupByPhone(_phoneE164: string): Promise<CallerLookupRecord | null> {
      return null;
    },
  };
}
