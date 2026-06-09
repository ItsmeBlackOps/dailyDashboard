import { preview } from "vite";

const ensureNewRelic = async () => {
  const appName =
    process.env.FRONTEND_NEW_RELIC_APP_NAME ||
    process.env.NEW_RELIC_APP_NAME;

  if (!process.env.NEW_RELIC_APP_NAME && appName) {
    process.env.NEW_RELIC_APP_NAME = appName;
  }

  if (process.env.NEW_RELIC_LICENSE_KEY && process.env.NEW_RELIC_APP_NAME) {
    try {
      await import("newrelic");
    } catch (error) {
      console.warn("⚠️ Failed to initialize New Relic on frontend:", error?.message ?? error);
    }
  }
};

const port = Number.parseInt(process.env.FRONTEND_PORT ?? "8180", 10);
const hostEnv = process.env.FRONTEND_HOST;
const host =
  hostEnv === undefined
    ? true
    : hostEnv === "true"
    ? true
    : hostEnv === "false"
    ? false
    : hostEnv;

const openSetting =
  process.env.FRONTEND_OPEN === undefined
    ? false
    : process.env.FRONTEND_OPEN === "true";

const allowedHosts = (() => {
  const rawHosts = process.env.FRONTEND_ALLOWED_HOSTS;
  if (!rawHosts) {
    return ["dailydf.silverspace.tech", "dailydf.tunn.dev"];
  }

  if (rawHosts === "true" || rawHosts === "*") {
    return true;
  }

  return rawHosts
    .split(",")
    .map((hostName) => hostName.trim())
    .filter(Boolean);
})();

const server = await preview({
  preview: {
    port,
    host,
    open: openSetting,
    allowedHosts,
  },
});

server.printUrls();

// Initialize New Relic AFTER the preview server is already listening, and do
// NOT await it. The NR agent's dynamic import performs network I/O on load;
// under VM memory/network pressure that import was blocking `vite preview` from
// binding for >3 min, so the container's Docker healthcheck (GET /) never
// passed and the blue/green deploy aborted (new color never went healthy).
// Server readiness must not depend on optional telemetry — and this is a static
// SPA host, so server-side NR instrumentation has little value anyway.
void ensureNewRelic().catch((error) =>
  console.warn("⚠️ Deferred New Relic init failed:", error?.message ?? error)
);

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

// Keep process alive
await new Promise(() => {});
