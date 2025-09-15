import http from "http";
import { setupServer } from "./server";
import { dbReady } from "./db";
import logger from "./util/logger";

dbReady.then(async () => {
  logger.info("Database ready, initializing web server...");

  try {
    const app = setupServer();
    const server = http.createServer(app);

    server.listen(3000, () => {
      logger.info("Server is running at http://localhost:3000");
      logger.warn("Web server online!");
    });
  } catch (error) {
    logger.error("Failed to start web server:", error);
    process.exit(1);
  }
}).catch((error) => {
  logger.error("Database initialization failed:", error);
  process.exit(1);
});
