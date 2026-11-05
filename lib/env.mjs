import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

/** Local credentials stay outside the public directory and never enter responses. */
export function loadLocalEnvironment() {
  try {
    loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(
        "Could not read .env.local. Check the local email configuration.",
      );
    }
  }
}
