import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import {
  db,
  articlesTable,
  categoriesTable,
  locationsTable,
  locationResourcesTable,
  usersTable,
  userProfilesTable,
  commentsTable,
  writerApplicationsTable,
  teamInvitationsTable,
  auditLogTable,
  followsLocationsTable,
  validationReportSharesTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  GetAdminDashboardStatsResponse,
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
  ListAdminUsersQueryParams,
  ListAdminUsersResponse,
  SetUserRoleParams,
  SetUserRoleBody,
  SetUserRoleResponse,
  ListWriterApplicationsQueryParams,
  ListWriterApplicationsResponse,
  ApproveWriterApplicationParams,
  ApproveWriterApplicationResponse,
  RejectWriterApplicationParams,
  RejectWriterApplicationBody,
  RejectWriterApplicationResponse,
  ListAdminCategoriesResponse,
  CreateCategoryBody,
  UpdateCategoryParams,
  UpdateCategoryBody,
  UpdateCategoryResponse,
  DeleteCategoryParams,
  DeleteCategoryResponse,
  ReorderCategoriesBody,
  ReorderCategoriesResponse,
  ListAdminLocationsQueryParams,
  ListAdminLocationsResponse,
  ListLocationWritersParams,
  ListLocationWritersResponse,
  CreateLocationBody,
  UpdateLocationParams,
  UpdateLocationBody,
  UpdateLocationResponse,
  DeleteLocationParams,
  DeleteLocationResponse,
  ImportLocationsBody,
  ImportLocationsResponse,
  ListAdminLocationResourcesParams,
  ListAdminLocationResourcesResponse,
  CreateLocationResourceParams,
  CreateLocationResourceBody,
  UpdateLocationResourceParams,
  UpdateLocationResourceBody,
  UpdateLocationResourceResponse,
  DeleteLocationResourceParams,
  DeleteLocationResourceResponse,
  ReorderLocationResourcesParams,
  ReorderLocationResourcesBody,
  ReorderLocationResourcesResponse,
  ListAdminAuditLogQueryParams,
  ListAdminAuditLogResponse,
  GetAdminArticleParams,
  GetAdminArticleResponse,
  AdminUpdateArticleParams,
  AdminUpdateArticleBody,
  AdminUpdateArticleResponse,
  AdminDeleteArticleParams,
  AdminDeleteArticleResponse,
  ListTeamInvitationsResponse,
  CreateTeamInvitationBody,
  DeleteTeamInvitationParams,
  CreateValidationReportShareBody,
  ListWriterLocationsParams,
  ListWriterLocationsResponse,
} from "@workspace/api-zod";
import { audit, mapMyArticle, requireAdmin, slugify } from "../lib/helpers";
import { logger } from "../lib/logger";
import { sendBreakingNewsPush, sendFollowedWriterPush } from "../lib/push";

async function loadFullArticle(id: string) {
  const [row] = await db
    .select({ article: articlesTable, category: categoriesTable, location: locationsTable })
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(eq(articlesTable.id, id));
  if (!row) return null;
  return mapMyArticle({
    article: row.article,
    category: row.category,
    location: row.location,
    writer: null,
  });
}

async function loadFullWriterApplication(id: string) {
  const [r] = await db
    .select({ app: writerApplicationsTable, user: usersTable, profile: userProfilesTable })
    .from(writerApplicationsTable)
    .leftJoin(usersTable, eq(usersTable.id, writerApplicationsTable.userId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, writerApplicationsTable.userId))
    .where(eq(writerApplicationsTable.id, id));
  if (!r) return null;
  return {
    id: r.app.id,
    userId: r.app.userId ?? undefined,
    fullName: r.app.fullName,
    bio: r.app.bio,
    sampleLink: r.app.sampleLink,
    status: r.app.status as "pending" | "approved" | "rejected",
    moderationNote: r.app.moderationNote,
    createdAt: r.app.createdAt,
    user: r.user
      ? {
          id: r.user.id,
          displayName: r.profile?.displayName ?? r.user.email ?? "User",
          profileImageUrl: r.user.profileImageUrl,
          verified: r.profile?.isVerified ?? false,
        }
      : undefined,
  };
}


const router: IRouter = Router();
router.use(requireAdmin);

// --- dashboard ---

router.get("/admin/stats", async (_req, res): Promise<void> => {
  const [{ articles }] = await db
    .select({ articles: sql<number>`count(*)::int` })
    .from(articlesTable);
  const [{ published }] = await db
    .select({ published: sql<number>`count(*)::int` })
    .from(articlesTable)
    .where(eq(articlesTable.status, "published"));
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(articlesTable)
    .where(eq(articlesTable.status, "pending"));
  const [{ writers }] = await db
    .select({ writers: sql<number>`count(*)::int` })
    .from(userProfilesTable)
    .where(inArray(userProfilesTable.role, ["writer", "super_admin", "state_admin", "district_admin"]));
  const [{ readers }] = await db
    .select({ readers: sql<number>`count(*)::int` })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.role, "reader"));
  const [{ comments }] = await db
    .select({ comments: sql<number>`count(*)::int` })
    .from(commentsTable);
  const [{ totalViews }] = await db
    .select({ totalViews: sql<number>`coalesce(sum(${articlesTable.viewCount}),0)::int` })
    .from(articlesTable);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const publishedByDay = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${articlesTable.publishedAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(articlesTable)
    .where(and(eq(articlesTable.status, "published"), gte(articlesTable.publishedAt, since)))
    .groupBy(sql`date_trunc('day', ${articlesTable.publishedAt})`)
    .orderBy(sql`date_trunc('day', ${articlesTable.publishedAt})`);

  const byCategory = await db
    .select({
      categoryId: articlesTable.categoryId,
      slug: categoriesTable.slug,
      nameHi: categoriesTable.nameHi,
      nameEn: categoriesTable.nameEn,
      count: sql<number>`count(*)::int`,
    })
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .where(eq(articlesTable.status, "published"))
    .groupBy(articlesTable.categoryId, categoriesTable.slug, categoriesTable.nameHi, categoriesTable.nameEn);

  const byLocation = await db
    .select({
      locationId: articlesTable.locationId,
      slug: locationsTable.slug,
      type: locationsTable.type,
      nameHi: locationsTable.nameHi,
      nameEn: locationsTable.nameEn,
      count: sql<number>`count(*)::int`,
    })
    .from(articlesTable)
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(eq(articlesTable.status, "published"))
    .groupBy(articlesTable.locationId, locationsTable.slug, locationsTable.type, locationsTable.nameHi, locationsTable.nameEn);

  const recentRows = await db
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
    .where(eq(articlesTable.status, "published"))
    .orderBy(desc(articlesTable.publishedAt))
    .limit(8);

  const recentlyPublished = recentRows.map((r) => ({
    id: r.article.id,
    slug: r.article.slug,
    title: r.article.title,
    summary: r.article.summary,
    coverImageUrl: r.article.coverImageUrl,
    lang: r.article.lang as "hi" | "en",
    publishedAt: r.article.publishedAt,
    viewCount: r.article.viewCount,
    likeCount: r.article.likeCount,
    commentCount: r.article.commentCount,
    shareCount: r.article.shareCount,
    isBreaking: r.article.isBreaking,
    isFeatured: r.article.isFeatured,
    category: r.category ?? undefined,
    location: r.location ?? undefined,
    writer: r.writer
      ? {
          id: r.writer.id,
          displayName: r.profile?.displayName ?? r.writer.email ?? "Writer",
          profileImageUrl: r.writer.profileImageUrl,
          verified: r.profile?.isVerified ?? false,
        }
      : undefined,
  }));

  const topWriters = await db
    .select({
      id: usersTable.id,
      displayName: userProfilesTable.displayName,
      profileImageUrl: usersTable.profileImageUrl,
      verified: userProfilesTable.isVerified,
      bio: userProfilesTable.bio,
      followerCount: userProfilesTable.followerCount,
      articleCount: sql<number>`count(${articlesTable.id})::int`,
    })
    .from(usersTable)
    .innerJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
    .leftJoin(articlesTable, and(eq(articlesTable.writerId, usersTable.id), eq(articlesTable.status, "published")))
    .where(inArray(userProfilesTable.role, ["writer", "super_admin", "state_admin", "district_admin"]))
    .groupBy(usersTable.id, userProfilesTable.displayName, usersTable.profileImageUrl, userProfilesTable.isVerified, userProfilesTable.bio, userProfilesTable.followerCount)
    .orderBy(desc(sql`count(${articlesTable.id})`))
    .limit(8);

  const coverageGapsRaw = await db
    .select({
      id: locationsTable.id,
      slug: locationsTable.slug,
      type: locationsTable.type,
      nameHi: locationsTable.nameHi,
      nameEn: locationsTable.nameEn,
      followerCount: sql<number>`(select count(*)::int from ${followsLocationsTable} where ${followsLocationsTable.locationId} = ${locationsTable.id})`,
      writerCount: sql<number>`(select count(distinct ${articlesTable.writerId})::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id} and ${articlesTable.writerId} is not null and ${articlesTable.status} = 'published')`,
      recentArticleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id} and ${articlesTable.status} = 'published' and ${articlesTable.publishedAt} >= ${since})`,
    })
    .from(locationsTable);

  const coverageGaps = coverageGapsRaw
    .filter((row) => Number(row.followerCount) > 0 && (row.writerCount === 0 || row.recentArticleCount === 0))
    .sort((a, b) => Number(b.followerCount) - Number(a.followerCount))
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      nameHi: row.nameHi,
      nameEn: row.nameEn,
      type: row.type,
      followerCount: Number(row.followerCount),
      writerCount: Number(row.writerCount),
      recentArticleCount: Number(row.recentArticleCount),
    }));

  res.json(
    GetAdminDashboardStatsResponse.parse({
      totals: {
        articles: Number(articles),
        published: Number(published),
        pending: Number(pending),
        writers: Number(writers),
        readers: Number(readers),
        comments: Number(comments),
        totalViews: Number(totalViews),
      },
      pendingArticles: Number(pending),
      recentlyPublished,
      dailyPublishCounts: publishedByDay.map((p) => ({ date: p.day, count: Number(p.count) })),
      byCategory: byCategory
        .filter((b) => b.categoryId)
        .map((b) => ({
          category: {
            id: b.categoryId!,
            slug: b.slug ?? "",
            nameHi: b.nameHi ?? "",
            nameEn: b.nameEn ?? "",
          },
          count: Number(b.count),
        })),
      byLocation: byLocation
        .filter((b) => b.locationId)
        .map((b) => ({
          location: {
            id: b.locationId!,
            slug: b.slug ?? "",
            type: b.type ?? "",
            nameHi: b.nameHi ?? "",
            nameEn: b.nameEn ?? "",
          },
          count: Number(b.count),
        })),
      topWriters: topWriters.map((w) => ({
        id: w.id,
        displayName: w.displayName,
        profileImageUrl: w.profileImageUrl,
        bio: w.bio,
        verified: w.verified,
        articleCount: Number(w.articleCount),
        followerCount: Number(w.followerCount ?? 0),
      })),
      coverageGaps,
    }),
  );
});

// --- articles moderation ---

router.get("/admin/articles", async (req, res): Promise<void> => {
  const q = ListAdminArticlesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
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
    ...mapMyArticle({
      article: r.article,
      category: r.category,
      location: r.location,
      writer: null,
    }),
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
  if (b.data.body !== undefined) {
    update.body = b.data.body;
    const wordCount = b.data.body.replace(/<[^>]*>/g, "").trim().split(/\s+/).filter(Boolean).length;
    update.readingTimeMin = Math.max(1, Math.round(wordCount / 200));
  }
  if (b.data.lang !== undefined) update.lang = b.data.lang;
  if ("coverImageUrl" in b.data) update.coverImageUrl = b.data.coverImageUrl;
  if ("categoryId" in b.data) update.categoryId = b.data.categoryId;
  if ("locationId" in b.data) update.locationId = b.data.locationId;
  if (b.data.tags !== undefined) update.tags = b.data.tags;
  if (b.data.status !== undefined) {
    update.status = b.data.status;
    if (b.data.status === "published" && !existing.publishedAt) update.publishedAt = new Date();
  }
  if (b.data.isBreaking !== undefined) update.isBreaking = b.data.isBreaking;
  if (b.data.isFeatured !== undefined) update.isFeatured = b.data.isFeatured;
  if (b.data.isPinned !== undefined) update.isPinned = b.data.isPinned;
  const [a] = await db.update(articlesTable).set(update).where(eq(articlesTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.edit", "article", a.id);
  if (b.data.status === "published" && existing.status !== "published" && a.isBreaking) {
    void sendBreakingNewsPush({ articleId: a.id, slug: a.slug, title: a.title, summary: a.summary, categoryId: a.categoryId, locationId: a.locationId });
  }
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

router.post("/admin/articles/:id/approve", async (req, res): Promise<void> => {
  const p = ApproveArticleParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [a] = await db
    .update(articlesTable)
    .set({ status: "published", publishedAt: new Date(), moderationNote: null })
    .where(eq(articlesTable.id, p.data.id))
    .returning();
  if (!a) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }
  await audit(req.user!.id, "article.approve", "article", a.id);
  if (a.isBreaking) {
    void sendBreakingNewsPush({
      articleId: a.id,
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      categoryId: a.categoryId,
      locationId: a.locationId,
    });
  }
  void sendFollowedWriterPush({
    articleId: a.id,
    slug: a.slug,
    title: a.title,
    writerId: a.writerId,
  });
  res.json(ApproveArticleResponse.parse(await loadFullArticle(a.id)));
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
  if (!a) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }
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
  if (!a) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }
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
  const [a] = await db
    .update(articlesTable)
    .set(update)
    .where(eq(articlesTable.id, p.data.id))
    .returning();
  if (!a) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }
  await audit(req.user!.id, "article.update_flags", "article", a.id);
  if (
    b.data.isBreaking === true &&
    prev &&
    !prev.isBreaking &&
    a.status === "published"
  ) {
    void sendBreakingNewsPush({
      articleId: a.id,
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      categoryId: a.categoryId,
      locationId: a.locationId,
    });
  }
  res.json(UpdateArticleFlagsResponse.parse(await loadFullArticle(a.id)));
});

// --- users ---

router.get("/admin/users", async (req, res): Promise<void> => {
  const q = ListAdminUsersQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds = [];
  if (q.data.role) conds.push(eq(userProfilesTable.role, q.data.role));
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      displayName: userProfilesTable.displayName,
      profileImageUrl: usersTable.profileImageUrl,
      role: userProfilesTable.role,
      createdAt: userProfilesTable.createdAt,
      isVerified: userProfilesTable.isVerified,
      articleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.writerId} = ${usersTable.id})`,
    })
    .from(usersTable)
    .innerJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(userProfilesTable.createdAt))
    .limit(500);
  res.json(ListAdminUsersResponse.parse(rows));
});

router.patch("/admin/users/:id/role", async (req, res): Promise<void> => {
  const p = SetUserRoleParams.safeParse(req.params);
  const b = SetUserRoleBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [u] = await db
    .update(userProfilesTable)
    .set({ role: b.data.role, isWriterApproved: b.data.role === "writer" || ["super_admin", "state_admin", "district_admin"].includes(b.data.role) })
    .where(eq(userProfilesTable.userId, p.data.id))
    .returning();
  if (!u) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
    return;
  }
  await audit(req.user!.id, "user.set_role", "user", p.data.id, b.data.role);
  const [usr] = await db.select().from(usersTable).where(eq(usersTable.id, p.data.id));
  res.json(
    SetUserRoleResponse.parse({
      id: p.data.id,
      email: usr?.email ?? null,
      displayName: u.displayName,
      profileImageUrl: usr?.profileImageUrl ?? null,
      role: u.role,
      createdAt: u.createdAt,
    }),
  );
});

// --- writer location coverage ---

router.get("/admin/users/:id/locations", async (req, res): Promise<void> => {
  const p = ListWriterLocationsParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, p.data.id));
  if (!user) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
    return;
  }
  const rows = await db
    .select({
      id: locationsTable.id,
      slug: locationsTable.slug,
      type: locationsTable.type,
      nameHi: locationsTable.nameHi,
      nameEn: locationsTable.nameEn,
      articleCount: sql<number>`count(${articlesTable.id})::int`,
      lastPublishedAt: sql<Date | null>`max(${articlesTable.publishedAt})`,
    })
    .from(articlesTable)
    .innerJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(
      and(
        eq(articlesTable.writerId, p.data.id),
        eq(articlesTable.status, "published"),
      ),
    )
    .groupBy(locationsTable.id, locationsTable.slug, locationsTable.type, locationsTable.nameHi, locationsTable.nameEn)
    .orderBy(desc(sql`max(${articlesTable.publishedAt})`));
  res.json(
    ListWriterLocationsResponse.parse(
      rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        type: r.type,
        nameHi: r.nameHi,
        nameEn: r.nameEn,
        articleCount: r.articleCount,
        lastPublishedAt: r.lastPublishedAt ?? null,
      })),
    ),
  );
});

// --- writer applications ---

router.get("/admin/writer-applications", async (req, res): Promise<void> => {
  const q = ListWriterApplicationsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const rows = await db
    .select({
      app: writerApplicationsTable,
      user: usersTable,
      profile: userProfilesTable,
    })
    .from(writerApplicationsTable)
    .leftJoin(usersTable, eq(usersTable.id, writerApplicationsTable.userId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, writerApplicationsTable.userId))
    .where(q.data.status !== "all" ? eq(writerApplicationsTable.status, q.data.status) : undefined)
    .orderBy(desc(writerApplicationsTable.createdAt));
  res.json(
    ListWriterApplicationsResponse.parse(
      rows.map((r) => ({
        id: r.app.id,
        userId: r.app.userId ?? undefined,
        fullName: r.app.fullName,
        firstName: r.app.firstName,
        age: r.app.age,
        phone: r.app.phone,
        contactEmail: r.app.contactEmail,
        education: r.app.education,
        previousWork: r.app.previousWork,
        profession: r.app.profession,
        bio: r.app.bio,
        sampleLink: r.app.sampleLink,
        status: r.app.status as "pending" | "approved" | "rejected",
        moderationNote: r.app.moderationNote,
        createdAt: r.app.createdAt,
        user: r.user
          ? {
              id: r.user.id,
              displayName: r.profile?.displayName ?? r.user.email ?? "User",
              profileImageUrl: r.user.profileImageUrl,
              verified: r.profile?.isVerified ?? false,
            }
          : undefined,
      })),
    ),
  );
});

router.post("/admin/writer-applications/:id/approve", async (req, res): Promise<void> => {
  const p = ApproveWriterApplicationParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [app] = await db
    .update(writerApplicationsTable)
    .set({ status: "approved" })
    .where(eq(writerApplicationsTable.id, p.data.id))
    .returning();
  if (!app) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found" } });
    return;
  }
  if (app.userId) {
    await db
      .update(userProfilesTable)
      .set({ role: "writer", isWriterApproved: true })
      .where(eq(userProfilesTable.userId, app.userId));
  }
  await audit(req.user!.id, "writer_application.approve", "writer_application", app.id);
  res.json(ApproveWriterApplicationResponse.parse(await loadFullWriterApplication(app.id)));
});

router.post("/admin/writer-applications/:id/reject", async (req, res): Promise<void> => {
  const p = RejectWriterApplicationParams.safeParse(req.params);
  const b = RejectWriterApplicationBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [app] = await db
    .update(writerApplicationsTable)
    .set({ status: "rejected", moderationNote: b.data.note })
    .where(eq(writerApplicationsTable.id, p.data.id))
    .returning();
  if (!app) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found" } });
    return;
  }
  await audit(req.user!.id, "writer_application.reject", "writer_application", app.id, b.data.note);
  res.json(RejectWriterApplicationResponse.parse(await loadFullWriterApplication(app.id)));
});

// --- categories ---

router.get("/admin/categories", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: categoriesTable.id,
      slug: categoriesTable.slug,
      nameHi: categoriesTable.nameHi,
      nameEn: categoriesTable.nameEn,
      sortOrder: categoriesTable.sortOrder,
      articleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.categoryId} = ${categoriesTable.id})`,
    })
    .from(categoriesTable)
    .orderBy(categoriesTable.sortOrder);
  res.json(
    ListAdminCategoriesResponse.parse(
      rows.map((r) => ({ ...r, articleCount: Number(r.articleCount) })),
    ),
  );
});

router.post("/admin/categories", async (req, res): Promise<void> => {
  const b = CreateCategoryBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const [c] = await db
    .insert(categoriesTable)
    .values({
      slug: b.data.slug ?? slugify(b.data.nameEn),
      nameHi: b.data.nameHi,
      nameEn: b.data.nameEn,
      sortOrder: b.data.sortOrder ?? 0,
    })
    .returning();
  await audit(req.user!.id, "category.create", "category", c.id);
  res.status(201).json({ ...c, articleCount: 0 });
});

router.post("/admin/categories/reorder", async (req, res): Promise<void> => {
  const b = ReorderCategoriesBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const existing = await db.select().from(categoriesTable);
  const existingIds = new Set(existing.map((c) => c.id));
  const seen = new Set<string>();
  for (const id of b.data.ids) {
    if (!existingIds.has(id) || seen.has(id)) {
      res.status(400).json({ error: { code: "BAD_IDS", message: "ids must match categories and be unique" } });
      return;
    }
    seen.add(id);
  }
  if (b.data.ids.length !== existing.length) {
    res.status(400).json({ error: { code: "INCOMPLETE", message: "ids must include every category" } });
    return;
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < b.data.ids.length; i++) {
      await tx
        .update(categoriesTable)
        .set({ sortOrder: i })
        .where(eq(categoriesTable.id, b.data.ids[i]!));
    }
  });
  await audit(req.user!.id, "category.reorder", "category", null);
  const rows = await db
    .select({
      id: categoriesTable.id,
      slug: categoriesTable.slug,
      nameHi: categoriesTable.nameHi,
      nameEn: categoriesTable.nameEn,
      sortOrder: categoriesTable.sortOrder,
      articleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.categoryId} = ${categoriesTable.id})`,
    })
    .from(categoriesTable)
    .orderBy(categoriesTable.sortOrder);
  res.json(
    ReorderCategoriesResponse.parse(
      rows.map((r) => ({ ...r, articleCount: Number(r.articleCount) })),
    ),
  );
});

router.patch("/admin/categories/:id", async (req, res): Promise<void> => {
  const p = UpdateCategoryParams.safeParse(req.params);
  const b = UpdateCategoryBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const update: Record<string, unknown> = {};
  if (b.data.nameHi !== undefined) update.nameHi = b.data.nameHi;
  if (b.data.nameEn !== undefined) update.nameEn = b.data.nameEn;
  if (b.data.slug !== undefined) update.slug = b.data.slug;
  if (b.data.sortOrder !== undefined) update.sortOrder = b.data.sortOrder;
  const [c] = await db
    .update(categoriesTable)
    .set(update)
    .where(eq(categoriesTable.id, p.data.id))
    .returning();
  if (!c) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Category not found" } });
    return;
  }
  await audit(req.user!.id, "category.update", "category", c.id);
  res.json(
    UpdateCategoryResponse.parse({
      id: c.id,
      slug: c.slug,
      nameHi: c.nameHi,
      nameEn: c.nameEn,
      sortOrder: c.sortOrder,
    }),
  );
});

router.delete("/admin/categories/:id", async (req, res): Promise<void> => {
  const p = DeleteCategoryParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [c] = await db
    .delete(categoriesTable)
    .where(eq(categoriesTable.id, p.data.id))
    .returning();
  if (!c) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Category not found" } });
    return;
  }
  await audit(req.user!.id, "category.delete", "category", p.data.id);
  res.json(DeleteCategoryResponse.parse({ deleted: true }));
});

// --- locations & resources ---

const REQUIRED_PARENT_TYPE: Record<string, string | null> = {
  state: null,
  district: "state",
  assembly: "district",
  block: "district",
  village: "block",
};

async function validateParent(
  childType: string,
  parentId: string | null | undefined,
  selfId?: string,
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  const requiredType = REQUIRED_PARENT_TYPE[childType];
  if (!parentId) {
    if (requiredType) {
      return { ok: false, status: 400, code: "PARENT_REQUIRED", message: `A ${childType} must have a ${requiredType} parent` };
    }
    return { ok: true };
  }
  if (selfId && parentId === selfId) {
    return { ok: false, status: 400, code: "INVALID_PARENT", message: "A location cannot be its own parent" };
  }
  const [parent] = await db.select().from(locationsTable).where(eq(locationsTable.id, parentId));
  if (!parent) {
    return { ok: false, status: 400, code: "INVALID_PARENT", message: "Parent location not found" };
  }
  if (requiredType && parent.type !== requiredType) {
    return { ok: false, status: 400, code: "INVALID_PARENT_TYPE", message: `A ${childType} must be under a ${requiredType}, not a ${parent.type}` };
  }
  if (!requiredType) {
    return { ok: false, status: 400, code: "INVALID_PARENT", message: `A ${childType} cannot have a parent` };
  }
  if (selfId) {
    // Cycle prevention: walk up from candidate parent and ensure we never hit selfId
    let cursor: string | null = parent.parentId;
    const seen = new Set<string>([parent.id]);
    while (cursor) {
      if (cursor === selfId) {
        return { ok: false, status: 400, code: "INVALID_PARENT", message: "Cannot assign a descendant as parent" };
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const [next]: { parentId: string | null }[] = await db
        .select({ parentId: locationsTable.parentId })
        .from(locationsTable)
        .where(eq(locationsTable.id, cursor));
      cursor = next?.parentId ?? null;
    }
  }
  return { ok: true };
}

function mapLocation(
  r: typeof locationsTable.$inferSelect,
  articleCount = 0,
  writerCount = 0,
  followerCount = 0,
  writerArticleCount?: number,
) {
  return {
    id: r.id,
    slug: r.slug,
    type: r.type as "state" | "district" | "assembly" | "block" | "village",
    nameHi: r.nameHi,
    nameEn: r.nameEn,
    parentId: r.parentId,
    articleCount,
    writerCount,
    followerCount,
    ...(writerArticleCount !== undefined ? { writerArticleCount } : {}),
  };
}

const VALID_LOCATION_TYPES = ["state", "district", "assembly", "block", "village"] as const;
type LocationType = (typeof VALID_LOCATION_TYPES)[number];

router.get("/admin/locations/export.csv", async (req, res): Promise<void> => {
  const typesParam = typeof req.query.types === "string" ? req.query.types : undefined;
  const typeParam = typeof req.query.type === "string" ? req.query.type : undefined;

  const rawTypes = typesParam ?? typeParam;
  let filterTypes: LocationType[] | undefined;

  if (rawTypes !== undefined) {
    const parts = rawTypes.split(",").map((s) => s.trim()).filter(Boolean);
    const invalid = parts.find((p) => !(VALID_LOCATION_TYPES as readonly string[]).includes(p));
    if (invalid) {
      res.status(400).json({ error: `Invalid type "${invalid}". Must be one of: ${VALID_LOCATION_TYPES.join(", ")}` });
      return;
    }
    filterTypes = parts.length > 0 ? (parts as LocationType[]) : undefined;
  }

  const parentLoc = alias(locationsTable, "parent_loc");
  const conds = filterTypes && filterTypes.length > 0 ? [inArray(locationsTable.type, filterTypes)] : [];
  const rows = await db
    .select({ loc: locationsTable, parentSlug: parentLoc.slug })
    .from(locationsTable)
    .leftJoin(parentLoc, eq(parentLoc.id, locationsTable.parentId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(locationsTable.type), asc(locationsTable.nameEn));

  const escape = (v: string | null | undefined) => {
    const s = v ?? "";
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const filename =
    filterTypes && filterTypes.length > 0
      ? `locations-${filterTypes.join("-")}.csv`
      : "locations.csv";

  const lines: string[] = ["type,slug,name_hi,name_en,parent_slug"];
  for (const r of rows) {
    lines.push(
      [
        escape(r.loc.type),
        escape(r.loc.slug),
        escape(r.loc.nameHi),
        escape(r.loc.nameEn),
        escape(r.parentSlug),
      ].join(","),
    );
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\r\n"));
});

router.get("/admin/locations", async (req, res): Promise<void> => {
  const q = ListAdminLocationsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds = [];
  if (q.data.type) conds.push(eq(locationsTable.type, q.data.type));
  if (q.data.parentId) conds.push(eq(locationsTable.parentId, q.data.parentId));
  if (q.data.writerId) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${articlesTable} WHERE ${articlesTable.locationId} = ${locationsTable.id} AND ${articlesTable.writerId} = ${q.data.writerId} AND ${articlesTable.status} = 'published')`,
    );
  }
  if (q.data.coverage === "has_writers") {
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${articlesTable} WHERE ${articlesTable.locationId} = ${locationsTable.id} AND ${articlesTable.writerId} IS NOT NULL)`,
    );
  } else if (q.data.coverage === "no_writers") {
    conds.push(
      sql`NOT EXISTS (SELECT 1 FROM ${articlesTable} WHERE ${articlesTable.locationId} = ${locationsTable.id} AND ${articlesTable.writerId} IS NOT NULL)`,
    );
  }
  const writerId = q.data.writerId;
  const rows = await db
    .select({
      loc: locationsTable,
      articleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id})`,
      writerCount: sql<number>`(select count(distinct ${articlesTable.writerId})::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id} and ${articlesTable.writerId} is not null)`,
      followerCount: sql<number>`(select count(*)::int from ${followsLocationsTable} where ${followsLocationsTable.locationId} = ${locationsTable.id})`,
      writerArticleCount: writerId
        ? sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id} and ${articlesTable.writerId} = ${writerId} and ${articlesTable.status} = 'published')`
        : sql<number>`0`,
    })
    .from(locationsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(locationsTable.nameEn));
  res.json(
    ListAdminLocationsResponse.parse(
      rows.map((r) =>
        mapLocation(
          r.loc,
          Number(r.articleCount),
          Number(r.writerCount),
          Number(r.followerCount),
          writerId ? Number(r.writerArticleCount) : undefined,
        ),
      ),
    ),
  );
});

router.get("/admin/locations/dormant-writers", async (req, res): Promise<void> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const rows = await db.execute(sql`
    WITH writer_last_pub AS (
      SELECT
        a.location_id,
        a.writer_id,
        MAX(a.published_at) AS last_published
      FROM ${articlesTable} a
      WHERE a.status = 'published'
      GROUP BY a.location_id, a.writer_id
    )
    SELECT
      l.id,
      l.slug,
      l.name_hi AS "nameHi",
      l.name_en AS "nameEn",
      l.type,
      COUNT(wlp.writer_id) FILTER (WHERE wlp.last_published <= ${thirtyDaysAgo}) AS "inactiveWriterCount",
      COUNT(wlp.writer_id) AS "totalWriterCount"
    FROM writer_last_pub wlp
    JOIN ${locationsTable} l ON l.id = wlp.location_id
    GROUP BY l.id, l.slug, l.name_hi, l.name_en, l.type
    HAVING COUNT(wlp.writer_id) FILTER (WHERE wlp.last_published <= ${thirtyDaysAgo}) > 0
    ORDER BY "inactiveWriterCount" DESC
    LIMIT 10
  `);
  res.json(
    rows.rows.map((r: any) => ({
      id: String(r.id),
      slug: String(r.slug),
      nameHi: String(r.nameHi),
      nameEn: String(r.nameEn),
      type: String(r.type),
      inactiveWriterCount: Number(r.inactiveWriterCount),
      totalWriterCount: Number(r.totalWriterCount),
    })),
  );
});

router.get("/admin/locations/:id/writers", async (req, res): Promise<void> => {
  const p = ListLocationWritersParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [loc] = await db.select({ id: locationsTable.id }).from(locationsTable).where(eq(locationsTable.id, p.data.id));
  if (!loc) {
    res.status(404).json({ error: "Location not found" });
    return;
  }
  const rows = await db
    .select({
      id: usersTable.id,
      displayName: userProfilesTable.displayName,
      profileImageUrl: usersTable.profileImageUrl,
      role: userProfilesTable.role,
      articleCount: sql<number>`count(${articlesTable.id})::int`,
      lastPublishedAt: sql<Date | null>`max(${articlesTable.publishedAt})`,
    })
    .from(articlesTable)
    .innerJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .innerJoin(userProfilesTable, eq(userProfilesTable.userId, articlesTable.writerId))
    .where(
      and(
        eq(articlesTable.locationId, p.data.id),
        eq(articlesTable.status, "published"),
      ),
    )
    .groupBy(usersTable.id, userProfilesTable.displayName, usersTable.profileImageUrl, userProfilesTable.role)
    .orderBy(desc(sql`max(${articlesTable.publishedAt})`));
  res.json(
    ListLocationWritersResponse.parse(
      rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        profileImageUrl: r.profileImageUrl ?? null,
        role: r.role,
        articleCount: r.articleCount,
        lastPublishedAt: r.lastPublishedAt ?? null,
      })),
    ),
  );
});

router.post("/admin/locations", async (req, res): Promise<void> => {
  const b = CreateLocationBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const slug = slugify(b.data.slug);
  if (!slug) {
    res.status(400).json({ error: { code: "INVALID_SLUG", message: "Slug is required" } });
    return;
  }
  const parentCheck = await validateParent(b.data.type, b.data.parentId ?? null);
  if (!parentCheck.ok) {
    res.status(parentCheck.status).json({ error: { code: parentCheck.code, message: parentCheck.message } });
    return;
  }
  const [existing] = await db.select().from(locationsTable).where(eq(locationsTable.slug, slug));
  if (existing) {
    res.status(409).json({ error: { code: "SLUG_TAKEN", message: "Slug already in use" } });
    return;
  }
  const [loc] = await db
    .insert(locationsTable)
    .values({
      slug,
      type: b.data.type,
      nameHi: b.data.nameHi,
      nameEn: b.data.nameEn,
      parentId: b.data.parentId ?? null,
    })
    .returning();
  await audit(req.user!.id, "location.create", "location", loc.id, slug);
  res.status(201).json(mapLocation(loc, 0));
});

router.patch("/admin/locations/:id", async (req, res): Promise<void> => {
  const p = UpdateLocationParams.safeParse(req.params);
  const b = UpdateLocationBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [current] = await db.select().from(locationsTable).where(eq(locationsTable.id, p.data.id));
  if (!current) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } });
    return;
  }
  const nextType = b.data.type ?? current.type;
  const nextParentId =
    b.data.parentId !== undefined ? (b.data.parentId ?? null) : current.parentId;
  if (b.data.type !== undefined || b.data.parentId !== undefined) {
    const parentCheck = await validateParent(nextType, nextParentId, p.data.id);
    if (!parentCheck.ok) {
      res.status(parentCheck.status).json({ error: { code: parentCheck.code, message: parentCheck.message } });
      return;
    }
  }
  const update: Record<string, unknown> = {};
  if (b.data.slug !== undefined) {
    const slug = slugify(b.data.slug);
    if (!slug) {
      res.status(400).json({ error: { code: "INVALID_SLUG", message: "Slug is required" } });
      return;
    }
    const [other] = await db.select().from(locationsTable).where(eq(locationsTable.slug, slug));
    if (other && other.id !== p.data.id) {
      res.status(409).json({ error: { code: "SLUG_TAKEN", message: "Slug already in use" } });
      return;
    }
    update.slug = slug;
  }
  if (b.data.type !== undefined) update.type = b.data.type;
  if (b.data.nameHi !== undefined) update.nameHi = b.data.nameHi;
  if (b.data.nameEn !== undefined) update.nameEn = b.data.nameEn;
  if (b.data.parentId !== undefined) update.parentId = b.data.parentId;
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: { code: "EMPTY_UPDATE", message: "Provide at least one field to update" } });
    return;
  }
  const [loc] = await db
    .update(locationsTable)
    .set(update)
    .where(eq(locationsTable.id, p.data.id))
    .returning();
  if (!loc) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } });
    return;
  }
  await audit(req.user!.id, "location.update", "location", loc.id, loc.slug);
  res.json(UpdateLocationResponse.parse(mapLocation(loc, 0)));
});

router.delete("/admin/locations/:id", async (req, res): Promise<void> => {
  const p = DeleteLocationParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [children] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(locationsTable)
    .where(eq(locationsTable.parentId, p.data.id));
  if (Number(children?.count ?? 0) > 0) {
    res.status(409).json({ error: { code: "HAS_CHILDREN", message: "Remove or reassign child locations first" } });
    return;
  }
  const [loc] = await db
    .delete(locationsTable)
    .where(eq(locationsTable.id, p.data.id))
    .returning();
  if (!loc) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } });
    return;
  }
  await audit(req.user!.id, "location.delete", "location", p.data.id, loc.slug);
  res.json(DeleteLocationResponse.parse({ deleted: true }));
});

router.post("/admin/locations/import", async (req, res): Promise<void> => {
  const b = ImportLocationsBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const rows = b.data.rows;
  const dryRun = b.data.dryRun ?? false;
  // Build cache of slug -> {id, type} including existing DB rows for parent lookups.
  const allExisting = await db
    .select({ id: locationsTable.id, slug: locationsTable.slug, type: locationsTable.type })
    .from(locationsTable);
  const bySlug = new Map<string, { id: string; type: string }>();
  for (const r of allExisting) bySlug.set(r.slug, { id: r.id, type: r.type });

  const results: Array<{
    row: number;
    status: "created" | "skipped" | "failed";
    slug: string | null;
    message: string | null;
    location:
      | {
          id: string;
          slug: string;
          type: "state" | "district" | "assembly" | "block" | "village";
          nameHi: string;
          nameEn: string;
          parentId: string | null;
          articleCount: number;
        }
      | null;
  }> = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 1;
    const slug = slugify(raw.slug);
    if (!slug) {
      results.push({ row: rowNum, status: "failed", slug: null, message: "Slug is required", location: null });
      failed++;
      continue;
    }
    if (bySlug.has(slug)) {
      results.push({ row: rowNum, status: "skipped", slug, message: "Slug already exists", location: null });
      skipped++;
      continue;
    }
    const nameHi = raw.nameHi?.trim();
    const nameEn = raw.nameEn?.trim();
    if (!nameHi || !nameEn) {
      results.push({ row: rowNum, status: "failed", slug, message: "nameHi and nameEn are required", location: null });
      failed++;
      continue;
    }
    let parentId: string | null = null;
    const requiredParentType = REQUIRED_PARENT_TYPE[raw.type];
    const parentSlug = raw.parentSlug ? slugify(raw.parentSlug) : null;
    if (requiredParentType) {
      if (!parentSlug) {
        results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} requires a parent_slug (${requiredParentType})`, location: null });
        failed++;
        continue;
      }
      const parent = bySlug.get(parentSlug);
      if (!parent) {
        results.push({ row: rowNum, status: "failed", slug, message: `Parent slug "${parentSlug}" not found`, location: null });
        failed++;
        continue;
      }
      if (parent.type !== requiredParentType) {
        results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} must be under a ${requiredParentType}, not a ${parent.type}`, location: null });
        failed++;
        continue;
      }
      parentId = parent.id;
    } else if (parentSlug) {
      results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} cannot have a parent`, location: null });
      failed++;
      continue;
    }

    if (dryRun) {
      // Simulate the row being created so subsequent rows can resolve it as a parent,
      // and so duplicate slugs within the same CSV are correctly caught as skipped.
      bySlug.set(slug, { id: `dry-run-${slug}`, type: raw.type });
      results.push({
        row: rowNum,
        status: "created",
        slug,
        message: null,
        location: {
          id: `dry-run-${slug}`,
          slug,
          type: raw.type,
          nameHi,
          nameEn,
          parentId,
          articleCount: 0,
        },
      });
      created++;
    } else {
      try {
        const [loc] = await db
          .insert(locationsTable)
          .values({ slug, type: raw.type, nameHi, nameEn, parentId })
          .returning();
        bySlug.set(slug, { id: loc.id, type: loc.type });
        results.push({
          row: rowNum,
          status: "created",
          slug,
          message: null,
          location: mapLocation(loc, 0),
        });
        created++;
      } catch (e: unknown) {
        results.push({ row: rowNum, status: "failed", slug, message: String((e as Error)?.message ?? e), location: null });
        failed++;
      }
    }
  }

  if (!dryRun) {
    await audit(req.user!.id, "location.import", "location", null, `created=${created} skipped=${skipped} failed=${failed}`);
  }
  res.json(ImportLocationsResponse.parse({ dryRun, created, skipped, failed, results }));
});

router.post("/admin/locations/import-stream", async (req, res): Promise<void> => {
  const b = ImportLocationsBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const rows = b.data.rows;
  const dryRun = b.data.dryRun ?? false;
  const total = rows.length;

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const allExisting = await db
    .select({ id: locationsTable.id, slug: locationsTable.slug, type: locationsTable.type })
    .from(locationsTable);
  const bySlug = new Map<string, { id: string; type: string }>();
  for (const r of allExisting) bySlug.set(r.slug, { id: r.id, type: r.type });

  const results: Array<{
    row: number;
    status: "created" | "skipped" | "failed";
    slug: string | null;
    message: string | null;
    location:
      | {
          id: string;
          slug: string;
          type: "state" | "district" | "assembly" | "block" | "village";
          nameHi: string;
          nameEn: string;
          parentId: string | null;
          articleCount: number;
        }
      | null;
  }> = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  function sendLine(obj: unknown) {
    res.write(JSON.stringify(obj) + "\n");
  }

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 1;
    const slug = slugify(raw.slug);
    if (!slug) {
      results.push({ row: rowNum, status: "failed", slug: null, message: "Slug is required", location: null });
      failed++;
    } else if (bySlug.has(slug)) {
      results.push({ row: rowNum, status: "skipped", slug, message: "Slug already exists", location: null });
      skipped++;
    } else {
      const nameHi = raw.nameHi?.trim();
      const nameEn = raw.nameEn?.trim();
      if (!nameHi || !nameEn) {
        results.push({ row: rowNum, status: "failed", slug, message: "nameHi and nameEn are required", location: null });
        failed++;
      } else {
        let parentId: string | null = null;
        const requiredParentType = REQUIRED_PARENT_TYPE[raw.type];
        const parentSlug = raw.parentSlug ? slugify(raw.parentSlug) : null;
        let rowFailed = false;
        if (requiredParentType) {
          if (!parentSlug) {
            results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} requires a parent_slug (${requiredParentType})`, location: null });
            failed++;
            rowFailed = true;
          } else {
            const parent = bySlug.get(parentSlug);
            if (!parent) {
              results.push({ row: rowNum, status: "failed", slug, message: `Parent slug "${parentSlug}" not found`, location: null });
              failed++;
              rowFailed = true;
            } else if (parent.type !== requiredParentType) {
              results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} must be under a ${requiredParentType}, not a ${parent.type}`, location: null });
              failed++;
              rowFailed = true;
            } else {
              parentId = parent.id;
            }
          }
        } else if (parentSlug) {
          results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} cannot have a parent`, location: null });
          failed++;
          rowFailed = true;
        }
        if (!rowFailed) {
          if (dryRun) {
            bySlug.set(slug, { id: `dry-run-${slug}`, type: raw.type });
            results.push({ row: rowNum, status: "created", slug, message: null, location: { id: `dry-run-${slug}`, slug, type: raw.type, nameHi, nameEn, parentId, articleCount: 0 } });
            created++;
          } else {
            try {
              const [loc] = await db
                .insert(locationsTable)
                .values({ slug, type: raw.type, nameHi, nameEn, parentId })
                .returning();
              bySlug.set(slug, { id: loc.id, type: loc.type });
              results.push({ row: rowNum, status: "created", slug, message: null, location: mapLocation(loc, 0) });
              created++;
            } catch (e: unknown) {
              results.push({ row: rowNum, status: "failed", slug, message: String((e as Error)?.message ?? e), location: null });
              failed++;
            }
          }
        }
      }
    }
    sendLine({ type: "progress", processed: rowNum, total });
  }

  if (!dryRun) {
    await audit(req.user!.id, "location.import", "location", null, `created=${created} skipped=${skipped} failed=${failed}`);
  }
  sendLine({ type: "done", dryRun, created, skipped, failed, results: ImportLocationsResponse.shape.results.parse(results) });
  res.end();
});

async function loadLocationBySlug(slug: string) {
  const [loc] = await db.select().from(locationsTable).where(eq(locationsTable.slug, slug));
  return loc;
}

function mapResource(r: typeof locationResourcesTable.$inferSelect) {
  return {
    id: r.id,
    category: r.category as
      | "administration"
      | "police"
      | "health"
      | "education"
      | "emergency"
      | "utility"
      | "other",
    nameHi: r.nameHi,
    nameEn: r.nameEn,
    phone: r.phone,
    address: r.address,
    mapsQuery: r.mapsQuery,
    sortOrder: r.sortOrder,
  };
}

router.get("/admin/locations/:slug/resources", async (req, res): Promise<void> => {
  const p = ListAdminLocationResourcesParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } });
    return;
  }
  const rows = await db
    .select()
    .from(locationResourcesTable)
    .where(eq(locationResourcesTable.locationId, loc.id))
    .orderBy(asc(locationResourcesTable.sortOrder), asc(locationResourcesTable.nameEn));
  res.json(ListAdminLocationResourcesResponse.parse(rows.map(mapResource)));
});

router.post("/admin/locations/:slug/resources", async (req, res): Promise<void> => {
  const p = CreateLocationResourceParams.safeParse(req.params);
  const b = CreateLocationResourceBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } });
    return;
  }
  const [r] = await db
    .insert(locationResourcesTable)
    .values({
      locationId: loc.id,
      category: b.data.category,
      nameHi: b.data.nameHi,
      nameEn: b.data.nameEn,
      phone: b.data.phone ?? null,
      address: b.data.address ?? null,
      mapsQuery: b.data.mapsQuery ?? null,
      sortOrder: b.data.sortOrder ?? 0,
    })
    .returning();
  await audit(req.user!.id, "location_resource.create", "location_resource", r.id, loc.slug);
  res.status(201).json(mapResource(r));
});

router.patch("/admin/locations/:slug/resources/:id", async (req, res): Promise<void> => {
  const p = UpdateLocationResourceParams.safeParse(req.params);
  const b = UpdateLocationResourceBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } });
    return;
  }
  const update: Record<string, unknown> = {};
  if (b.data.category !== undefined) update.category = b.data.category;
  if (b.data.nameHi !== undefined) update.nameHi = b.data.nameHi;
  if (b.data.nameEn !== undefined) update.nameEn = b.data.nameEn;
  if (b.data.phone !== undefined) update.phone = b.data.phone;
  if (b.data.address !== undefined) update.address = b.data.address;
  if (b.data.mapsQuery !== undefined) update.mapsQuery = b.data.mapsQuery;
  if (b.data.sortOrder !== undefined) update.sortOrder = b.data.sortOrder;
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: { code: "EMPTY_UPDATE", message: "Provide at least one field to update" } });
    return;
  }
  const [r] = await db
    .update(locationResourcesTable)
    .set(update)
    .where(
      and(
        eq(locationResourcesTable.id, p.data.id),
        eq(locationResourcesTable.locationId, loc.id),
      ),
    )
    .returning();
  if (!r) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
    return;
  }
  await audit(req.user!.id, "location_resource.update", "location_resource", r.id, loc.slug);
  res.json(UpdateLocationResourceResponse.parse(mapResource(r)));
});

router.post("/admin/locations/:slug/resources/reorder", async (req, res): Promise<void> => {
  const p = ReorderLocationResourcesParams.safeParse(req.params);
  const b = ReorderLocationResourcesBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } });
    return;
  }
  const existing = await db
    .select()
    .from(locationResourcesTable)
    .where(eq(locationResourcesTable.locationId, loc.id));
  const existingIds = new Set(existing.map((r) => r.id));
  const seen = new Set<string>();
  for (const id of b.data.ids) {
    if (!existingIds.has(id) || seen.has(id)) {
      res.status(400).json({ error: { code: "BAD_IDS", message: "ids must match resources for this location and be unique" } });
      return;
    }
    seen.add(id);
  }
  if (b.data.ids.length !== existing.length) {
    res.status(400).json({ error: { code: "INCOMPLETE", message: "ids must include every resource for this location" } });
    return;
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < b.data.ids.length; i++) {
      await tx
        .update(locationResourcesTable)
        .set({ sortOrder: i })
        .where(
          and(
            eq(locationResourcesTable.id, b.data.ids[i]!),
            eq(locationResourcesTable.locationId, loc.id),
          ),
        );
    }
  });
  await audit(req.user!.id, "location_resource.reorder", "location", loc.id, loc.slug);
  const rows = await db
    .select()
    .from(locationResourcesTable)
    .where(eq(locationResourcesTable.locationId, loc.id))
    .orderBy(asc(locationResourcesTable.sortOrder), asc(locationResourcesTable.nameEn));
  res.json(ReorderLocationResourcesResponse.parse(rows.map(mapResource)));
});

router.delete("/admin/locations/:slug/resources/:id", async (req, res): Promise<void> => {
  const p = DeleteLocationResourceParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } });
    return;
  }
  const [r] = await db
    .delete(locationResourcesTable)
    .where(
      and(
        eq(locationResourcesTable.id, p.data.id),
        eq(locationResourcesTable.locationId, loc.id),
      ),
    )
    .returning();
  if (!r) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
    return;
  }
  await audit(req.user!.id, "location_resource.delete", "location_resource", p.data.id, loc.slug);
  res.json(DeleteLocationResourceResponse.parse({ deleted: true }));
});

// --- audit log ---

router.get("/admin/audit-log", async (req, res): Promise<void> => {
  const q = ListAdminAuditLogQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const rows = await db
    .select({
      log: auditLogTable,
      user: usersTable,
      profile: userProfilesTable,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogTable.actorId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, auditLogTable.actorId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(q.data.limit);
  res.json(
    ListAdminAuditLogResponse.parse(
      rows.map((r) => ({
        id: r.log.id,
        action: r.log.action,
        targetType: r.log.targetType,
        targetId: r.log.targetId,
        note: r.log.note,
        createdAt: r.log.createdAt,
        actor: {
          id: r.user?.id ?? "",
          displayName: r.profile?.displayName ?? r.user?.email ?? "System",
          profileImageUrl: r.user?.profileImageUrl,
          verified: r.profile?.isVerified ?? false,
        },
      })),
    ),
  );
});

// --- team invitations ---

router.get("/admin/team/invitations", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(teamInvitationsTable)
    .orderBy(desc(teamInvitationsTable.createdAt));
  res.json(ListTeamInvitationsResponse.parse(rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    phone: r.phone,
    role: r.role,
    notes: r.notes,
    createdAt: r.createdAt,
  }))));
});

router.post("/admin/team/invitations", async (req, res): Promise<void> => {
  const b = CreateTeamInvitationBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const emailLower = b.data.email.toLowerCase().trim();
  try {
    const [inv] = await db
      .insert(teamInvitationsTable)
      .values({
        email: emailLower,
        displayName: b.data.displayName,
        phone: b.data.phone ?? null,
        role: b.data.role,
        notes: b.data.notes ?? null,
        invitedBy: req.user!.id,
      })
      .onConflictDoUpdate({
        target: teamInvitationsTable.email,
        set: {
          displayName: b.data.displayName,
          phone: b.data.phone ?? null,
          role: b.data.role,
          notes: b.data.notes ?? null,
          invitedBy: req.user!.id,
        },
      })
      .returning();
    await audit(req.user!.id, "team.invite", "team_invitation", inv.id, emailLower);
    res.status(201).json({
      id: inv.id,
      email: inv.email,
      displayName: inv.displayName,
      phone: inv.phone,
      role: inv.role,
      notes: inv.notes,
      createdAt: inv.createdAt,
    });
  } catch {
    res.status(409).json({ error: { code: "CONFLICT", message: "Invitation already exists for this email" } });
  }
});

router.delete("/admin/team/invitations/:id", async (req, res): Promise<void> => {
  const p = DeleteTeamInvitationParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [deleted] = await db
    .delete(teamInvitationsTable)
    .where(eq(teamInvitationsTable.id, p.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Invitation not found" } });
    return;
  }
  await audit(req.user!.id, "team.cancel_invite", "team_invitation", p.data.id);
  res.status(204).send();
});

const VALIDATION_REPORT_MAX_BYTES = 5 * 1024 * 1024;

router.post("/admin/locations/validation-report/share", async (req, res): Promise<void> => {
  const b = CreateValidationReportShareBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  if (Buffer.byteLength(b.data.csvContent, "utf8") > VALIDATION_REPORT_MAX_BYTES) {
    res.status(413).json({ error: "Report CSV exceeds the 5 MB size limit." });
    return;
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(validationReportSharesTable).values({
    token,
    csvContent: b.data.csvContent,
    rowCount: b.data.rowCount,
    failedCount: b.data.failedCount,
    createdByUserId: req.user!.id,
    expiresAt,
  });
  db.delete(validationReportSharesTable)
    .where(lt(validationReportSharesTable.expiresAt, new Date()))
    .catch((err) => { logger.warn({ err }, "Failed to clean up expired validation report shares"); });
  res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
});

// --- notifications ---

router.post("/admin/notifications/send", async (req, res): Promise<void> => {
  const { title, body, type, audience } = req.body as {
    title?: string;
    body?: string;
    type?: string;
    audience?: string;
  };
  if (!title?.trim() || !body?.trim()) {
    res.status(400).json({ error: { code: "MISSING_FIELDS", message: "title and body are required" } });
    return;
  }
  const validAudiences = ["all", "writers", "readers"] as const;
  const aud = (validAudiences as readonly string[]).includes(audience ?? "") ? (audience as "all" | "writers" | "readers") : "all";
  const { sendBroadcastPush } = await import("../lib/push");
  const result = await sendBroadcastPush({ title: title.trim(), body: body.trim(), audience: aud, data: { type: type ?? "general" } });
  await audit(req.user!.id, "notification.send", "notification", null, `audience=${aud} sent=${result.sent}`);
  res.json({ ok: true, sent: result.sent });
});

// --- clear seed data (super_admin only) ---

const SEED_USER_IDS = [
  "seed-admin",
  "writer-rajesh",
  "writer-anita",
  "writer-vikram",
  "writer-priya",
  "writer-pending",
  "state-admin",
  "district-admin-bastar",
  "moderator-1",
  "reader-demo",
];

router.delete("/admin/seed-data", async (req, res): Promise<void> => {
  const profile = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user!.id))
    .then((r) => r[0]);

  if (profile?.role !== "super_admin") {
    res.status(403).json({ error: "Super admin only" });
    return;
  }

  const deleted = await db
    .delete(articlesTable)
    .where(inArray(articlesTable.writerId, SEED_USER_IDS))
    .returning({ id: articlesTable.id });

  await audit(req.user!.id, "seed.clear", "article", null, `deleted=${deleted.length}`);
  res.json({ deleted: deleted.length });
});

export default router;
