export type LeadCaptureDataApiLeadRecord = Record<string, unknown> & {
  _meta?: {
    lead_id?: string;
    funnel_id?: string;
    form_id?: string;
    updated_at?: string;
    version?: string;
  };
};

export type LeadCaptureDataApiLeadsPage = {
  data: LeadCaptureDataApiLeadRecord[];
  next_cursor: string | null;
  has_more: boolean;
};

export type LeadCaptureDataApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "server_error"
  | "malformed_response"
  | "transport_error"
  | "disabled";

export type LeadCaptureDataApiClientError = {
  ok: false;
  code: LeadCaptureDataApiErrorCode;
  httpStatus: number | null;
  message: string;
  correlationId: string;
  retryAfterMs: number | null;
};

export type LeadCaptureDataApiClientSuccess<T> = {
  ok: true;
  data: T;
  correlationId: string;
  httpStatus: number;
};

export type LeadCaptureDataApiClientResult<T> =
  | LeadCaptureDataApiClientSuccess<T>
  | LeadCaptureDataApiClientError;

export type LeadCaptureDataApiListLeadsInput = {
  since?: string | null;
  limit?: number;
  funnelId?: string | null;
};

export type LeadCaptureDataApiTransport = typeof fetch;
