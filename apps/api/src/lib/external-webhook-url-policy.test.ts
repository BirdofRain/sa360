import assert from "node:assert/strict";
import test from "node:test";

import {
  externalWebhookAddressIsBlocked,
  externalWebhookRedirectDisposition,
  validateExternalWebhookUrl,
  type ExternalWebhookResolvedAddress,
  type ExternalWebhookResolver,
} from "./external-webhook-url-policy.js";

const PUBLIC: ExternalWebhookResolvedAddress = { address: "8.8.8.8", family: 4 };

function resolver(addresses: readonly ExternalWebhookResolvedAddress[] | Error): ExternalWebhookResolver {
  return async () => {
    if (addresses instanceof Error) throw addresses;
    return addresses;
  };
}

async function reject(raw: string, code: string, resolve: ExternalWebhookResolver = resolver([PUBLIC])) {
  const result = await validateExternalWebhookUrl(raw, resolve);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, code);
}

test("external webhook URLs refuse private networks, userinfo, non-HTTPS, and internal names", async () => {
  let lookups = 0;
  const counting: ExternalWebhookResolver = async () => {
    lookups += 1;
    return [PUBLIC];
  };
  await reject("http://hooks.example.com/lead", "not_https", counting);
  await reject("https://user:secret@hooks.example.com/lead", "userinfo", counting);
  await reject("https://user@hooks.example.com/lead", "userinfo", counting);
  await reject("https://hooks.example.com/lead#frag", "fragment", counting);
  await reject("https://localhost/lead", "internal_hostname", counting);
  await reject("https://foo.localhost/lead", "internal_hostname", counting);
  await reject("https://metadata.google.internal/computeMetadata/v1/", "internal_hostname", counting);
  await reject("https://example.internal/lead", "internal_hostname", counting);
  await reject("https://169.254.169.254/latest/meta-data", "private_address", counting);
  await reject("https://127.0.0.1/lead", "private_address", counting);
  await reject("https://10.1.2.3/lead", "private_address", counting);
  await reject("https://192.168.0.5/lead", "private_address", counting);
  await reject("https://172.16.0.9/lead", "private_address", counting);
  await reject("https://100.64.0.1/lead", "private_address", counting);
  await reject("https://[::1]/lead", "private_address", counting);
  await reject("https://[fd00::1]/lead", "private_address", counting);
  await reject("https://[fe80::1]/lead", "private_address", counting);
  assert.equal(new URL("https://2130706433/lead").hostname, "127.0.0.1");
  await reject("https://2130706433/lead", "private_address", counting);
  assert.equal(new URL("https://0x7f000001/lead").hostname, "127.0.0.1");
  await reject("https://0x7f000001/lead", "private_address", counting);
  assert.equal(new URL("https://127.1/lead").hostname, "127.0.0.1");
  await reject("https://127.1/lead", "private_address", counting);
  assert.equal(new URL("https://0177.0.0.1/lead").hostname, "127.0.0.1");
  await reject("https://0177.0.0.1/lead", "private_address", counting);
  await reject("https://[::ffff:7f00:1]/lead", "private_address", counting);
  await reject("https://08.8.8.8/lead", "invalid_url", counting);
  assert.equal(lookups, 0);
  assert.equal(externalWebhookAddressIsBlocked("169.254.169.254"), true);
  assert.equal(externalWebhookAddressIsBlocked("::ffff:127.0.0.1"), true);
  assert.equal(externalWebhookAddressIsBlocked("::ffff:7f00:1"), true);
  assert.equal(externalWebhookAddressIsBlocked("::ffff:8.8.8.8"), false);
  assert.equal(externalWebhookAddressIsBlocked("8.8.8.8"), false);
  await reject("https://[::ffff:127.0.0.1]/lead", "private_address", counting);
});

test("DNS answers are pinned, and any private answer rejects the name", async () => {
  const accepted = await validateExternalWebhookUrl(
    "https://hooks.example.com:8443/hook/path-token?x=1",
    resolver([PUBLIC])
  );
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.hostname, "hooks.example.com");
    assert.equal(accepted.canonicalUrl, "https://hooks.example.com:8443/hook/path-token?x=1");
    assert.deepEqual(accepted.addresses, ["8.8.8.8"]);
  }

  await reject("https://hooks.example.com/lead", "dns_private", resolver([{ address: "10.0.0.5", family: 4 }]));
  await reject(
    "https://hooks.example.com/lead",
    "dns_private",
    resolver([{ address: "169.254.169.254", family: 4 }])
  );
  await reject(
    "https://hooks.example.com/lead",
    "dns_private",
    resolver([PUBLIC, { address: "192.168.1.9", family: 4 }])
  );
  await reject("https://hooks.example.com/lead", "dns_empty", resolver([]));
  await reject("https://hooks.example.com/lead", "dns_failed", resolver(new Error("servfail")));

  let lookups = 0;
  const literal = await validateExternalWebhookUrl("https://8.8.8.8/hook", async () => {
    lookups += 1;
    return [];
  });
  assert.equal(literal.ok, true);
  assert.equal(lookups, 0);
  const publicV6 = await validateExternalWebhookUrl("https://[2606:4700:4700::1111]/hook", async () => {
    lookups += 1;
    return [];
  });
  assert.equal(publicV6.ok, true);
  assert.equal(lookups, 0);
});

test("redirects are refused and are not followed", () => {
  for (const status of [301, 302, 303, 307, 308]) {
    assert.equal(externalWebhookRedirectDisposition(status), "refused");
  }
  assert.equal(externalWebhookRedirectDisposition(200), "not_a_redirect");
  assert.equal(externalWebhookRedirectDisposition(404), "not_a_redirect");
});
