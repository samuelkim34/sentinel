import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createServer } from "node:net";
import { assertNodeVersion, loadRuntimeEnv } from "./runtime.mjs";
import { ensureLocalConfig, readLocalConfig, safeStartupMessage } from "./local-config.mjs";
import { startSetupWizard } from "./setup-wizard.mjs";

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(directory);
let child;
let wizard;
let stopping = false;
let lock;
const lockPath = resolve(directory, ".sentinel-launch.lock");

function cleanup() {
  if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); lock = undefined; }
}
function stop() {
  stopping = true;
  wizard?.close();
  child?.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", cleanup);

function openBrowser(url) {
  const command = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const browser = spawn(command, args, { stdio: "ignore", detached: true });
  browser.on("error", () => console.log("Open the link above in your browser."));
  browser.unref();
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    child = spawn(command, args, { cwd: directory, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => {
      child = undefined;
      if (code === 0 || stopping) resolve();
      else reject(new Error(`Startup step failed (exit ${code ?? "signal"}). Read the message above; your configuration and database were preserved.`));
    });
  });
}

async function main() {
  assertNodeVersion();
  try { lock = openSync(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("Sentinel launcher is already running, or its previous run was interrupted. Close that launcher first. If no launcher is running, remove only .sentinel-launch.lock from this project folder and reopen the launcher.");
    throw error;
  }
  const hash = createHash("sha256").update(readFileSync("package-lock.json")).update(`${process.platform}/${process.arch}/${process.versions.node}`).digest("hex");
  const stamp = "node_modules/.sentinel-install-stamp";
  if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== hash || !existsSync("node_modules/tsx/package.json") || !existsSync("node_modules/next/package.json")) {
    console.log("Installing Sentinel dependencies. The first launch needs an internet connection.");
    if (process.platform === "win32") await run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm ci"]);
    else await run("npm", ["ci"]);
    if (stopping) return;
    writeFileSync(stamp, hash);
  }
  let config = ensureLocalConfig(directory);
  wizard = await startSetupWizard(directory, config);
  if (wizard) {
    console.log(`Complete private setup on this computer: ${wizard.url}`);
    openBrowser(wizard.url);
    await wizard.done;
    wizard = undefined;
    if (stopping) return;
    config = readLocalConfig(directory);
  }
  loadRuntimeEnv();
  const origin = new URL(config.APP_ORIGIN);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("The desktop launcher requires an http://127.0.0.1 or http://localhost APP_ORIGIN. For a hosted deployment, use the documented npm start workflow.");
  }
  const port = Number(origin.port || 80);
  if (process.env.PORT && Number(process.env.PORT) !== port) throw new Error("PORT and APP_ORIGIN use different ports. Make them match in your local configuration.");
  process.env.PORT = String(port);
  process.env.SENTINEL_HOST = "127.0.0.1";
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is already in use or unavailable. Close the other Sentinel window before starting this copy.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
  console.log(`Starting Sentinel at ${origin.origin}. Keep this window open; Ctrl+C stops the app and workers.`);
  const running = run(process.execPath, ["scripts/dev.mjs"]);
  let exited = false;
  void running.then(() => { exited = true; }, () => { exited = true; });
  const ready = async () => {
    for (let attempt = 0; attempt < 120 && !exited && !stopping; attempt++) {
      try {
        const response = await fetch(`${origin.origin}/api/health`, { signal: AbortSignal.timeout(1000), redirect: "error" });
        if (response.ok) { openBrowser(origin.origin); return; }
      } catch { /* Wait for the development server to become ready. */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };
  await Promise.all([running, ready()]);
}

main().catch(error => {
  console.error(safeStartupMessage(error));
  process.exitCode = 1;
  stop();
}).finally(cleanup);
