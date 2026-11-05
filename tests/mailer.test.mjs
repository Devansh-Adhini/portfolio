import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_RECIPIENT,
  createContactMailer,
  MailerConfigurationError,
  MailerDeliveryError,
} from "../lib/mailer.mjs";

const env = {
  SMTP_USER: "portfolio@example.com",
  SMTP_PASS: "TEST_SMTP_SECRET",
};
const message = {
  name: "  Ada Lovelace  ",
  email: "  ada@example.com ",
  message: "  I would like to discuss a project.  ",
};

function mockMailer({ settings = env, sendResult, sendError, verifyError } = {}) {
  const calls = { options: [], messages: [], verifications: 0 };
  const mailer = createContactMailer({
    env: settings,
    createTransport(options) {
      calls.options.push(options);
      return {
        async sendMail(payload) {
          calls.messages.push(payload);
          if (sendError) throw sendError;
          return sendResult ?? { accepted: [CONTACT_RECIPIENT], rejected: [] };
        },
        async verify() {
          calls.verifications += 1;
          if (verifyError) throw verifyError;
          return true;
        },
      };
    },
  });
  return { mailer, calls };
}

test("configures encrypted SMTP with bounded timeouts and no eager network calls", () => {
  const { mailer, calls } = mockMailer();
  assert.equal(mailer.configured, true);
  assert.equal(calls.messages.length, 0);
  assert.equal(calls.verifications, 0);
  assert.deepEqual(calls.options, [
    {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      dnsTimeout: 8000,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 12000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      maxRecipients: 1,
    },
  ]);
});

test("requires STARTTLS for other ports and permits a configured sender", async () => {
  const { mailer, calls } = mockMailer({
    settings: {
      ...env,
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_FROM: "contact@example.com",
    },
  });
  await mailer.send(message);
  assert.equal(calls.options[0].host, "smtp.example.com");
  assert.equal(calls.options[0].port, 587);
  assert.equal(calls.options[0].secure, false);
  assert.equal(calls.options[0].requireTLS, true);
  assert.equal(calls.messages[0].from, "contact@example.com");
});

test("sends plaintext only to the fixed recipient and ignores arbitrary mail fields", async () => {
  const { mailer, calls } = mockMailer();
  const result = await mailer.send({
    ...message,
    from: "attacker@example.net",
    to: "attacker@example.net",
    recipient: "attacker@example.net",
    cc: "attacker@example.net",
    bcc: "attacker@example.net",
    subject: "Injected subject",
    html: "<script>untrusted</script>",
    attachments: [{ path: "file:///etc/passwd" }],
    headers: { "X-Injected": "value" },
    envelope: { to: ["attacker@example.net"] },
  });
  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(calls.messages, [
    {
      from: env.SMTP_USER,
      to: CONTACT_RECIPIENT,
      replyTo: { name: "Ada Lovelace", address: "ada@example.com" },
      subject: "New portfolio message",
      text: "Portfolio contact message\n\nName: Ada Lovelace\nEmail: ada@example.com\n\nI would like to discuss a project.",
    },
  ]);
});

test("SMTP acceptance must explicitly include the fixed recipient and no rejection", async () => {
  for (const sendResult of [
    {},
    { accepted: [] },
    { accepted: ["someone-else@example.com"], rejected: [] },
    { accepted: [CONTACT_RECIPIENT], rejected: [CONTACT_RECIPIENT] },
    { accepted: [CONTACT_RECIPIENT], rejected: ["unexpected@example.com"] },
    { accepted: CONTACT_RECIPIENT },
  ]) {
    const { mailer } = mockMailer({ sendResult });
    await assert.rejects(mailer.send(message), MailerDeliveryError);
  }
  const { mailer } = mockMailer({
    sendResult: { accepted: [CONTACT_RECIPIENT.toUpperCase()], rejected: [] },
  });
  assert.deepEqual(await mailer.send(message), { accepted: true });
});

test("missing or invalid configuration never creates a transport or exposes secrets", async () => {
  for (const settings of [
    {},
    { SMTP_USER: env.SMTP_USER },
    { SMTP_PASS: env.SMTP_PASS },
    { ...env, SMTP_PASS: "   " },
    ...["", "0", "65536", "465.5", "465oops", "1e3", "-1"].map(
      (SMTP_PORT) => ({ ...env, SMTP_PORT }),
    ),
    { ...env, SMTP_HOST: "https://smtp.example.com" },
    { ...env, SMTP_HOST: "smtp.example.com\r\nmalicious" },
    { ...env, SMTP_FROM: "invalid" },
    { ...env, SMTP_FROM: "sender@example.com, attacker@example.com" },
    { ...env, SMTP_FROM: "sender@example.com\r\n" },
    { ...env, SMTP_USER: "sender@example.com\r\nattacker" },
  ]) {
    const { mailer, calls } = mockMailer({ settings });
    assert.equal(mailer.configured, false);
    assert.equal(calls.options.length, 0);
    for (const operation of [() => mailer.send(message), () => mailer.verify()]) {
      await assert.rejects(operation(), (error) => {
        assert.ok(error instanceof MailerConfigurationError);
        assert.equal(error.code, "MAILER_NOT_CONFIGURED");
        assert.ok(!error.stack.includes(env.SMTP_PASS));
        return true;
      });
    }
  }
});

test("invalid visitor fields and header injection never reach SMTP", async () => {
  const { mailer, calls } = mockMailer();
  for (const data of [
    null,
    {},
    { ...message, name: "   " },
    { ...message, name: "n".repeat(101) },
    { ...message, name: "Ada\r\nBcc: attacker@example.com" },
    { ...message, email: "ada@example.com\n" },
    { ...message, email: "ada@example.com,other@example.com" },
    { ...message, email: "invalid" },
    { ...message, email: `${"a".repeat(250)}@example.com` },
    { ...message, message: "Too short" },
    { ...message, message: "a".repeat(5001) },
  ]) {
    await assert.rejects(mailer.send(data), /Contact fields are invalid/);
  }
  assert.equal(calls.messages.length, 0);
});

test("SMTP failures are sanitized without returning provider details", async () => {
  const { mailer } = mockMailer({
    sendError: new Error(`${env.SMTP_PASS}: PRIVATE_SMTP_RESPONSE`),
  });
  await assert.rejects(mailer.send(message), (error) => {
    assert.ok(error instanceof MailerDeliveryError);
    assert.equal(error.code, "MAILER_DELIVERY_FAILED");
    assert.ok(!error.stack.includes(env.SMTP_PASS));
    assert.ok(!error.stack.includes("PRIVATE_SMTP_RESPONSE"));
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("transport construction errors become sanitized configuration failures", async () => {
  const mailer = createContactMailer({
    env,
    createTransport() {
      throw new Error(env.SMTP_PASS);
    },
  });
  assert.equal(mailer.configured, false);
  await assert.rejects(mailer.send(message), MailerConfigurationError);
  await assert.rejects(mailer.verify(), MailerConfigurationError);
});

test("verification delegates without sending a message and sanitizes failures", async () => {
  const { mailer, calls } = mockMailer();
  assert.equal(await mailer.verify(), true);
  assert.equal(calls.verifications, 1);
  assert.equal(calls.messages.length, 0);

  const failed = mockMailer({ verifyError: new Error(env.SMTP_PASS) });
  await assert.rejects(failed.mailer.verify(), (error) => {
    assert.ok(error instanceof MailerDeliveryError);
    assert.ok(!error.stack.includes(env.SMTP_PASS));
    return true;
  });
});
