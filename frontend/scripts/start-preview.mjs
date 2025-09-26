import "newrelic";
import { preview } from "vite";

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
