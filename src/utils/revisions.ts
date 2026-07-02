import { db, articleRevisionsTable, type Article } from "@workspace/db";

const SNAPSHOT_FIELDS = [
  "title", "summary", "body", "slug", "coverImageUrl", "youtubeUrl", "lang",
  "categoryId", "locationId", "tags", "status", "seoTitle", "seoDescription",
  "ogImageUrl", "canonicalUrl", "isBreaking", "isFeatured", "isPinned",
] as const;

export async function snapshotArticleRevision(article: Article, editedBy: string | null) {
  const snapshot: Record<string, unknown> = {};
  for (const field of SNAPSHOT_FIELDS) snapshot[field] = (article as Record<string, unknown>)[field];
  await db.insert(articleRevisionsTable).values({
    articleId: article.id,
    editedBy,
    snapshot,
  });
}
