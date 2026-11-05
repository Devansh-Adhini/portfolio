import test from "node:test";
import assert from "node:assert/strict";
import { initContactForm, submitContact } from "../public/contact.js";

const message = {
  name: "  Ada Lovelace  ",
  email: "  ada@example.com ",
  message: "  I’d like to discuss a project.  ",
};

test("submits only trimmed contact fields to the local API", async () => {
  let request;
  const result = await submitContact(
    { ...message, recipient: "someone-else@example.com", _captcha: "false" },
    {
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({ success: true }) };
      },
    },
  );

  assert.deepEqual(result, { accepted: true });
  assert.equal(request.url, "/api/contact");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), {
    name: "Ada Lovelace",
    email: "ada@example.com",
    message: "I’d like to discuss a project.",
  });
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.equal(request.options.mode, "same-origin");
});

test("missing sender setup and rate limits produce actionable errors", async () => {
  for (const [status, expected] of [
    [503, /temporarily unavailable/],
    [429, /Too many messages/],
  ]) {
    await assert.rejects(
      submitContact(message, {
        fetchImpl: async () => ({ ok: false, status }),
      }),
      expected,
    );
  }
});

test("rejects HTTP failures even if the response could contain success", async () => {
  await assert.rejects(
    submitContact(message, {
      fetchImpl: async () => ({
        ok: false,
        json: async () => ({ success: true }),
      }),
    }),
    /couldn’t submit/,
  );
});

test("rejects provider failures without exposing the provider's message", async () => {
  for (const success of [false, "false", "true", undefined, 1]) {
    await assert.rejects(
      submitContact(message, {
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            success,
            message: "UNTRUSTED_PROVIDER_MESSAGE",
          }),
        }),
      }),
      (error) =>
        /wasn’t accepted/.test(error.message) &&
        !error.message.includes("UNTRUSTED_PROVIDER_MESSAGE"),
    );
  }
});

test("turns network and malformed JSON failures into actionable errors", async () => {
  for (const fetchImpl of [
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Bad JSON");
      },
    }),
  ]) {
    await assert.rejects(
      submitContact(message, { fetchImpl }),
      /couldn’t confirm submission/,
    );
  }
});

test("honeypot silently skips requests and invalid fields never reach the provider", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
  };
  assert.deepEqual(
    await submitContact({ ...message, _honey: "spam" }, { fetchImpl }),
    { ignored: true },
  );
  await assert.rejects(
    submitContact({ ...message, name: "   " }, { fetchImpl }),
    /Please enter/,
  );
  await assert.rejects(
    submitContact({ ...message, email: "invalid" }, { fetchImpl }),
    /valid email/,
  );
  assert.equal(requests, 0);
});

test("initialization tolerates an absent form", () => {
  assert.doesNotThrow(() => initContactForm(null));
});
