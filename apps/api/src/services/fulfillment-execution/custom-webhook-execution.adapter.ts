import { isCustomWebhookDeliveryEnabled } from "../../lib/custom-webhook-env.js";
import { customWebhookEndpointHost } from "../../lib/custom-webhook-secret.js";
import { validateDeliveryTargetMetadata } from "../../lib/delivery-target-metadata.validation.js";
import type { DeliveryAdapterValidateResult } from "../fulfillment-shadow/delivery-adapter.registry.js";
import type { ExecutionAdapterContract } from "./execution-adapter.registry.js";

/**
 * Simulate-only outbound custom webhook adapter.
 * Live delivery is omitted. This module does not open a socket.
 * SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED must be the exact string "true".
 */

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,200}$/;

function endpointHostFromMetadata(metadata: Record<string, unknown>): string | null {
  const endpointUrl = typeof metadata.endpointUrl === "string" ? metadata.endpointUrl.trim() : "";
  if (endpointUrl) return customWebhookEndpointHost(endpointUrl);
  const host = typeof metadata.endpointHost === "string" ? metadata.endpointHost.trim().toLowerCase() : "";
  if (!host || host.includes("/") || host.includes("@") || host.includes("?") || host.includes(":")) {
    return null;
  }
  return host;
}

function safeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!SAFE_TOKEN.test(trimmed)) return null;
  if (trimmed.includes("@") || trimmed.includes("/") || trimmed.includes("?")) return null;
  return trimmed;
}

function signingMaterialPresent(metadata: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(metadata)) {
    if (!/secret|authorization|token|ciphertext|credential|password/i.test(key)) continue;
    if (typeof value === "string" && value.trim()) return true;
    if (value != null && typeof value !== "string") return true;
  }
  return false;
}

export const customWebhookExecutionAdapter: ExecutionAdapterContract = {
  adapterKey: "webhook.generic.v1",
  validateTarget({ configMetadata }): DeliveryAdapterValidateResult {
    if (!isCustomWebhookDeliveryEnabled()) {
      return { ok: false, readinessStatus: "not_configured", reason: "custom_webhook_disabled" };
    }
    const metadataCheck = validateDeliveryTargetMetadata(configMetadata);
    if (!metadataCheck.ok) {
      return { ok: false, readinessStatus: "not_configured", reason: "secret_metadata" };
    }
    if (!endpointHostFromMetadata(configMetadata)) {
      return { ok: false, readinessStatus: "not_configured", reason: "endpoint_not_https" };
    }
    return { ok: true, readinessStatus: "ready_for_simulation" };
  },
  buildPayload(input) {
    return {
      adapterKey: "webhook.generic.v1",
      allocationId: input.allocationId,
      instructionId: input.instructionId,
      endpointHost: endpointHostFromMetadata(input.configMetadata),
      method: "POST",
      signingSecretPresent: signingMaterialPresent(input.configMetadata),
      simulation: true,
      externalCallExecuted: false,
    };
  },
  async simulate({ payload }) {
    if (!isCustomWebhookDeliveryEnabled()) {
      return {
        ok: false,
        simulation: true,
        errorCode: "custom_webhook_disabled",
        errorSummary: "Custom webhook delivery is disabled.",
        retryable: false,
      };
    }
    const endpointHost =
      typeof payload.endpointHost === "string" &&
      payload.endpointHost.trim() &&
      !payload.endpointHost.includes("/") &&
      !payload.endpointHost.includes("@") &&
      !payload.endpointHost.includes("?") &&
      !payload.endpointHost.includes(":")
        ? payload.endpointHost.trim().toLowerCase()
        : null;
    if (!endpointHost) {
      return {
        ok: false,
        simulation: true,
        errorCode: "endpoint_not_https",
        errorSummary: "Webhook endpoint must be an https host.",
        retryable: false,
      };
    }
    return {
      ok: true,
      simulation: true,
      sanitizedResponse: {
        adapterKey: "webhook.generic.v1",
        simulation: true,
        method: "POST",
        endpointHost,
        instructionId: safeToken(payload.instructionId),
        allocationId: safeToken(payload.allocationId),
        signingSecretPresent: payload.signingSecretPresent === true,
        externalCallExecuted: false,
        networkAttempted: false,
      },
      externalReference: null,
    };
  },
};
