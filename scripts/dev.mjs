import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Native Watchpack notifications can stall Next startup on Windows. Polling
// keeps route discovery and hot reload reliable for this local archive project.
const env = { ...process.env };
if (process.platform === "win32") env.WATCHPACK_POLLING ??= "true";
const args = process.argv.slice(2);
// Explicit defaults prevent Next from silently starting a second instance on
// another port, or binding a different interface while sharing the dev cache.
if (!args.some((arg) => arg === "-H" || arg.startsWith("--hostname"))) {
  args.push("--hostname", "localhost");
}
if (!args.some((arg) => arg === "-p" || arg.startsWith("--port"))) {
  args.push("--port", "3000");
}
const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev", ...args],
  { stdio: "inherit", env },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
