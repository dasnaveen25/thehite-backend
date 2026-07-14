import { Router, type IRouter } from "express";
import { readSiteSettings } from "./admin/site-settings";
import { readDonationSettings } from "./admin/donations";
import {
  db,
  articlesTable,
  categoriesTable,
  locationsTable,
  locationResourcesTable,
  usersTable,
  userProfilesTable,
  articleLikesTable,
  articleBookmarksTable,
  followsWritersTable,
  validationReportSharesTable,
  writerApplicationsTable,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import {
  ListArticlesQueryParams,
  ListArticlesResponse,
  ListFeaturedArticlesResponse,
  ListBreakingArticlesResponse,
  ListTrendingArticlesResponse,
  GetArticleBySlugParams,
  GetArticleBySlugResponse,
  ListRelatedArticlesParams,
  ListRelatedArticlesResponse,
  ListWritersQueryParams,
  ListWritersResponse,
  ListPopularWritersResponse,
  GetWriterParams,
  GetWriterResponse,
  ListWriterArticlesParams,
  ListWriterArticlesResponse,
  ListCategoriesResponse,
  ListLocationsQueryParams,
  ListLocationsResponse,
  GetLocationParams,
  GetLocationResponse,
  ListLocationResourcesParams,
  ListLocationResourcesResponse,
  SearchEverythingQueryParams,
  SearchEverythingResponse,
  ApplyToBeWriterBody,
} from "@workspace/api-zod";
import { mapArticleCard, mapArticleDetail } from "../utils/mappers";

const router: IRouter = Router();

const PUBLISHED = eq(articlesTable.status, "published");

const articleJoinSelection = {
  article: articlesTable,
  category: categoriesTable,
  location: locationsTable,
  writer: {
    id: usersTable.id,
    email: usersTable.email,
    profileImageUrl: usersTable.profileImageUrl,
  },
  profile: {
    displayName: userProfilesTable.displayName,
    isVerified: userProfilesTable.isVerified,
  },
};

async function selectArticleCards(where: ReturnType<typeof and>, limit = 20, offset = 0) {
  const rows = await db
    .select(articleJoinSelection)
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, articlesTable.writerId))
    .where(where)
    .orderBy(desc(articlesTable.publishedAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) =>
    mapArticleCard({
      article: r.article,
      category: r.category,
      location: r.location,
      writer: r.writer
        ? {
            id: r.writer.id,
            displayName: r.profile?.displayName ?? r.writer.email ?? "Writer",
            profileImageUrl: r.writer.profileImageUrl,
            isVerified: r.profile?.isVerified ?? false,
          }
        : null,
    }),
  );
}

router.get("/articles", async (req, res): Promise<void> => {
  const q = ListArticlesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const { category, locationType, locationSlug, writerId, sort, lang, limit, offset, q: search, hasVideo } = q.data;

  const conds = [PUBLISHED, isNotNull(articlesTable.publishedAt)];
  if (lang && lang !== "all") conds.push(eq(articlesTable.lang, lang));
  if (writerId) conds.push(eq(articlesTable.writerId, writerId));
  if (hasVideo) conds.push(
    or(
      isNotNull(articlesTable.youtubeUrl),
      sql`${articlesTable.coverImageUrl} ILIKE '%.mp4'`,
      sql`${articlesTable.body} ILIKE '%youtube.com/embed/%'`,
      sql`${articlesTable.body} ILIKE '%<video%'`
    )!
  );
  if (search) {
    conds.push(or(ilike(articlesTable.title, `%${search}%`), ilike(articlesTable.summary, `%${search}%`))!);
  }

  if (category) {
    const [cat] = await db.select().from(categoriesTable).where(eq(categoriesTable.slug, category));
    if (cat) conds.push(eq(articlesTable.categoryId, cat.id));
    else {
      res.json(ListArticlesResponse.parse({ items: [], total: 0, limit, offset }));
      return;
    }
  }

  if (locationSlug) {
    const [loc] = await db.select().from(locationsTable).where(eq(locationsTable.slug, locationSlug));
    if (loc) {
      if (locationType && loc.type !== locationType) {
        res.json(ListArticlesResponse.parse({ items: [], total: 0, limit, offset }));
        return;
      }
      // Include articles from the location itself AND all descendant locations
      const allLocs = await db.select({ id: locationsTable.id, parentId: locationsTable.parentId }).from(locationsTable);
      const descIds = new Set<string>([loc.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const l of allLocs) {
          if (l.parentId && descIds.has(l.parentId) && !descIds.has(l.id)) {
            descIds.add(l.id);
            changed = true;
          }
        }
      }
      conds.push(inArray(articlesTable.locationId, [...descIds]));
    } else {
      res.json(ListArticlesResponse.parse({ items: [], total: 0, limit, offset }));
      return;
    }
  }

  const where = and(...conds);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articlesTable)
    .where(where);

  let orderExpr;
  switch (sort) {
    case "trending":
      orderExpr = desc(sql`(${articlesTable.viewCount} + ${articlesTable.likeCount} * 5)`);
      break;
    case "mostViewed":
      orderExpr = desc(articlesTable.viewCount);
      break;
    default:
      orderExpr = desc(articlesTable.publishedAt);
  }

  const rows = await db
    .select(articleJoinSelection)
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, articlesTable.writerId))
    .where(where)
    .orderBy(orderExpr)
    .limit(limit)
    .offset(offset);

  const items = rows.map((r) =>
    mapArticleCard({
      article: r.article,
      category: r.category,
      location: r.location,
      writer: r.writer
        ? {
            id: r.writer.id,
            displayName: r.profile?.displayName ?? r.writer.email ?? "Writer",
            profileImageUrl: r.writer.profileImageUrl,
            isVerified: r.profile?.isVerified ?? false,
          }
        : null,
    }),
  );

  res.json(ListArticlesResponse.parse({ items, total: count, limit, offset, hasMore: offset + items.length < count }));
});

router.get("/articles/featured", async (_req, res): Promise<void> => {
  const items = await selectArticleCards(and(PUBLISHED, eq(articlesTable.isFeatured, true)), 15);
  res.json(ListFeaturedArticlesResponse.parse(items));
});

router.get("/articles/breaking", async (_req, res): Promise<void> => {
  const items = await selectArticleCards(and(PUBLISHED, eq(articlesTable.isBreaking, true)), 10);
  res.json(ListBreakingArticlesResponse.parse(items));
});

router.get("/articles/trending", async (_req, res): Promise<void> => {
  const rows = await db
    .select(articleJoinSelection)
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, articlesTable.writerId))
    .where(PUBLISHED)
    .orderBy(desc(sql`(${articlesTable.viewCount} + ${articlesTable.likeCount} * 5)`))
    .limit(10);
  const items = rows.map((r) =>
    mapArticleCard({
      article: r.article,
      category: r.category,
      location: r.location,
      writer: r.writer
        ? {
            id: r.writer.id,
            displayName: r.profile?.displayName ?? r.writer.email ?? "Writer",
            profileImageUrl: r.writer.profileImageUrl,
            isVerified: r.profile?.isVerified ?? false,
          }
        : null,
    }),
  );
  res.json(ListTrendingArticlesResponse.parse(items));
});

router.get("/articles/by-slug/:slug", async (req, res): Promise<void> => {
  const p = GetArticleBySlugParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }

  const cleanSlug = p.data.slug.replace(/^blog-/i, "");
  const isNumeric = /^\d+$/.test(cleanSlug);
  const whereCond = isNumeric
    ? or(eq(articlesTable.slug, `blog-${cleanSlug}`), eq(articlesTable.slug, cleanSlug))
    : eq(articlesTable.slug, p.data.slug);

  const [row] = await db
    .select(articleJoinSelection)
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, articlesTable.writerId))
    .where(and(whereCond!, PUBLISHED));

  if (!row) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }

  let isLiked = false;
  let isBookmarked = false;
  if (req.user?.id) {
    const uid = req.user.id;
    const [liked] = await db
      .select()
      .from(articleLikesTable)
      .where(and(eq(articleLikesTable.articleId, row.article.id), eq(articleLikesTable.userId, uid)));
    const [bm] = await db
      .select()
      .from(articleBookmarksTable)
      .where(and(eq(articleBookmarksTable.articleId, row.article.id), eq(articleBookmarksTable.userId, uid)));
    isLiked = !!liked;
    isBookmarked = !!bm;
  }

  const data = mapArticleDetail(
    {
      article: row.article,
      category: row.category,
      location: row.location,
      writer: row.writer
        ? {
            id: row.writer.id,
            displayName: row.profile?.displayName ?? row.writer.email ?? "Writer",
            profileImageUrl: row.writer.profileImageUrl,
            isVerified: row.profile?.isVerified ?? false,
          }
        : null,
    },
    isLiked,
    isBookmarked,
  );

  res.json(GetArticleBySlugResponse.parse(data));
});

router.get("/articles/by-no/:no", async (req, res): Promise<void> => {
  const no = parseInt(req.params.no, 10);
  if (isNaN(no)) {
    res.status(400).json({ error: "Invalid article number" });
    return;
  }
  const [row] = await db
    .select(articleJoinSelection)
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, articlesTable.writerId))
    .where(and(or(eq(articlesTable.slug, `blog-${no}`), eq(articlesTable.slug, String(no))), PUBLISHED));

  if (!row) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }

  let isLiked = false;
  let isBookmarked = false;
  if (req.user?.id) {
    const uid = req.user.id;
    const [liked] = await db
      .select()
      .from(articleLikesTable)
      .where(and(eq(articleLikesTable.articleId, row.article.id), eq(articleLikesTable.userId, uid)));
    const [bm] = await db
      .select()
      .from(articleBookmarksTable)
      .where(and(eq(articleBookmarksTable.articleId, row.article.id), eq(articleBookmarksTable.userId, uid)));
    isLiked = !!liked;
    isBookmarked = !!bm;
  }

  const data = mapArticleDetail(
    {
      article: row.article,
      category: row.category,
      location: row.location,
      writer: row.writer
        ? {
            id: row.writer.id,
            displayName: row.profile?.displayName ?? row.writer.email ?? "Writer",
            profileImageUrl: row.writer.profileImageUrl,
            isVerified: row.profile?.isVerified ?? false,
          }
        : null,
    },
    isLiked,
    isBookmarked,
  );

  res.json(GetArticleBySlugResponse.parse(data));
});

router.get("/articles/:id/related", async (req, res): Promise<void> => {
  const p = ListRelatedArticlesParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [base] = await db.select().from(articlesTable).where(eq(articlesTable.id, p.data.id));
  if (!base) {
    res.json(ListRelatedArticlesResponse.parse([]));
    return;
  }
  const conds = [PUBLISHED, ne(articlesTable.id, base.id)];
  if (base.categoryId) conds.push(eq(articlesTable.categoryId, base.categoryId));
  const items = await selectArticleCards(and(...conds), 6);
  res.json(ListRelatedArticlesResponse.parse(items));
});

// --- writers ---

async function listWriterRows(limit: number, sort: "popular" | "recent" | "alphabetical") {
  let orderExpr;
  switch (sort) {
    case "recent":
      orderExpr = desc(userProfilesTable.createdAt);
      break;
    case "alphabetical":
      orderExpr = asc(userProfilesTable.displayName);
      break;
    default:
      orderExpr = desc(userProfilesTable.followerCount);
  }

  const rows = await db
    .select({
      id: usersTable.id,
      displayName: userProfilesTable.displayName,
      profileImageUrl: usersTable.profileImageUrl,
      bio: userProfilesTable.bio,
      verified: userProfilesTable.isVerified,
      followerCount: userProfilesTable.followerCount,
      role: userProfilesTable.role,
      isWriterApproved: userProfilesTable.isWriterApproved,
      articleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.writerId} = ${usersTable.id} and ${articlesTable.status} = 'published')`,
    })
    .from(userProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, userProfilesTable.userId))
    .where(
      or(
        eq(userProfilesTable.role, "writer"),
        eq(userProfilesTable.role, "super_admin"),
        eq(userProfilesTable.role, "state_admin"),
        eq(userProfilesTable.role, "district_admin"),
      ),
    )
    .orderBy(orderExpr)
    .limit(limit);
  return rows;
}

router.get("/writers", async (req, res): Promise<void> => {
  const q = ListWritersQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const rows = await listWriterRows(q.data.limit, q.data.sort);
  res.json(
    ListWritersResponse.parse(
      rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        profileImageUrl: r.profileImageUrl,
        bio: r.bio,
        verified: r.verified,
        articleCount: Number(r.articleCount),
        followerCount: r.followerCount,
      })),
    ),
  );
});

router.get("/writers/popular", async (_req, res): Promise<void> => {
  const rows = await listWriterRows(8, "popular");
  res.json(
    ListPopularWritersResponse.parse(
      rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        profileImageUrl: r.profileImageUrl,
        bio: r.bio,
        verified: r.verified,
        articleCount: Number(r.articleCount),
        followerCount: r.followerCount,
      })),
    ),
  );
});

router.get("/writers/:id", async (req, res): Promise<void> => {
  const p = GetWriterParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, p.data.id));
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, p.data.id));
  if (!user || !profile) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Writer not found" } });
    return;
  }
  const [{ articleCount }] = await db
    .select({ articleCount: sql<number>`count(*)::int` })
    .from(articlesTable)
    .where(and(eq(articlesTable.writerId, user.id), PUBLISHED));

  let isFollowing = false;
  if (req.user?.id) {
    const [f] = await db
      .select()
      .from(followsWritersTable)
      .where(and(eq(followsWritersTable.followerId, req.user.id), eq(followsWritersTable.writerId, user.id)));
    isFollowing = !!f;
  }

  res.json(
    GetWriterResponse.parse({
      id: user.id,
      displayName: profile.displayName,
      profileImageUrl: user.profileImageUrl,
      bio: profile.bio,
      verified: profile.isVerified,
      articleCount: Number(articleCount),
      followerCount: profile.followerCount,
      joinedAt: profile.createdAt,
      isFollowing,
    }),
  );
});

router.get("/writers/:id/articles", async (req, res): Promise<void> => {
  const p = ListWriterArticlesParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const items = await selectArticleCards(and(PUBLISHED, eq(articlesTable.writerId, p.data.id)), 50);
  res.json(ListWriterArticlesResponse.parse(items));
});

// --- categories ---

router.get("/categories", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: categoriesTable.id,
      slug: categoriesTable.slug,
      nameHi: categoriesTable.nameHi,
      nameEn: categoriesTable.nameEn,
      sortOrder: categoriesTable.sortOrder,
      articleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.categoryId} = ${categoriesTable.id} and ${articlesTable.status} = 'published')`,
    })
    .from(categoriesTable)
    .orderBy(categoriesTable.sortOrder);
  res.json(
    ListCategoriesResponse.parse(
      rows.map((r) => ({ ...r, articleCount: Number(r.articleCount) })),
    ),
  );
});

// --- locations ---

router.get("/locations", async (req, res): Promise<void> => {
  const q = ListLocationsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const { writerId } = q.data;
  const conds = [];
  if (q.data.type) conds.push(eq(locationsTable.type, q.data.type));
  if (q.data.parentId) conds.push(eq(locationsTable.parentId, q.data.parentId));
  const rows = await db
    .select({
      id: locationsTable.id,
      slug: locationsTable.slug,
      type: locationsTable.type,
      nameHi: locationsTable.nameHi,
      nameEn: locationsTable.nameEn,
      parentId: locationsTable.parentId,
      writerArticleCount: writerId
        ? sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id} and ${articlesTable.writerId} = ${writerId} and ${articlesTable.status} = 'published')`
        : sql<number>`null`,
    })
    .from(locationsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(locationsTable.nameEn)
    .limit(500);
  res.json(
    ListLocationsResponse.parse(
      rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        type: r.type as "state" | "district" | "assembly" | "block" | "village",
        nameHi: r.nameHi,
        nameEn: r.nameEn,
        parentId: r.parentId,
        ...(writerId != null ? { writerArticleCount: r.writerArticleCount } : {}),
      })),
    ),
  );
});

router.get("/locations/:slug", async (req, res): Promise<void> => {
  const p = GetLocationParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [loc] = await db.select().from(locationsTable).where(eq(locationsTable.slug, p.data.slug));
  if (!loc) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } });
    return;
  }
  const [{ articleCount }] = await db
    .select({ articleCount: sql<number>`count(*)::int` })
    .from(articlesTable)
    .where(and(eq(articlesTable.locationId, loc.id), PUBLISHED));
  res.json(
    GetLocationResponse.parse({
      id: loc.id,
      slug: loc.slug,
      type: loc.type as "state" | "district" | "assembly" | "block" | "village",
      nameHi: loc.nameHi,
      nameEn: loc.nameEn,
      parentId: loc.parentId,
      articleCount: Number(articleCount),
    }),
  );
});

router.get("/locations/:slug/resources", async (req, res): Promise<void> => {
  const p = ListLocationResourcesParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [loc] = await db.select().from(locationsTable).where(eq(locationsTable.slug, p.data.slug));
  if (!loc) {
    res.json(ListLocationResourcesResponse.parse([]));
    return;
  }
  const rows = await db
    .select()
    .from(locationResourcesTable)
    .where(eq(locationResourcesTable.locationId, loc.id))
    .orderBy(asc(locationResourcesTable.sortOrder), asc(locationResourcesTable.nameEn));
  res.json(
    ListLocationResourcesResponse.parse(
      rows.map((r) => ({
        id: r.id,
        category: r.category as "administration" | "police" | "health" | "education" | "emergency" | "utility" | "other",
        nameHi: r.nameHi,
        nameEn: r.nameEn,
        phone: r.phone,
        address: r.address,
        mapsQuery: r.mapsQuery,
        sortOrder: r.sortOrder,
      })),
    ),
  );
});

// --- search ---

router.get("/search", async (req, res): Promise<void> => {
  const q = SearchEverythingQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const term = `%${q.data.q}%`;
  const articleItems = await selectArticleCards(
    and(PUBLISHED, or(ilike(articlesTable.title, term), ilike(articlesTable.summary, term))!),
    20,
  );

  const writers = await db
    .select({
      id: usersTable.id,
      displayName: userProfilesTable.displayName,
      profileImageUrl: usersTable.profileImageUrl,
      bio: userProfilesTable.bio,
      verified: userProfilesTable.isVerified,
      followerCount: userProfilesTable.followerCount,
    })
    .from(userProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, userProfilesTable.userId))
    .where(
      and(
        ilike(userProfilesTable.displayName, term),
        inArray(userProfilesTable.role, ["writer", "super_admin", "state_admin", "district_admin"]),
      ),
    )
    .limit(10);

  const categories = await db
    .select()
    .from(categoriesTable)
    .where(or(ilike(categoriesTable.nameHi, term), ilike(categoriesTable.nameEn, term))!)
    .limit(10);

  const locations = await db
    .select()
    .from(locationsTable)
    .where(or(ilike(locationsTable.nameHi, term), ilike(locationsTable.nameEn, term))!)
    .limit(10);

  res.json(
    SearchEverythingResponse.parse({
      articles: articleItems,
      writers: writers.map((w) => ({
        id: w.id,
        displayName: w.displayName,
        profileImageUrl: w.profileImageUrl,
        bio: w.bio,
        verified: w.verified,
        followerCount: w.followerCount,
        articleCount: 0,
      })),
      categories: categories.map((c) => ({
        id: c.id,
        slug: c.slug,
        nameHi: c.nameHi,
        nameEn: c.nameEn,
      })),
      locations: locations.map((l) => ({
        id: l.id,
        slug: l.slug,
        type: l.type,
        nameHi: l.nameHi,
        nameEn: l.nameEn,
      })),
    }),
  );
});

const reportDownloadHits = new Map<string, { count: number; windowStart: number }>();
const REPORT_DOWNLOAD_LIMIT = 30;
const REPORT_DOWNLOAD_WINDOW_MS = 60_000;

router.get("/locations/validation-report/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const hit = reportDownloadHits.get(ip);
  if (hit && now - hit.windowStart < REPORT_DOWNLOAD_WINDOW_MS) {
    hit.count += 1;
    if (hit.count > REPORT_DOWNLOAD_LIMIT) {
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }
  } else {
    reportDownloadHits.set(ip, { count: 1, windowStart: now });
  }
  const [share] = await db
    .select()
    .from(validationReportSharesTable)
    .where(eq(validationReportSharesTable.token, token));
  if (!share) {
    res.status(404).json({ error: "Report not found or link has expired." });
    return;
  }
  if (share.expiresAt < new Date()) {
    res.status(410).json({ error: "This share link has expired." });
    return;
  }
  const created = new Date(share.createdAt);
  const date = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="validation-report-${date}.csv"`);
  res.send(share.csvContent);
});

router.get("/donation-settings", async (_req, res): Promise<void> => {
  try {
    const d = await readDonationSettings();
    const { razorpayKeyId: _rpKey, ...pub } = d;
    res.json(pub);
  } catch (err) {
    console.error("public donation-settings error:", err);
    res.json({ upiAccounts: [], bankName: "", accountNumber: "", ifsc: "", accountName: "", donationEnabled: false, subtitle: "", contactEmail: "", thankYouMessage: "", campaigns: [] });
  }
});

// Basic in-memory rate limit for the public application form: max 3 per IP per hour.
const APPLY_RATE_WINDOW_MS = 60 * 60 * 1000;
const APPLY_RATE_MAX = 3;
const applyRateHits = new Map<string, number[]>();

function applyRateLimited(ip: string): boolean {
  const now = Date.now();
  if (applyRateHits.size > 5000) {
    for (const [key, times] of applyRateHits) {
      if (times.every((t) => now - t >= APPLY_RATE_WINDOW_MS)) applyRateHits.delete(key);
    }
  }
  const hits = (applyRateHits.get(ip) ?? []).filter((t) => now - t < APPLY_RATE_WINDOW_MS);
  if (hits.length >= APPLY_RATE_MAX) {
    applyRateHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  applyRateHits.set(ip, hits);
  return false;
}

// Public writer application – no login required. If the visitor happens to be
// logged in we link the application to their account, otherwise userId is null.
router.post("/writer-applications", async (req, res): Promise<void> => {
  const b = ApplyToBeWriterBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || "unknown";
  if (applyRateLimited(ip)) {
    res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many applications. Please try again later." } });
    return;
  }
  try {
    const userId = req.user?.id ?? null;
    if (userId) {
      const [existing] = await db
        .select()
        .from(writerApplicationsTable)
        .where(and(eq(writerApplicationsTable.userId, userId), eq(writerApplicationsTable.status, "pending")));
      if (existing) {
        res.status(409).json({ error: { code: "EXISTS", message: "Application already pending" } });
        return;
      }
    }
    const [app] = await db
      .insert(writerApplicationsTable)
      .values({
        userId,
        fullName: b.data.fullName,
        firstName: b.data.firstName ?? null,
        age: b.data.age ?? null,
        phone: b.data.phone ?? null,
        contactEmail: b.data.contactEmail ?? null,
        education: b.data.education ?? null,
        previousWork: b.data.previousWork ?? null,
        profession: b.data.profession ?? null,
        bio: b.data.bio,
        sampleLink: b.data.sampleLink ?? null,
      })
      .returning();
    res.status(201).json({
      id: app.id,
      fullName: app.fullName,
      status: app.status,
      createdAt: app.createdAt,
    });
  } catch (err) {
    console.error("public writer-application error:", err);
    res.status(500).json({ error: { code: "SUBMIT_FAILED", message: "Failed to submit application. Please try again." } });
  }
});

// Public site-settings – strips sensitive/admin-only fields
router.get("/site-settings", async (_req, res): Promise<void> => {
  try {
    const s = await readSiteSettings();
    const { googleAnalyticsId: _ga, requireEmailVerification: _rev, ...pub } = s;
    res.json(pub);
  } catch (err) {
    console.error("public site-settings error:", err);
    res.status(500).json({ error: { code: "READ_FAILED", message: "Failed to read site settings" } });
  }
});

export default router;
