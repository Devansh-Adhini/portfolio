import { loadLocalEnvironment } from "../lib/env.mjs";
import { createContactMailer, CONTACT_RECIPIENT } from "../lib/mailer.mjs";

loadLocalEnvironment();
const mailer = createContactMailer();
if (!mailer.configured) {
  console.error(
    "Email is not configured. Add SMTP_USER and SMTP_PASS to .env.local, then run this command again.",
  );
  process.exitCode = 1;
} else {
  try {
    await mailer.verify();
    console.log("SMTP connection and sender authentication verified.");
    if (process.argv.includes("--send-test")) {
      await mailer.send({
        name: "Portfolio connection check",
        email: CONTACT_RECIPIENT,
        message:
          "This is a connection check from Devansh's portfolio. If you received this message, website email delivery is working.",
      });
      console.log(
        `The email server accepted the test message for ${CONTACT_RECIPIENT}. Check the inbox and spam folder to confirm delivery.`,
      );
    }
  } catch {
    console.error(
      "Email verification failed. Check the SMTP settings and App Password in .env.local. No credentials were printed.",
    );
    process.exitCode = 1;
  }
}
