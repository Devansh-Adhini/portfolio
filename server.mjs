import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment } from "./lib/env.mjs";
import { createContactMailer } from "./lib/mailer.mjs";
import { createContactHandler } from "./lib/contact-api.mjs";

loadLocalEnvironment();
const root = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number(process.env.PORT || 3000);
const mailer = createContactMailer();
const allowedOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
if (process.env.SITE_ORIGIN) {
  const origin = new URL(process.env.SITE_ORIGIN);
  if (!["https:", "http:"].includes(origin.protocol))
    throw new Error("SITE_ORIGIN must be an HTTP or HTTPS origin.");
  allowedOrigins.push(origin.origin);
}
const handleContact = createContactHandler({ mailer, allowedOrigins });
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (pathname === "/api/contact") {
    await handleContact(request, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const decodedPath = decodeURIComponent(pathname);
    const target = resolve(
      root,
      `.${decodedPath === "/" ? "/index.html" : decodedPath}`,
    );
    if (!target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!(await stat(target)).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[extname(target)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    response.end(
      request.method === "HEAD" ? undefined : await readFile(target),
    );
  } catch (error) {
    const status =
      error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 400;
    response
      .writeHead(status)
      .end(status === 404 ? "Not found" : "Bad request");
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;

server.on("error", (error) => {
  console.error(`Preview could not start: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`Portfolio preview: http://localhost:${port}`);
  if (!mailer.configured)
    console.log(
      "Email setup is pending. Add SMTP_USER and SMTP_PASS to .env.local; see README.md.",
    );
});
