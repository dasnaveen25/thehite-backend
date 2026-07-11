import { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  userProfilesTable,
  articleBookmarksTable,
  articlesTable,
  categoriesTable,
  locationsTable,
  followsWritersTable,
  followsCategoriesTable,
  followsLocationsTable,
  pushPrefsCategoriesTable,
  pushPrefsLocationsTable,
  writerApplicationsTable,
  deviceTokensTable,
  breakingPushDeliveriesTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  GetMyProfileResponse,
  UpdateMyProfileBody,
  UpdateMyProfileResponse,
  ListMyBookmarksResponse,
  ListMyFollowsResponse,
  ApplyToBeWriterBody,
  RegisterDeviceTokenBody,
  RegisterDeviceTokenResponse,
  UnregisterDeviceTokenBody,
  UnregisterDeviceTokenResponse,
  GetMyPushPrefsResponse,
  UpdateMyPushPrefsBody,
  UpdateMyPushPrefsResponse,
  ListMyAlertsResponse,
  ListMyAlertsQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middleware/requireRole";
import { mapArticleCard } from "../utils/mappers";

// Public router — no auth middleware
const publicRouter: IRouter = Router();

// Authenticated router — all routes require a valid token
const router: IRouter = Router();
router.use(requireAuth);

async function loadProfile(userId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  let [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  if (!profile) {
    const displayName =
      [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
      user?.email ||
      "Reader";
    [profile] = await db
      .insert(userProfilesTable)
      .values({ userId, displayName })
      .returning();
  }
  return { user, profile };
}

router.get("/me/profile", async (req, res): Promise<void> => {
  const { user, profile } = await loadProfile(req.user!.id);
  res.json(
    GetMyProfileResponse.parse({
      id: req.user!.id,
      email: user?.email,
      firstName: user?.firstName,
      lastName: user?.lastName,
      profileImageUrl: user?.profileImageUrl,
      displayName: profile.displayName,
      role: profile.role,
      isWriter:
        profile.role === "writer" ||
        ["super_admin", "state_admin", "district_admin"].includes(profile.role),
      bio: profile.bio,
      languagePref: (profile.languagePref as "hi" | "en") ?? "hi",
      notifPushEnabled: profile.notifPushEnabled,
      notifBreakingScope:
        (profile.notifBreakingScope as "all" | "filtered") ?? "all",
      notifFollowedWriters: profile.notifFollowedWriters,
    }),
  );
});

router.patch("/me/profile", async (req, res): Promise<void> => {
  const b = UpdateMyProfileBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  await loadProfile(req.user!.id);
  const update: Record<string, unknown> = {};
  if (b.data.displayName !== undefined) update.displayName = b.data.displayName;
  if (b.data.bio !== undefined) update.bio = b.data.bio;
  if (b.data.languagePref !== undefined)
    update.languagePref = b.data.languagePref;
  if (b.data.notifPushEnabled !== undefined)
    update.notifPushEnabled = b.data.notifPushEnabled;
  if (b.data.notifBreakingScope !== undefined)
    update.notifBreakingScope = b.data.notifBreakingScope;
  if (b.data.notifFollowedWriters !== undefined)
    update.notifFollowedWriters = b.data.notifFollowedWriters;
  if (Object.keys(update).length) {
    await db
      .update(userProfilesTable)
      .set(update)
      .where(eq(userProfilesTable.userId, req.user!.id));
  }
  const { user, profile } = await loadProfile(req.user!.id);
  res.json(
    UpdateMyProfileResponse.parse({
      id: req.user!.id,
      email: user?.email,
      firstName: user?.firstName,
      lastName: user?.lastName,
      profileImageUrl: user?.profileImageUrl,
      displayName: profile.displayName,
      role: profile.role,
      isWriter:
        profile.role === "writer" ||
        ["super_admin", "state_admin", "district_admin"].includes(profile.role),
      bio: profile.bio,
      languagePref: (profile.languagePref as "hi" | "en") ?? "hi",
      notifPushEnabled: profile.notifPushEnabled,
      notifBreakingScope:
        (profile.notifBreakingScope as "all" | "filtered") ?? "all",
      notifFollowedWriters: profile.notifFollowedWriters,
    }),
  );
});

router.get("/me/push-prefs", async (req, res): Promise<void> => {
  const uid = req.user!.id;
  const cats = await db
    .select({ categoryId: pushPrefsCategoriesTable.categoryId })
    .from(pushPrefsCategoriesTable)
    .where(eq(pushPrefsCategoriesTable.userId, uid));
  const locs = await db
    .select({ locationId: pushPrefsLocationsTable.locationId })
    .from(pushPrefsLocationsTable)
    .where(eq(pushPrefsLocationsTable.userId, uid));
  res.json(
    GetMyPushPrefsResponse.parse({
      categoryIds: cats.map((r) => r.categoryId),
      locationIds: locs.map((r) => r.locationId),
    }),
  );
});

router.put("/me/push-prefs", async (req, res): Promise<void> => {
  const b = UpdateMyPushPrefsBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const uid = req.user!.id;
  await loadProfile(uid);
  const catIds = Array.from(new Set(b.data.categoryIds));
  const locIds = Array.from(new Set(b.data.locationIds));

  // Validate that requested ids exist
  const validCats = catIds.length
    ? await db
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(inArray(categoriesTable.id, catIds))
    : [];
  const validLocs = locIds.length
    ? await db
        .select({ id: locationsTable.id })
        .from(locationsTable)
        .where(inArray(locationsTable.id, locIds))
    : [];
  const okCats = validCats.map((r) => r.id);
  const okLocs = validLocs.map((r) => r.id);

  await db.transaction(async (tx) => {
    await tx
      .delete(pushPrefsCategoriesTable)
      .where(eq(pushPrefsCategoriesTable.userId, uid));
    await tx
      .delete(pushPrefsLocationsTable)
      .where(eq(pushPrefsLocationsTable.userId, uid));
    if (okCats.length) {
      await tx
        .insert(pushPrefsCategoriesTable)
        .values(okCats.map((categoryId) => ({ userId: uid, categoryId })));
    }
    if (okLocs.length) {
      await tx
        .insert(pushPrefsLocationsTable)
        .values(okLocs.map((locationId) => ({ userId: uid, locationId })));
    }
  });
  res.json(
    UpdateMyPushPrefsResponse.parse({
      categoryIds: okCats,
      locationIds: okLocs,
    }),
  );
});

router.post("/me/device-tokens", async (req, res): Promise<void> => {
  const b = RegisterDeviceTokenBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  await loadProfile(req.user!.id);
  await db
    .insert(deviceTokensTable)
    .values({
      token: b.data.token,
      userId: req.user!.id,
      platform: b.data.platform ?? "expo",
    })
    .onConflictDoUpdate({
      target: deviceTokensTable.token,
      set: {
        userId: req.user!.id,
        platform: b.data.platform ?? "expo",
        updatedAt: new Date(),
      },
    });
  res.json(RegisterDeviceTokenResponse.parse({ registered: true }));
});

router.delete("/me/device-tokens", async (req, res): Promise<void> => {
  const b = UnregisterDeviceTokenBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const result = await db
    .delete(deviceTokensTable)
    .where(
      and(
        eq(deviceTokensTable.token, b.data.token),
        eq(deviceTokensTable.userId, req.user!.id),
      ),
    )
    .returning();
  res.json(UnregisterDeviceTokenResponse.parse({ deleted: result.length > 0 }));
});

router.get("/me/alerts", async (req, res): Promise<void> => {
  const q = ListMyAlertsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const limit = q.data.limit ?? 50;
  const rows = await db
    .select({
      delivery: breakingPushDeliveriesTable,
      article: articlesTable,
      category: categoriesTable,
    })
    .from(breakingPushDeliveriesTable)
    .leftJoin(
      articlesTable,
      eq(articlesTable.id, breakingPushDeliveriesTable.articleId),
    )
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .where(eq(breakingPushDeliveriesTable.userId, req.user!.id))
    .orderBy(desc(breakingPushDeliveriesTable.sentAt))
    .limit(limit);

  const items = rows.map((r) => ({
    id: r.delivery.id,
    articleId: r.delivery.articleId,
    slug: r.article?.slug ?? r.delivery.slug,
    title: r.article?.title ?? r.delivery.title,
    summary: r.article?.summary ?? r.delivery.summary,
    sentAt: r.delivery.sentAt,
    coverImageUrl: r.article?.coverImageUrl ?? null,
    category: r.category
      ? {
          id: r.category.id,
          slug: r.category.slug,
          nameHi: r.category.nameHi,
          nameEn: r.category.nameEn,
        }
      : undefined,
  }));
  res.json(ListMyAlertsResponse.parse(items));
});

router.get("/me/bookmarks", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      article: articlesTable,
      category: categoriesTable,
      location: locationsTable,
      writer: usersTable,
      profile: userProfilesTable,
    })
    .from(articleBookmarksTable)
    .innerJoin(
      articlesTable,
      eq(articlesTable.id, articleBookmarksTable.articleId),
    )
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .leftJoin(
      userProfilesTable,
      eq(userProfilesTable.userId, articlesTable.writerId),
    )
    .where(eq(articleBookmarksTable.userId, req.user!.id))
    .orderBy(desc(articleBookmarksTable.createdAt));

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
  res.json(ListMyBookmarksResponse.parse(items));
});

router.get("/me/follows", async (req, res): Promise<void> => {
  const uid = req.user!.id;
  const writers = await db
    .select({
      id: usersTable.id,
      displayName: userProfilesTable.displayName,
      profileImageUrl: usersTable.profileImageUrl,
      verified: userProfilesTable.isVerified,
    })
    .from(followsWritersTable)
    .innerJoin(usersTable, eq(usersTable.id, followsWritersTable.writerId))
    .leftJoin(
      userProfilesTable,
      eq(userProfilesTable.userId, followsWritersTable.writerId),
    )
    .where(eq(followsWritersTable.followerId, uid));
  const categories = await db
    .select()
    .from(followsCategoriesTable)
    .innerJoin(
      categoriesTable,
      eq(categoriesTable.id, followsCategoriesTable.categoryId),
    )
    .where(eq(followsCategoriesTable.userId, uid));
  const locations = await db
    .select()
    .from(followsLocationsTable)
    .innerJoin(
      locationsTable,
      eq(locationsTable.id, followsLocationsTable.locationId),
    )
    .where(eq(followsLocationsTable.userId, uid));
  res.json(
    ListMyFollowsResponse.parse({
      writers: writers.map((w) => ({
        id: w.id,
        displayName: w.displayName ?? "Writer",
        profileImageUrl: w.profileImageUrl,
        verified: w.verified ?? false,
      })),
      categories: categories.map((row) => ({
        id: row.categories.id,
        slug: row.categories.slug,
        nameHi: row.categories.nameHi,
        nameEn: row.categories.nameEn,
      })),
      locations: locations.map((row) => ({
        id: row.locations.id,
        slug: row.locations.slug,
        type: row.locations.type,
        nameHi: row.locations.nameHi,
        nameEn: row.locations.nameEn,
      })),
    }),
  );
});

publicRouter.get("/me/writer-application", async (req, res): Promise<void> => {
  const [app] = await db
    .select()
    .from(writerApplicationsTable)
    .where(eq(writerApplicationsTable.userId, req.user!.id))
    .orderBy(desc(writerApplicationsTable.createdAt))
    .limit(1);
  if (!app) {
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "No application found" } });
    return;
  }
  res.json({
    id: app.id,
    fullName: app.fullName,
    status: app.status,
    moderationNote: app.moderationNote ?? null,
    createdAt: app.createdAt,
  });
});

publicRouter.post("/me/writer-application", async (req, res): Promise<void> => {
  const b = ApplyToBeWriterBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(writerApplicationsTable)
    .where(
      and(
        eq(writerApplicationsTable.userId, req.user!.id),
        eq(writerApplicationsTable.status, "pending"),
      ),
    );
  if (existing) {
    res.status(409).json({
      error: { code: "EXISTS", message: "Application already pending" },
    });
    return;
  }
  const [app] = await db
    .insert(writerApplicationsTable)
    .values({
      userId: req.user!.id,
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
});

// Merge both routers and export
const combinedRouter: IRouter = Router();
combinedRouter.use(publicRouter);
combinedRouter.use(router);
export default combinedRouter;
