import { Router, type IRouter } from "express";
import {
  db,
  articlesTable,
  articleRevisionsTable,
  categoriesTable,
  locationsTable,
  usersTable,
  userProfilesTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  ListAdminArticlesQueryParams,
  ListAdminArticlesResponse,
  ApproveArticleParams,
  ApproveArticleResponse,
  RejectArticleBody,
  RejectArticleResponse,
  RequestArticleChangesParams,
  RequestArticleChangesBody,
  RequestArticleChangesResponse,
  UpdateArticleFlagsParams,
  UpdateArticleFlagsBody,
  UpdateArticleFlagsResponse,
  GetAdminArticleParams,
  GetAdminArticleResponse,
  AdminUpdateArticleParams,
  AdminUpdateArticleBody,
  AdminUpdateArticleResponse,
  AdminDeleteArticleParams,
  AdminDeleteArticleResponse,
} from "@workspace/api-zod";
import { audit } from "../../utils/audit";
import { mapMyArticle } from "../../utils/mappers";
import { slugifyExact } from "../../utils/slug";
import { snapshotArticleRevision } from "../../utils/revisions";
import { sendBreakingNewsPush, sendFollowedWriterPush } from "../../lib/push";

// Returns the slugified custom slug if free, or null if the caller didn't request one.
// Throws { code: "SLUG_TAKEN" } if the requested slug is already in use by another article.
async function resolveCustomSlug(rawSlug: string | undefined, excludeArticleId?: string): Promise<string | null> {
  if (!rawSlug || !rawSlug.trim()) return null;
  const slug = slugifyExact(rawSlug);
  if (!slug) return null;
  const conds = [eq(articlesTable.slug, slug)];
  if (excludeArticleId) conds.push(sql`${articlesTable.id} != ${excludeArticleId}`);
  const [existing] = await db.select({ id: articlesTable.id }).from(articlesTable).where(and(...conds));
  if (existing) {
    const err = new Error("This URL slug is already in use by another article") as Error & { code: string };
    err.code = "SLUG_TAKEN";
    throw err;
  }
  return slug;
}

async function loadFullArticle(id: string) {
  const [row] = await db
    .select({ article: articlesTable, category: categoriesTable, location: locationsTable })
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(eq(articlesTable.id, id));
  if (!row) return null;
  return mapMyArticle({ article: row.article, category: row.category, location: row.location, writer: null });
}

const router: IRouter = Router();

router.get("/admin/articles", async (req, res): Promise<void> => {
  const q = ListAdminArticlesQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }

  const conds = [];
  if (q.data.status && q.data.status !== "all") conds.push(eq(articlesTable.status, q.data.status));

  const rows = await db
    .select({
      article: articlesTable,
      category: categoriesTable,
      location: locationsTable,
      writer: usersTable,
      profile: userProfilesTable,
    })
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, articlesTable.writerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(articlesTable.updatedAt))
    .limit(q.data.limit);

  const items = rows.map((r) => ({
    ...mapMyArticle({ article: r.article, category: r.category, location: r.location, writer: null }),
    writer: r.writer
      ? {
          id: r.writer.id,
          displayName: r.profile?.displayName ?? r.writer.email ?? "Writer",
          profileImageUrl: r.writer.profileImageUrl,
          verified: r.profile?.isVerified ?? false,
        }
      : undefined,
  }));
  res.json(ListAdminArticlesResponse.parse(items));
});

router.get("/admin/articles/:id", async (req, res): Promise<void> => {
  const p = GetAdminArticleParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const full = await loadFullArticle(p.data.id);
  if (!full) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  res.json(GetAdminArticleResponse.parse(full));
});

router.patch("/admin/articles/:id", async (req, res): Promise<void> => {
  const p = AdminUpdateArticleParams.safeParse(req.params);
  const b = AdminUpdateArticleBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.id, p.data.id));
  if (!existing) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (b.data.title !== undefined) { update.title = b.data.title; }
  if (b.data.summary !== undefined) update.summary = b.data.summary;
  if (b.data.body !== undefined) update.body = b.data.body;
  if (b.data.lang !== undefined) update.lang = b.data.lang;
  if ("coverImageUrl" in b.data) update.coverImageUrl = b.data.coverImageUrl;
  if ("youtubeUrl" in b.data) update.youtubeUrl = b.data.youtubeUrl;
  if ("categoryId" in b.data) update.categoryId = b.data.categoryId;
  if ("locationId" in b.data) update.locationId = b.data.locationId;
  if (b.data.tags !== undefined) update.tags = b.data.tags;
  if (b.data.status !== undefined) {
    update.status = b.data.status;
    if (b.data.status === "published" && !existing.publishedAt) update.publishedAt = new Date();
    if (b.data.status !== "scheduled") update.scheduledAt = null;
  }
  if ("scheduledAt" in b.data) update.scheduledAt = b.data.scheduledAt ? new Date(b.data.scheduledAt) : null;
  if ("seoTitle" in b.data) update.seoTitle = b.data.seoTitle;
  if ("seoDescription" in b.data) update.seoDescription = b.data.seoDescription;
  if ("ogImageUrl" in b.data) update.ogImageUrl = b.data.ogImageUrl;
  if ("canonicalUrl" in b.data) update.canonicalUrl = b.data.canonicalUrl;
  if (b.data.isBreaking !== undefined) update.isBreaking = b.data.isBreaking;
  if (b.data.isFeatured !== undefined) update.isFeatured = b.data.isFeatured;
  if (b.data.isPinned !== undefined) update.isPinned = b.data.isPinned;
  if (b.data.slug !== undefined) {
    try {
      const resolved = await resolveCustomSlug(b.data.slug, p.data.id);
      if (resolved) update.slug = resolved;
    } catch (e) {
      res.status(409).json({ error: { code: "SLUG_TAKEN", message: (e as Error).message } });
      return;
    }
  }

  await snapshotArticleRevision(existing, req.user!.id);

  const [a] = await db.update(articlesTable).set(update).where(eq(articlesTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.edit", "article", a.id);
  if (b.data.status === "published" && existing.status !== "published" && a.isBreaking) {
    void sendBreakingNewsPush({ articleId: a.id, slug: a.slug, title: a.title, summary: a.summary, categoryId: a.categoryId, locationId: a.locationId });
  }
  res.json(AdminUpdateArticleResponse.parse(await loadFullArticle(a.id)));
});

router.get("/admin/articles/:id/revisions", async (req, res): Promise<void> => {
  const p = GetAdminArticleParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const rows = await db
    .select({ revision: articleRevisionsTable, editor: usersTable, editorProfile: userProfilesTable })
    .from(articleRevisionsTable)
    .leftJoin(usersTable, eq(usersTable.id, articleRevisionsTable.editedBy))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, articleRevisionsTable.editedBy))
    .where(eq(articleRevisionsTable.articleId, p.data.id))
    .orderBy(desc(articleRevisionsTable.createdAt))
    .limit(50);
  res.json(rows.map((r) => ({
    id: r.revision.id,
    createdAt: r.revision.createdAt,
    editor: r.editor
      ? { id: r.editor.id, displayName: r.editorProfile?.displayName ?? r.editor.email ?? "User" }
      : null,
    title: (r.revision.snapshot as Record<string, unknown>).title ?? null,
    summary: (r.revision.snapshot as Record<string, unknown>).summary ?? null,
  })));
});

router.post("/admin/articles/:id/revisions/:revisionId/restore", async (req, res): Promise<void> => {
  const p = GetAdminArticleParams.safeParse(req.params);
  const revisionId = (req.params as { revisionId?: string }).revisionId;
  if (!p.success || !revisionId) { res.status(400).json({ error: p.success ? "revisionId is required" : p.error.message }); return; }

  const [revision] = await db
    .select()
    .from(articleRevisionsTable)
    .where(and(eq(articleRevisionsTable.id, revisionId), eq(articleRevisionsTable.articleId, p.data.id)));
  if (!revision) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Revision not found" } }); return; }

  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.id, p.data.id));
  if (!existing) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }

  // Snapshot current state before overwriting, so restoring is itself reversible.
  await snapshotArticleRevision(existing, req.user!.id);

  const snapshot = revision.snapshot as Record<string, unknown>;
  const restore: Record<string, unknown> = { updatedAt: new Date() };
  for (const field of ["title", "summary", "body", "coverImageUrl", "youtubeUrl", "lang", "categoryId", "locationId", "tags", "seoTitle", "seoDescription", "ogImageUrl", "canonicalUrl", "isBreaking", "isFeatured", "isPinned"]) {
    if (field in snapshot) restore[field] = snapshot[field];
  }

  const [a] = await db.update(articlesTable).set(restore).where(eq(articlesTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.restore_revision", "article", a.id);
  res.json(AdminUpdateArticleResponse.parse(await loadFullArticle(a.id)));
});

router.delete("/admin/articles/:id", async (req, res): Promise<void> => {
  const p = AdminDeleteArticleParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [deleted] = await db.delete(articlesTable).where(eq(articlesTable.id, p.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.delete", "article", deleted.id);
  res.json(AdminDeleteArticleResponse.parse({ deleted: true }));
});

// Admin video upload — creates and publishes the article in one step, no approval step involved.
router.post("/admin/videos", async (req, res): Promise<void> => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const videoUrl = typeof req.body?.videoUrl === "string" ? req.body.videoUrl.trim() : "";
  if (!title || title.length < 3) {
    res.status(400).json({ error: { code: "INVALID_TITLE", message: "Title must be at least 3 characters" } });
    return;
  }
  if (!videoUrl) {
    res.status(400).json({ error: { code: "INVALID_VIDEO_URL", message: "videoUrl is required" } });
    return;
  }

  const { rows: [maxRow] } = await db.execute(sql`
    SELECT max(cast(substring(slug from '^video-([0-9]+)$') as integer)) as max_no
    FROM ${articlesTable}
    WHERE slug ~ '^video-[0-9]+$'
  `);
  const nextNo = (Number((maxRow as any)?.max_no) || 0) + 1;
  const slug = `video-${nextNo}`;

  const [a] = await db
    .insert(articlesTable)
    .values({
      writerId: req.user!.id,
      slug,
      title,
      summary: title,
      body: `<p>${title}</p><p>वीडियो देखने के लिए ऊपर प्ले बटन दबाएँ।</p>`,
      coverImageUrl: videoUrl,
      lang: "hi",
      tags: [],
      status: "published",
      publishedAt: new Date(),
    })
    .returning();

  await audit(req.user!.id, "article.approve", "article", a.id);
  if (a.isBreaking) {
    void sendBreakingNewsPush({ articleId: a.id, slug: a.slug, title: a.title, summary: a.summary, categoryId: a.categoryId, locationId: a.locationId });
  }
  void sendFollowedWriterPush({ articleId: a.id, slug: a.slug, title: a.title, writerId: a.writerId });
  res.status(201).json(ApproveArticleResponse.parse(await loadFullArticle(a.id)));
});

router.post("/admin/articles/:id/approve", async (req, res): Promise<void> => {
  const p = ApproveArticleParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [a] = await db
    .update(articlesTable)
    .set({ status: "published", publishedAt: new Date(), moderationNote: null })
    .where(eq(articlesTable.id, p.data.id))
    .returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.approve", "article", a.id);
  if (a.isBreaking) {
    void sendBreakingNewsPush({ articleId: a.id, slug: a.slug, title: a.title, summary: a.summary, categoryId: a.categoryId, locationId: a.locationId });
  }
  void sendFollowedWriterPush({ articleId: a.id, slug: a.slug, title: a.title, writerId: a.writerId });
  res.json(ApproveArticleResponse.parse(await loadFullArticle(a.id)));
});

router.post("/admin/articles/:id/schedule", async (req, res): Promise<void> => {
  const p = ApproveArticleParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }

  const rawScheduledAt = (req.body as { scheduledAt?: unknown })?.scheduledAt;
  const scheduledAt = typeof rawScheduledAt === "string" ? new Date(rawScheduledAt) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    res.status(400).json({ error: { code: "INVALID_DATE", message: "scheduledAt is required and must be a valid date" } });
    return;
  }
  if (scheduledAt.getTime() <= Date.now()) {
    res.status(400).json({ error: { code: "INVALID_DATE", message: "Scheduled time must be in the future" } });
    return;
  }

  const [a] = await db
    .update(articlesTable)
    .set({ status: "scheduled", scheduledAt, publishedAt: null, moderationNote: null })
    .where(eq(articlesTable.id, p.data.id))
    .returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.schedule", "article", a.id);
  res.json(GetAdminArticleResponse.parse(await loadFullArticle(a.id)));
});

router.post("/admin/articles/:id/reject", async (req, res): Promise<void> => {
  const p = ApproveArticleParams.safeParse(req.params);
  const b = RejectArticleBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [a] = await db
    .update(articlesTable)
    .set({ status: "rejected", moderationNote: b.data.note })
    .where(eq(articlesTable.id, p.data.id))
    .returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.reject", "article", a.id, b.data.note);
  res.json(RejectArticleResponse.parse(await loadFullArticle(a.id)));
});

router.post("/admin/articles/:id/request-changes", async (req, res): Promise<void> => {
  const p = RequestArticleChangesParams.safeParse(req.params);
  const b = RequestArticleChangesBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [a] = await db
    .update(articlesTable)
    .set({ status: "changes_requested", moderationNote: b.data.note })
    .where(eq(articlesTable.id, p.data.id))
    .returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.request_changes", "article", a.id, b.data.note);
  res.json(RequestArticleChangesResponse.parse(await loadFullArticle(a.id)));
});

router.patch("/admin/articles/:id/flags", async (req, res): Promise<void> => {
  const p = UpdateArticleFlagsParams.safeParse(req.params);
  const b = UpdateArticleFlagsBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const update: Record<string, unknown> = {};
  if (b.data.isBreaking !== undefined) update.isBreaking = b.data.isBreaking;
  if (b.data.isFeatured !== undefined) update.isFeatured = b.data.isFeatured;
  if (b.data.isPinned !== undefined) update.isPinned = b.data.isPinned;
  const [prev] = await db.select().from(articlesTable).where(eq(articlesTable.id, p.data.id));
  const [a] = await db.update(articlesTable).set(update).where(eq(articlesTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.update_flags", "article", a.id);
  if (b.data.isBreaking === true && prev && !prev.isBreaking && a.status === "published") {
    void sendBreakingNewsPush({ articleId: a.id, slug: a.slug, title: a.title, summary: a.summary, categoryId: a.categoryId, locationId: a.locationId });
  }
  res.json(UpdateArticleFlagsResponse.parse(await loadFullArticle(a.id)));
});

export default router;
