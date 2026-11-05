import nodemailer from "nodemailer";
import { isIP } from "node:net";

export const CONTACT_RECIPIENT = "devanshadhinilinkedin@gmail.com";

export class MailerConfigurationError extends Error {
  constructor() {
    super("Contact email is not configured. Check the SMTP settings.");
    this.name = "MailerConfigurationError";
    this.code = "MAILER_NOT_CONFIGURED";
  }
}

export class MailerDeliveryError extends Error {
  constructor(message = "The mail server did not accept the message.") {
    super(message);
    this.name = "MailerDeliveryError";
    this.code = "MAILER_DELIVERY_FAILED";
  }
}

function mailAddress(value) {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@<>(),;:"\\\[\]]+@[^\s@<>(),;:"\\\[\]]+\.[^\s@<>(),;:"\\\[\]]+$/.test(
      value,
    )
  );
}

/** Configure SMTP without opening a connection or sending mail. */
export function createContactMailer({
  env = process.env,
  createTransport = nodemailer.createTransport,
} = {}) {
  const user = typeof env.SMTP_USER === "string" ? env.SMTP_USER.trim() : "";
  const pass = typeof env.SMTP_PASS === "string" ? env.SMTP_PASS : "";
  const host =
    env.SMTP_HOST === undefined
      ? "smtp.gmail.com"
      : typeof env.SMTP_HOST === "string"
        ? env.SMTP_HOST.trim()
        : "";
  const rawPort =
    env.SMTP_PORT === undefined ? "465" : String(env.SMTP_PORT).trim();
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
  const from =
    typeof env.SMTP_FROM === "string" && env.SMTP_FROM.trim()
      ? env.SMTP_FROM.trim()
      : user;
  const validHost =
    host.length <= 253 &&
    (isIP(host) !== 0 || /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host));
  let transport;

  if (
    user &&
    user.length <= 320 &&
    !/[\r\n]/.test(user) &&
    pass.trim() &&
    validHost &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    mailAddress(from) &&
    !/[\r\n]/.test(env.SMTP_FROM || "")
  ) {
    try {
      transport = createTransport({
        host,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user, pass },
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
      });
      if (
        typeof transport?.sendMail !== "function" ||
        typeof transport?.verify !== "function"
      ) {
        transport = undefined;
      }
    } catch {
      // Transport construction errors can include credentials or provider details.
      transport = undefined;
    }
  }

  return {
    configured: Boolean(transport),
    async send(data = {}) {
      if (!transport) throw new MailerConfigurationError();
      const rawName = typeof data?.name === "string" ? data.name : "";
      const rawEmail = typeof data?.email === "string" ? data.email : "";
      const name = rawName.trim();
      const email = rawEmail.trim();
      const message =
        typeof data?.message === "string" ? data.message.trim() : "";
      if (
        !name ||
        name.length > 100 ||
        /[\r\n]/.test(rawName + rawEmail) ||
        !mailAddress(email) ||
        message.length < 10 ||
        message.length > 5000
      ) {
        throw new TypeError("Contact fields are invalid.");
      }

      let info;
      try {
        // Only these fields reach SMTP. Visitor input cannot choose recipients,
        // sender, subject, attachments, HTML, or additional message headers.
        info = await transport.sendMail({
          from,
          to: CONTACT_RECIPIENT,
          replyTo: { name, address: email },
          subject: "New portfolio message",
          text: `Portfolio contact message\n\nName: ${name}\nEmail: ${email}\n\n${message}`,
        });
      } catch {
        throw new MailerDeliveryError();
      }

      const accepted =
        Array.isArray(info?.accepted) &&
        info.accepted.some(
          (address) =>
            typeof address === "string" &&
            address.toLowerCase() === CONTACT_RECIPIENT,
        );
      if (
        !accepted ||
        (Array.isArray(info?.rejected) && info.rejected.length > 0)
      ) {
        throw new MailerDeliveryError();
      }
      return { accepted: true };
    },
    async verify() {
      if (!transport) throw new MailerConfigurationError();
      try {
        return await transport.verify();
      } catch {
        throw new MailerDeliveryError("The mail server could not be verified.");
      }
    },
  };
}
