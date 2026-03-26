self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function buildJsonResponse(value) {
  return new Response(JSON.stringify(value, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function persistCaptureArtifacts(record) {
  const cache = await caches.open("here-ssx-collector-v1");
  const latestUrl = new URL("./__collector__/latest.json", self.registration.scope).toString();
  const requestUrl = new URL(`./__collector__/${encodeURIComponent(record.requestId)}.json`, self.registration.scope).toString();
  await cache.put(latestUrl, buildJsonResponse(record));
  await cache.put(requestUrl, buildJsonResponse(record));
}

async function postToCollector(collectorUrl, payload) {
  try {
    const response = await fetch(collectorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let json = null;

    try {
      json = JSON.parse(text);
    } catch (error) {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      text,
      json
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url: collectorUrl,
      error: String(error)
    };
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "collector_capture") {
    return;
  }

  event.waitUntil((async () => {
    const requestId = data.requestId || crypto.randomUUID();
    const collectorResult = await postToCollector(data.collectorUrl, data.payload);
    const record = {
      requestId,
      capturedAt: new Date().toISOString(),
      collectorUrl: data.collectorUrl,
      payload: data.payload,
      collectorResult
    };

    await persistCaptureArtifacts(record);

    if (event.source && typeof event.source.postMessage === "function") {
      event.source.postMessage({
        type: "collector_result",
        requestId,
        result: collectorResult
      });
      return;
    }

    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });
    for (const client of clients) {
      client.postMessage({
        type: "collector_result",
        requestId,
        result: collectorResult
      });
    }
  })());
});
