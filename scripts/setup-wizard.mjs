import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { writeConfigValues } from "./local-config.mjs";

const keys = { NESSIE_API_KEY: "Nessie sandbox API key", XAI_API_KEY: "xAI API key" };

export async function startSetupWizard(directory, config) {
  const missing = Object.keys(keys).filter(key => !config[key]);
  if (!missing.length) return null;
  const token = randomBytes(32).toString("hex");
  let origin;
  let finish;
  let saving = false;
  const done = new Promise(resolve => { finish = resolve; });
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    // Keep browser Origin on form POSTs, but never send the token-bearing URL
    // as a referrer. no-referrer makes some browsers submit Origin: null.
    response.setHeader("Referrer-Policy", "strict-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const url = new URL(request.url || "/", origin);
    const reply = (status, body, html = false) => {
      response.writeHead(status, { "Content-Type": html ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
      response.end(body);
    };
    if (request.headers.host !== new URL(origin).host || url.pathname !== "/" || url.searchParams.get("token") !== token) return reply(403, "Open the setup link printed by the launcher.");
    if (request.method === "GET") {
      return reply(200, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Set up Sentinel</title>
      <style>body{font:17px system-ui;background:#f5f1e9;color:#15212d;max-width:660px;margin:7vh auto;padding:24px}label{display:block;margin-top:24px}input{box-sizing:border-box;width:100%;padding:12px;font:inherit;margin-top:8px}button{padding:14px 24px;margin-top:28px;background:#15212d;color:white;border:0;border-radius:8px;font:inherit}p{line-height:1.6}small{color:#536170}</style>
      <h1>Set up Sentinel</h1><p>Enter your keys once on this computer. They stay in your private local configuration and are never added to GitHub.</p>
      <p>Sandbox purchases use simulated completion and a separate Sentinel spending balance on new installations. No real purchases or deliveries occur. Existing configuration is preserved.</p>
      <form method="post" action="/?token=${token}" autocomplete="off">
      ${missing.map(key => `<label>${keys[key]}<input type="password" name="${key}" maxlength="512" autocomplete="new-password" spellcheck="false" required></label>`).join("")}
      <p><small>Get your own keys from your Nessie sandbox and xAI developer accounts. An xAI account with API access and available credit is needed for agents and voice. Do not enter a bank login or account password.</small></p>
      <button type="submit">Save keys and start Sentinel</button></form><p>Keep the launcher window open while using Sentinel.</p></html>`, true);
    }
    if (request.method !== "POST") return reply(405, "Method not allowed.");
    if (request.headers.origin !== origin || !request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) return reply(403, "Submit the form from the local setup page.");
    if (saving) return reply(409, "Setup is already being saved.");
    saving = true;
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 8192) { saving = false; return reply(413, "Setup form is too large."); }
      }
      const form = new URLSearchParams(body);
      const values = {};
      for (const key of missing) {
        const value = (form.get(key) || "").trim();
        if (!/^[A-Za-z0-9_.:-]{1,512}$/.test(value)) { saving = false; return reply(422, "Enter a valid API key in each field. Use your browser Back button to try again."); }
        values[key] = value;
      }
      writeConfigValues(directory, values);
      reply(200, "Keys saved. Sentinel is starting and will open in another browser tab. Keep the launcher window open.");
      server.close();
      finish();
    } catch {
      saving = false;
      reply(500, "Could not save local configuration. Check that the project folder is writable.");
    }
  });
  server.requestTimeout = 15000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: `${origin}/?token=${token}`, done, close: () => { server.closeAllConnections(); server.close(); finish(); } };
}
