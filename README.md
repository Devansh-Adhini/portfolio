# Devansh’s portfolio

A portfolio with self-hosted Cinzel and Space Grotesk fonts, a black/white/purple palette, elastic cursor-responsive particles, and a Nodemailer contact backend. The system cursor stays native.

## Preview

Requires Node.js 20.12 or newer. Install the one runtime dependency before starting.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. To use another port, set `PORT` before starting.

```sh
npm run check
```

This checks JavaScript syntax. Browser QA covers layout, navigation, and interaction separately.

```sh
npm test
```

Email tests use injected transports and ephemeral HTTP servers; they never send live messages.

## Files

- `public/index.html`: portfolio content and resume/project/social links.
- `public/styles.css`: responsive visual design.
- `public/gravity.js`: canvas animation with native cursor input, motion preferences, and pause support.
- `public/app.js`: navigation, motion control, and email copying.
- `public/contact.js`: contact form validation and submission to the same-origin API.
- `lib/contact-api.mjs`: request validation, origin checks, honeypot, and rate limits.
- `lib/mailer.mjs`: authenticated SMTP sending to the fixed email recipient.
- `lib/env.mjs`: private local environment loading.
- `scripts/verify-email.mjs`: SMTP authentication check and optional test message.
- `public/assets/devansh-resume.pdf`: the supplied November 2026 resume.
- `server.mjs`: localhost-only preview server and contact API.

Content uses the November 2, 2026 resume as the primary source. Interests and a few additional skills come from the August 2026 resume. Conflicting dates and statistics use the newer source; coding ratings are labeled as resume snapshots. No claim of journal publication is made.

The project is a local draft; no repository, commit, push, or production deployment was created. The contact form now requires the Node backend; static-only hosting of `public/` will not send messages. The animation pauses while the page is hidden and respects reduced-motion preferences. Small screens use fewer particles.

Fonts are from Google Fonts and are distributed under the included SIL Open Font Licenses. The visual approach is inspired by the provided references; it uses an original particle implementation and code-drawn project illustrations.

## Contact email setup

FormSubmit has been replaced with [Nodemailer](https://nodemailer.com/smtp), which sends through an authenticated SMTP account on the server. The fixed recipient is `devanshadhinilinkedin@gmail.com`. The visitor’s email is only the Reply-To address; visitors cannot choose recipients or the sending account. Credentials never enter browser code.

For the prepared Gmail setup:

1. Sign into the Gmail account you want to send from. Google requires **2-Step Verification** for app passwords.
2. Open [Google App Passwords](https://myaccount.google.com/apppasswords) and create one named **Portfolio**. Use this separate credential, not your normal Google password. If Google does not offer app passwords for your account, use another SMTP provider or configure OAuth before sending. [Google’s requirements](https://support.google.com/accounts/answer/185833).
3. Open `.env.local` in this project. Put the 16-character app password after `SMTP_PASS=`, without spaces. Change `SMTP_USER` if using a different sending account. Keep the password out of chat and `public/`.
4. Run `npm run email:verify` to check the connection and authentication.
5. Restart `npm run dev` after changing `.env.local`. Submit the website form, or run `npm run email:test` to send one diagnostic message to the fixed recipient. Check the receiving inbox and spam folder to confirm delivery.

If `.env.local` is missing, copy `.env.example` to it first. Variables already set by the host take precedence. Local environment files are ignored by Git and cannot be downloaded through the static server, which serves only `public/`.

The encrypted Gmail SMTP connection was verified from this machine. Authentication and live delivery remain pending until the owner adds a sending credential. Gmail can limit automated sending or block server sign-ins; dedicated SMTP services are a better choice for production workloads. The same integration can use their `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` settings. [Nodemailer’s Gmail guide](https://nodemailer.com/guides/using-gmail).

SMTP acceptance confirms that the mail server accepted the message, not inbox delivery. The form keeps the draft on failure. Automated transport tests do not prove live delivery.

## Hosting the contact form

GitHub Pages publishes `public/` through `.github/workflows/pages.yml` on pushes to `main`. Asset paths are relative so the site works at `/portfolio/`. Only public site files are included in the Pages artifact; SMTP configuration, local environment files, and the Node backend are excluded. On `github.io`, the contact section offers the direct email link instead of the unsupported Node form. Local development retains the form.

Deploy with `npm start` on a Node host with SMTP access. Set the SMTP values in the host’s secret settings and set `SITE_ORIGIN` to the deployed HTTPS origin. Set `HOST=0.0.0.0` only if required by the host; the local default remains `127.0.0.1`.

The endpoint bounds request bodies and applies an in-memory limit of five sending attempts per direct client address per ten minutes. Before public deployment behind a proxy or across multiple instances, configure platform-level rate limiting. Visitor-supplied forwarding headers are deliberately not trusted. No production deployment has been made.
