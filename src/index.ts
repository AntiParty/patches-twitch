import http from "http";
import { setupServer } from "./server";
import { dbReady, sequelize } from "./db";
import { sequelizeMetrics } from "./dbMetrics";
import { sequelizeBalance } from "./dbBalance";
import { sequelizeSessions } from "./dbSessions";
//import dbMetrics from "@/dbMetrics";
import logger from "@/util/logger";
import { installCrashHandlers, installShutdownHandlers, onShutdown } from "@/util/processLifecycle";

installCrashHandlers();
installShutdownHandlers();

// Registered first so it runs last: hooks run in reverse order.
onShutdown("databases", async () => {
  await Promise.allSettled([
    sequelize.close(),
    sequelizeMetrics.close(),
    sequelizeBalance.close(),
    sequelizeSessions.close(),
  ]);
});

dbReady.then(async () => {
  logger.info("Database ready, initializing web server...");

  try {
    const app = setupServer();
    const server = http.createServer(app);

    server.listen(3000, () => {
      logger.info("Server is running at http://localhost:3000");
      logger.info("Web server online!");
    });

    onShutdown("webServer", () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }));
  } catch (error) {
    logger.error("Failed to start web server:", error);
    process.exit(1);
  }
}).catch((error) => {
  logger.error("Database initialization failed:", error);
  process.exit(1);
});
