import { defineConfig } from "@playwright/test";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fixtureGallery } from "./tests/fixtures/gallery";
const dataDirectory = path.resolve("test-results", `db-${Date.now()}`);
const fixtureDirectory = path.resolve("storage", "test-fixtures");
mkdirSync(fixtureDirectory, { recursive: true });
const archiveFile = path.join(fixtureDirectory, "gallery.json");
writeFileSync(archiveFile, JSON.stringify(fixtureGallery));
const monitorFile = path.join(fixtureDirectory, "backup-logs.json");
writeFileSync(
  monitorFile,
  JSON.stringify({
    version: 1,
    generated: new Date().toISOString(),
    jobs: {
      "cloud-copy": {
        available: true,
        lines: [
          {
            at: "2026-10-23T14:41:55Z",
            message: "Fictional failure: Access Denied.",
          },
          {
            at: "2026-10-23T14:41:55Z",
            message: "Fictional <script>window.logInjected=true</script>",
          },
        ],
      },
    },
  }),
);
export default defineConfig({
  metadata: { dataDirectory, archiveFile },
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3100",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    env: {
      APP_ORIGIN: "http://localhost:3100",
      RENDERGALLERY_DATA_DIR: dataDirectory,
      ADSENSE_ENABLED: "true",
      ADSENSE_PUBLISHER_ID: "ca-pub-0000000000000000",
      ADSENSE_SLOT_ID: "0000000000",
      RENDERGALLERY_ARCHIVE_FILE: archiveFile,
      RENDERGALLERY_MONITOR_FILE: monitorFile,
    },
    timeout: 60000,
  },
});
