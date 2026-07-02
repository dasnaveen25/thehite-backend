import { db, articlesTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { logger } from "./logger";
import { sendBreakingNewsPush, sendFollowedWriterPush } from "./push";

const POLL_INTERVAL_MS = 60_000;

async function publishDueArticles() {
  const due = await db
    .update(articlesTable)
    .set({ status: "published", publishedAt: new Date() })
    .where(and(eq(articlesTable.status, "scheduled"), lte(articlesTable.scheduledAt, new Date())))
    .returning();

  for (const a of due) {
    logger.info({ articleId: a.id, slug: a.slug }, "Scheduled article auto-published");
    if (a.isBreaking) {
      void sendBreakingNewsPush({ articleId: a.id, slug: a.slug, title: a.title, summary: a.summary, categoryId: a.categoryId, locationId: a.locationId });
    }
    void sendFollowedWriterPush({ articleId: a.id, slug: a.slug, title: a.title, writerId: a.writerId });
  }
}

export function startScheduledArticlePublisher() {
  publishDueArticles().catch((err) => logger.error({ err }, "Scheduled article publish check failed"));
  setInterval(() => {
    publishDueArticles().catch((err) => logger.error({ err }, "Scheduled article publish check failed"));
  }, POLL_INTERVAL_MS);
}
