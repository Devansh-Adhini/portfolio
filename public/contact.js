const CONTACT_EMAIL = "devanshadhinilinkedin@gmail.com";
const CONTACT_ENDPOINT = "/api/contact";
const REQUEST_TIMEOUT = 30000;
const initializedForms = new WeakSet();

class SubmissionError extends Error {}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** SMTP credentials and delivery stay on our server. */
export async function submitContact(
  data = {},
  { fetchImpl = globalThis.fetch } = {},
) {
  if (trimmed(data?._honey)) return { ignored: true };

  const name = trimmed(data?.name);
  const email = trimmed(data?.email);
  const message = trimmed(data?.message);
  if (
    !name ||
    name.length > 100 ||
    email.length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
    /[\r\n\0]/.test(data.name) ||
    /[\r\n\0]/.test(data.email) ||
    message.length < 10 ||
    message.length > 5000 ||
    /\0/.test(message)
  ) {
    throw new SubmissionError(
      "Please enter your name, a valid email, and a message.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetchImpl(CONTACT_ENDPOINT, {
      method: "POST",
      mode: "same-origin",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name,
        email,
        message,
      }),
      signal: controller.signal,
    });

    if (response.status === 503) {
      throw new SubmissionError(
        `The contact form is temporarily unavailable. Please email ${CONTACT_EMAIL}.`,
      );
    }
    if (response.status === 429) {
      throw new SubmissionError(
        "Too many messages have been sent. Please wait a few minutes before trying again.",
      );
    }
    if (!response.ok) {
      throw new SubmissionError(
        `We couldn’t submit your message. Please try again, or email ${CONTACT_EMAIL}.`,
      );
    }

    const result = await response.json();
    if (result?.success !== true) {
      throw new SubmissionError(
        `Your message wasn’t accepted. Please try again, or email ${CONTACT_EMAIL}.`,
      );
    }
    return { accepted: true };
  } catch (error) {
    if (error instanceof SubmissionError) throw error;
    if (controller.signal.aborted) {
      throw new SubmissionError(
        `The request timed out. Please try again, or email ${CONTACT_EMAIL}.`,
      );
    }
    throw new SubmissionError(
      `We couldn’t confirm submission. Check your connection and try again, or email ${CONTACT_EMAIL}.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function initContactForm(form) {
  if (!form || initializedForms.has(form)) return;
  initializedForms.add(form);

  const status = form.querySelector("#contact-status");
  const button = form.querySelector(".contact-submit");
  const label = button?.querySelector(".submit-label");
  const idleLabel = label?.textContent || "Send message";
  const fields = ["name", "email", "message"]
    .map((name) => form.elements.namedItem(name))
    .filter(Boolean);
  const fieldNames = ["name", "email", "message", "_honey"];
  let pending = false;

  function setStatus(message, state) {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  form.addEventListener("input", (event) => {
    event.target?.setCustomValidity?.("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;

    const data = Object.fromEntries(
      fieldNames.map((name) => [
        name,
        form.elements.namedItem(name)?.value || "",
      ]),
    );
    // Bots filling the hidden field receive no visible response or network request.
    if (trimmed(data._honey)) return;

    for (const name of ["name", "email", "message"]) {
      const field = form.elements.namedItem(name);
      field?.setCustomValidity(
        trimmed(data[name]) ? "" : `Please enter your ${name}.`,
      );
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    pending = true;
    form.setAttribute("aria-busy", "true");
    // Keep the submitted draft stable until the request succeeds or fails.
    fields.forEach((field) => {
      field.readOnly = true;
    });
    if (button) button.disabled = true;
    if (label) label.textContent = "Sending…";
    setStatus("Submitting your message…", "pending");

    try {
      const result = await submitContact(data);
      if (result.accepted) {
        form.reset();
        setStatus(
          "Your message was submitted. Thank you for getting in touch.",
          "success",
        );
      }
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      pending = false;
      fields.forEach((field) => {
        field.readOnly = false;
      });
      form.removeAttribute("aria-busy");
      if (button) button.disabled = false;
      if (label) label.textContent = idleLabel;
    }
  });
}
