export async function sendToMeta(metaDatasetId: string, accessToken: string, body: unknown) {
  const url = `https://graph.facebook.com/v22.0/${metaDatasetId}/events?access_token=${accessToken}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseJson = await response.json().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    body: responseJson,
  };
}