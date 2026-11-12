import { defineConfig } from "@playwright/test";

const HS_PORT = process.env.MATRIX_HS_PORT ?? "8448";
const HS_URL = process.env.MATRIX_HOMESERVER_URL ?? `http://localhost:${HS_PORT}`;
// E2E_WEB_PORT moves the dev server off 5173, e.g. beside a running `zooid dev`.
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5173";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  webServer: {
    command: `VITE_MATRIX_HOMESERVER_URL=${HS_URL} pnpm dev --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
