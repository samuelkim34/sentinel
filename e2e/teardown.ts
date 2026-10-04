import { rmSync } from "node:fs";
import { basename } from "node:path";
export default function teardown() {
  const directory = process.env.SENTINEL_E2E_DIRECTORY;
  if (directory && basename(directory).startsWith("sentinel-e2e-")) rmSync(directory, { force: true, recursive: true });
}
