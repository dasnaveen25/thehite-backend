/**
 * ONE-TIME password reset endpoint.
 * Call: POST /api/admin/reset-admin-password
 * Body: { "secret": "<RESET_SECRET from .env>", "newPassword": "AdminThehit@2026" }
 * DELETE THIS FILE after use.
 */
import { Router, type IRouter } from "express";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, accountsTable } from "@workspace/db";

const router: IRouter = Router();

router.post("/admin/reset-admin-password", async (req, res): Promise<void> => {
  const { secret, newPassword } = req.body as { secret?: string; newPassword?: string };

  const expectedSecret = process.env.RESET_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: "newPassword must be at least 8 chars" });
    return;
  }

  try {
    const adminId = process.env.SEED_ADMIN_ID ?? "seed-admin";

    const [admin] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, adminId))
      .limit(1);

    if (!admin || !admin.email) {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }

    const hashed = await hashPassword(newPassword);

    const updated = await db
      .update(accountsTable)
      .set({ password: hashed, updatedAt: new Date() })
      .where(eq(accountsTable.accountId, admin.email))
      .returning({ id: accountsTable.id });

    if (updated.length === 0) {
      res.status(404).json({ error: "No account found for admin email" });
      return;
    }

    res.json({ ok: true, email: admin.email, message: "Password updated successfully" });
  } catch (err) {
    console.error("reset-admin-password error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
