import { Router, type IRouter } from "express";
import { requireSuperAdmin } from "../../middleware/requireRole";
import {
  db,
  articlesTable,
  locationsTable,
  usersTable,
  userProfilesTable,
  writerApplicationsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  ListAdminUsersQueryParams,
  ListAdminUsersResponse,
  SetUserRoleParams,
  SetUserRoleBody,
  SetUserRoleResponse,
  DeleteAdminUserParams,
  DeleteAdminUserResponse,
  ListWriterApplicationsQueryParams,
  ListWriterApplicationsResponse,
  ApproveWriterApplicationParams,
  ApproveWriterApplicationResponse,
  RejectWriterApplicationParams,
  RejectWriterApplicationBody,
  RejectWriterApplicationResponse,
  ListWriterLocationsParams,
  ListWriterLocationsResponse,
} from "@workspace/api-zod";
import { audit } from "../../utils/audit";

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

router.get("/admin/users", async (req, res): Promise<void> => {
  const q = ListAdminUsersQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
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

router.patch("/admin/users/:id/role", requireSuperAdmin, async (req, res): Promise<void> => {
  const p = SetUserRoleParams.safeParse(req.params);
  const b = SetUserRoleBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [u] = await db
    .update(userProfilesTable)
    .set({
      role: b.data.role,
      isWriterApproved:
        b.data.role === "writer" || ["super_admin", "state_admin", "district_admin"].includes(b.data.role),
    })
    .where(eq(userProfilesTable.userId, p.data.id))
    .returning();
  if (!u) { res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } }); return; }
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

router.delete("/admin/users/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const p = DeleteAdminUserParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (p.data.id === req.user!.id) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "You cannot delete your own account" } });
    return;
  }
  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, p.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } }); return; }
  await audit(req.user!.id, "user.delete", "user", p.data.id);
  res.json(DeleteAdminUserResponse.parse({ ok: true }));
});

router.get("/admin/users/:id/locations", async (req, res): Promise<void> => {
  const p = ListWriterLocationsParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, p.data.id));
  if (!user) { res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } }); return; }
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
    .where(and(eq(articlesTable.writerId, p.data.id), eq(articlesTable.status, "published")))
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

router.get("/admin/writer-applications", async (req, res): Promise<void> => {
  const q = ListWriterApplicationsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const rows = await db
    .select({ app: writerApplicationsTable, user: usersTable, profile: userProfilesTable })
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
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [app] = await db
    .update(writerApplicationsTable)
    .set({ status: "approved" })
    .where(eq(writerApplicationsTable.id, p.data.id))
    .returning();
  if (!app) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found" } }); return; }
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
  if (!app) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found" } }); return; }
  await audit(req.user!.id, "writer_application.reject", "writer_application", app.id, b.data.note);
  res.json(RejectWriterApplicationResponse.parse(await loadFullWriterApplication(app.id)));
});

export default router;
