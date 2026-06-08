/**
 * Minimal transactional email via [Resend](https://resend.com) HTTP API.
 * No send attempt unless RESEND_API_KEY and SA360_TRANSACTIONAL_EMAIL_FROM are set.
 */

export type SendTransactionalEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

export type SendTransactionalEmailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; skipped?: boolean };

export function isTransactionalEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.SA360_TRANSACTIONAL_EMAIL_FROM?.trim()
  );
}

export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput,
  fetchImpl: typeof fetch = fetch
): Promise<SendTransactionalEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.SA360_TRANSACTIONAL_EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    return {
      ok: false,
      skipped: true,
      error: "Transactional email not configured (RESEND_API_KEY, SA360_TRANSACTIONAL_EMAIL_FROM).",
    };
  }

  const to = Array.isArray(input.to) ? input.to : [input.to];
  const recipients = to.map((e) => e.trim()).filter(Boolean);
  if (recipients.length === 0) {
    return { ok: false, error: "No recipients" };
  }

  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `Resend ${res.status}: ${bodyText.slice(0, 300)}`,
      };
    }

    try {
      const parsed = JSON.parse(bodyText) as { id?: string };
      return { ok: true, id: parsed.id };
    } catch {
      return { ok: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 300) };
  }
}
