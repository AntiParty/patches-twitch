import http from "http";
import { setupServer } from "./server";
import { dbReady } from "./db";
//import dbMetrics from "@/dbMetrics";
import logger from "@/util/logger";

dbReady.then(async () => {
  console.log("Database ready, initializing web server...");

  try {
    const app = setupServer();
    const server = http.createServer(app);

    server.listen(3000, () => {
      console.log("Server is running at http://localhost:3000");
      console.log("Web server online!");
    });
  } catch (error) {
    console.error("Failed to start web server:", error);
    process.exit(1);
  }
}).catch((error) => {
  console.error("Database initialization failed:", error);
  process.exit(1);
});