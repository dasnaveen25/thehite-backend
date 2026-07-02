import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { startScheduledArticlePublisher } from "./lib/scheduler";

const rawPort = process.env["PORT"] || "5000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Database connection FAILED:", err.message);
  } else {
    console.log("✅ Database connected successfully!");
    release();
  }
});

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduledArticlePublisher();
});
