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

await ensureNewRelic();

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

const server = await preview({
  preview: {
    port,
    host,
    open: openSetting,
  },
});

server.printUrls();

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
