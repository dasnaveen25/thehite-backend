import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin as adminPlugin, bearer, createAccessControl } from "better-auth/plugins";
import { db } from "@workspace/db";
import * as schema from "@workspace/db/schema";

const ac = createAccessControl({
  user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "set-email", "get", "update"],
  session: ["list", "revoke", "delete"],
});

const readerRole = ac.newRole({ user: [], session: [] });
const moderatorRole = ac.newRole({ user: ["list", "get"], session: ["list"] });
const districtAdminRole = ac.newRole({ user: ["list", "get", "ban"], session: ["list", "revoke"] });
const stateAdminRole = ac.newRole({ user: ["list", "get", "ban", "set-role"], session: ["list", "revoke", "delete"] });
const superAdminRole = ac.newRole({
  user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "set-email", "get", "update"],
  session: ["list", "revoke", "delete"],
});

const IS_PROD = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.usersTable,        // table: "users"
      session: schema.sessionsTable,  // table: "ba_sessions"
      account: schema.accountsTable,  // table: "ba_accounts"
      verification: schema.verificationsTable, // table: "ba_verifications"
    },
  }),

  baseURL: process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5003}`,
  basePath: "/api/auth",

  trustedOrigins: process.env.TRUSTED_ORIGINS
    ? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
    : [
        "http://localhost:3004",
        "http://localhost:3005",
        "http://localhost:3006",
        "http://localhost:5173",
        "http://localhost:5174",
        "https://admin.thehit.in",
        "https://demo.thehit.in",
        "https://thehit.in",
        "https://www.thehit.in",
      ],

  secret: process.env.BETTER_AUTH_SECRET!,

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 min cache
    },
    expiresIn: 7 * 24 * 60 * 60, // 7 days
    updateAge: 24 * 60 * 60, // refresh if 1 day old
  },

  advanced: {
    useSecureCookies: IS_PROD,
    crossSubDomainCookies: {
      enabled: IS_PROD,
      domain: IS_PROD ? ".thehit.in" : undefined,
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },

  plugins: [
    bearer(),
    adminPlugin({
      defaultRole: "reader",
      adminRoles: ["super_admin", "state_admin", "district_admin", "moderator"],
      roles: {
        reader: readerRole,
        moderator: moderatorRole,
        district_admin: districtAdminRole,
        state_admin: stateAdminRole,
        super_admin: superAdminRole,
      },
    }),
  ],

  user: {
    additionalFields: {
      firstName: { type: "string", required: false },
      lastName: { type: "string", required: false },
      profileImageUrl: { type: "string", required: false },
    },
  },
});

export type Auth = typeof auth;
