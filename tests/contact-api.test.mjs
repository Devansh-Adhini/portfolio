import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { createContactHandler } from "../lib/contact-api.mjs";

const validMessage = {
  name: "  Ada Lovelace  ",
  email: "  ada@example.com  ",
  message: "  I would like to discuss a portfolio project.  ",
};

/** Exercise actual HTTP parsing and response behavior without contacting SMTP. */
async function startApi(t, { configured = true, send, now } = {}) {
  const sent = [];
  const mailer = {
    configured,
    async send(fields) {
      sent.push(fields);
      return send ? send(fields) : { accepted: true };
    },
  };
  let handler;
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createContactHandler({
    mailer,
    allowedOrigins: [origin],
    ...(now ? { now } : {}),
  });
  t.after(async () => {
    const closed = new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server.closeAllConnections();
    await closed;
  });

  function request({
    method = "POST",
    payload = validMessage,
    rawBody,
    headers = {},
    chunks,
  } = {}) {
    const body = rawBody ?? JSON.stringify(payload);
    const requestHeaders = {
      Origin: origin,
      "Content-Type": "application/json",
      ...(chunks ? {} : { "Content-Length": Buffer.byteLength(body) }),
      ...headers,
    };
    for (const name of Object.keys(requestHeaders)) {
      if (requestHeaders[name] === undefined) delete requestHeaders[name];
    }
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        `${origin}/api/contact`,
        { method, headers: requestHeaders, agent: false },
        (incoming) => {
          const responseChunks = [];
          incoming.on("data", (chunk) => responseChunks.push(chunk));
          incoming.once("error", reject);
          incoming.once("end", () => {
            const text = Buffer.concat(responseChunks).toString("utf8");
            resolve({
              status: incoming.statusCode,
              headers: incoming.headers,
              body: text ? JSON.parse(text) : undefined,
              text,
            });
          });
        },
      );
      outgoing.once("error", reject);
      outgoing.setTimeout(3000, () => {
        outgoing.destroy(new Error("Local contact API request timed out."));
      });
      if (chunks) {
        for (const chunk of chunks) outgoing.write(chunk);
        outgoing.end();
      } else outgoing.end(body);
    });
  }
  return { request, sent };
}

test("accepts a trimmed message and passes only contact fields to SMTP", async (t) => {
  const api = await startApi(t);
  const response = await api.request({
    payload: {
      ...validMessage,
      to: "other@example.com",
      cc: "copy@example.com",
      from: "spoofed@example.com",
      subject: "Visitor-controlled subject",
      html: "<script>untrusted()</script>",
    },
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true });
  assert.deepEqual(api.sent, [{
    name: "Ada Lovelace",
    email: "ada@example.com",
    message: "I would like to discuss a portfolio project.",
  }]);
  assert.match(response.headers["content-type"], /^application\/json/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
});

test("rejects unsupported methods before sending mail", async (t) => {
  const api = await startApi(t);
  for (const method of ["GET", "PUT", "OPTIONS"]) {
    const response = await api.request({ method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.allow, "POST");
  }
  assert.equal(api.sent.length, 0);
});

test("requires an allowed origin and rejects cross-site requests", async (t) => {
  const api = await startApi(t);
  for (const headers of [
    { Origin: undefined },
    { Origin: "null" },
    { Origin: "https://unrelated.example" },
    { "Sec-Fetch-Site": "cross-site" },
  ]) {
    const response = await api.request({ headers });
    assert.equal(response.status, 403);
    assert.equal(response.body.success, false);
  }
  assert.equal(api.sent.length, 0);
});

test("accepts only JSON request bodies", async (t) => {
  const api = await startApi(t);
  for (const type of [undefined, "text/plain", "application/x-www-form-urlencoded"]) {
    const response = await api.request({ headers: { "Content-Type": type } });
    assert.equal(response.status, 415);
  }
  assert.equal(api.sent.length, 0);
});

test("validates field types, trimmed bounds, email syntax, and header injection", async (t) => {
  const api = await startApi(t);
  const invalidPayloads = [
    null,
    [],
    {},
    { ...validMessage, name: 42 },
    { ...validMessage, name: "   " },
    { ...validMessage, name: "n".repeat(101) },
    { ...validMessage, name: "Ada\r\nBcc: victim@example.com" },
    { ...validMessage, name: "Ada\0Lovelace" },
    { ...validMessage, email: "invalid" },
    { ...validMessage, email: "name@localhost" },
    { ...validMessage, email: "<ada@example.com>" },
    { ...validMessage, email: "a,b@example.com" },
    { ...validMessage, email: "a;b@example.com" },
    { ...validMessage, email: `${"a".repeat(243)}@example.com` },
    { ...validMessage, email: "ada@example.com\n" },
    { ...validMessage, email: "ada@exa\0mple.com" },
    { ...validMessage, message: "   short   " },
    { ...validMessage, message: "m".repeat(5001) },
    { ...validMessage, message: "A long enough\0message" },
  ];
  for (const payload of invalidPayloads) {
    const response = await api.request({ payload });
    assert.equal(response.status, 400, JSON.stringify(payload)?.slice(0, 100));
  }
  assert.equal(api.sent.length, 0);

  const boundaryResponse = await api.request({ payload: {
    name: "n".repeat(100),
    email: "ada@example.com",
    message: "m".repeat(5000),
  } });
  assert.equal(boundaryResponse.status, 200);
  assert.equal(api.sent.length, 1);
});

test("returns a safe 400 for malformed or empty JSON", async (t) => {
  const api = await startApi(t);
  for (const rawBody of ["", "{", "not JSON", '{"name":']) {
    const response = await api.request({ rawBody });
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.doesNotMatch(response.text, /SyntaxError|JSON\.parse|stack/i);
  }
  assert.equal(api.sent.length, 0);
});

test("limits oversized bodies with both Content-Length and chunked encoding", async (t) => {
  const api = await startApi(t);
  const rawBody = JSON.stringify({ ...validMessage, message: "x".repeat(17000) });
  const sized = await api.request({ rawBody });
  assert.equal(sized.status, 413);
  assert.equal(sized.body.success, false);

  const chunks = Array.from({ length: 5 }, () => Buffer.alloc(4096, "x"));
  const streamed = await api.request({ chunks });
  assert.equal(streamed.status, 413);
  assert.equal(streamed.body.success, false);
  assert.equal(api.sent.length, 0);
});

test("silently accepts honeypots without sending mail, even without SMTP setup", async (t) => {
  const api = await startApi(t, { configured: false });
  const response = await api.request({ payload: { _honey: "  bot-filled field  " } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true });
  assert.equal(api.sent.length, 0);
});

test("reports missing SMTP configuration without attempting delivery", async (t) => {
  const api = await startApi(t, { configured: false });
  const response = await api.request();
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { success: false, code: "EMAIL_NOT_CONFIGURED" });
  assert.equal(api.sent.length, 0);
});

test("SMTP exceptions and non-acceptance return sanitized 502 responses", async (t) => {
  for (const outcome of [undefined, { accepted: false }, { accepted: "true" }, "throw"]) {
    const api = await startApi(t, {
      send: async () => {
        if (outcome === "throw") throw new Error("SECRET_SMTP_PASSWORD user@private.example");
        return outcome;
      },
    });
    const response = await api.request();
    assert.equal(response.status, 502);
    assert.equal(response.body.success, false);
    assert.doesNotMatch(response.text, /SECRET_SMTP_PASSWORD|user@private\.example|Error:|stack/);
    assert.equal(api.sent.length, 1);
  }
});

test("rate limits the direct client despite spoofed forwarding headers and expires the limit", async (t) => {
  let clock = 1_000_000;
  const api = await startApi(t, { now: () => clock });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await api.request({ headers: {
      "X-Forwarded-For": `198.51.100.${attempt + 1}`,
      "X-Real-IP": `203.0.113.${attempt + 1}`,
    } });
    assert.equal(response.status, 200);
  }
  const limited = await api.request({ headers: { "X-Forwarded-For": "192.0.2.99" } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "600");
  assert.equal(api.sent.length, 5);

  clock += 30_000;
  const stillLimited = await api.request();
  assert.equal(stillLimited.status, 429);
  assert.equal(stillLimited.headers["retry-after"], "570");
  clock += 570_000;
  const afterExpiry = await api.request();
  assert.equal(afterExpiry.status, 200);
  assert.equal(api.sent.length, 6);
});

test("failed SMTP attempts still consume the abuse limit", async (t) => {
  const api = await startApi(t, { send: async () => { throw new Error("SMTP offline"); } });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await api.request()).status, 502);
  }
  assert.equal((await api.request()).status, 429);
  assert.equal(api.sent.length, 5);
});

test("reserves rate-limit slots before concurrent SMTP sends finish", async (t) => {
  let release;
  const deliveryGate = new Promise((resolve) => { release = resolve; });
  const api = await startApi(t, {
    send: async () => {
      await deliveryGate;
      return { accepted: true };
    },
  });
  const pending = Array.from({ length: 6 }, () => api.request());
  try {
    // The five SMTP sends remain pending; only the refused sixth can finish.
    const first = await Promise.race(pending);
    assert.equal(first.status, 429);
    assert.equal(api.sent.length, 5);
  } finally {
    release();
  }
  const responses = await Promise.all(pending);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 200, 200, 200, 200, 429]);
  assert.equal(api.sent.length, 5);
});
