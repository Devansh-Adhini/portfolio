const MAX_BODY_BYTES = 16 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CLIENTS = 10000;

function respond(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    function cleanup() {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    }
    function fail(error) {
      cleanup();
      request.resume();
      reject(error);
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new RequestError(413, "Your message is too large."));
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(
          new RequestError(400, "Please check the message and try again."),
        );
      }
    }
    function onError() {
      fail(new RequestError(400, "The message could not be read."));
    }
    function onAborted() {
      fail(new RequestError(400, "The request was interrupted."));
    }
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });
}

function contactFields(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (["name", "email", "message"].some((key) => typeof data[key] !== "string"))
    return null;
  // Header values cannot contain newlines, even if trimming would remove them.
  if (/[\r\n\0]/.test(data.name) || /[\r\n\0]/.test(data.email)) return null;
  const name = data.name.trim();
  const email = data.email.trim();
  const message = data.message.trim();
  if (
    !name ||
    name.length > 100 ||
    email.length > 254 ||
    !/^[^\s@<>(),;:"\\\[\]]+@[^\s@<>(),;:"\\\[\]]+\.[^\s@<>(),;:"\\\[\]]+$/.test(
      email,
    ) ||
    message.length < 10 ||
    message.length > 5000 ||
    /\0/.test(message)
  )
    return null;
  return { name, email, message };
}

export function createContactHandler({
  mailer,
  allowedOrigins,
  now = Date.now,
}) {
  const origins = new Set(allowedOrigins);
  const attempts = new Map();

  return async function handleContact(request, response) {
    if (request.method !== "POST") {
      respond(response, 405, { success: false }, { Allow: "POST" });
      return;
    }
    if (
      !origins.has(request.headers.origin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    ) {
      request.resume();
      respond(response, 403, {
        success: false,
        message: "Please send your message from this website.",
      });
      return;
    }
    if (
      request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
      "application/json"
    ) {
      request.resume();
      respond(response, 415, { success: false });
      return;
    }
    if (Number(request.headers["content-length"]) > MAX_BODY_BYTES) {
      request.resume();
      respond(response, 413, {
        success: false,
        message: "Your message is too large.",
      });
      return;
    }

    try {
      const data = await readBody(request);
      if (typeof data?._honey === "string" && data._honey.trim()) {
        respond(response, 200, { success: true });
        return;
      }
      const fields = contactFields(data);
      if (!fields) {
        respond(response, 400, {
          success: false,
          message: "Please check your name, email, and message.",
        });
        return;
      }
      if (!mailer.configured) {
        respond(response, 503, {
          success: false,
          code: "EMAIL_NOT_CONFIGURED",
        });
        return;
      }

      const time = now();
      for (const [key, value] of attempts) {
        if (value.expires <= time) attempts.delete(key);
      }
      // Trust the direct socket address, not visitor-supplied forwarding headers.
      const address = request.socket.remoteAddress;
      let client = attempts.get(address);
      if (
        (!client && attempts.size >= MAX_CLIENTS) ||
        client?.count >= MAX_ATTEMPTS
      ) {
        const retry = Math.max(
          1,
          Math.ceil(((client?.expires ?? time + WINDOW_MS) - time) / 1000),
        );
        respond(
          response,
          429,
          { success: false },
          { "Retry-After": String(retry) },
        );
        return;
      }
      if (!client) {
        client = { count: 0, expires: time + WINDOW_MS };
        attempts.set(address, client);
      }
      client.count += 1;
      const result = await mailer.send(fields);
      if (result?.accepted !== true) throw new Error("Email was not accepted.");
      respond(response, 200, { success: true });
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof RequestError) {
        respond(response, error.status, {
          success: false,
          message: error.message,
        });
      } else {
        // SMTP errors can contain addresses or account details; keep them private.
        respond(response, 502, {
          success: false,
          message: "We could not send your message. Please try again later.",
        });
      }
    }
  };
}
