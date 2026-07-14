import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const userProfilesTable = pgTable("user_profiles", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  bio: text("bio"),
  role: varchar("role", { length: 32 }).notNull().default("reader"),
  isWriterApproved: boolean("is_writer_approved").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  languagePref: varchar("language_pref", { length: 4 }).notNull().default("hi"),
  notifPushEnabled: boolean("notif_push_enabled").notNull().default(false),
  notifBreakingScope: varchar("notif_breaking_scope", { length: 16 }).notNull().default("all"),
  notifFollowedWriters: boolean("notif_followed_writers").notNull().default(false),
  followerCount: integer("follower_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const categoriesTable = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  nameHi: varchar("name_hi", { length: 120 }).notNull(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const locationsTable = pgTable(
  "locations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    type: varchar("type", { length: 16 }).notNull(),
    nameHi: varchar("name_hi", { length: 160 }).notNull(),
    nameEn: varchar("name_en", { length: 160 }).notNull(),
    parentId: varchar("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_locations_parent").on(t.parentId), index("idx_locations_type").on(t.type)],
);

export const locationResourcesTable = pgTable(
  "location_resources",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: varchar("location_id")
      .notNull()
      .references(() => locationsTable.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 32 }).notNull(),
    nameHi: varchar("name_hi", { length: 200 }).notNull(),
    nameEn: varchar("name_en", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    address: text("address"),
    mapsQuery: text("maps_query"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_location_resources_location").on(t.locationId)],
);

export const articlesTable = pgTable(
  "articles",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: varchar("slug", { length: 220 }).notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    body: text("body").notNull(),
    coverImageUrl: text("cover_image_url"),
    youtubeUrl: text("youtube_url"),
    lang: varchar("lang", { length: 4 }).notNull().default("hi"),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    writerId: varchar("writer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    categoryId: varchar("category_id").references(() => categoriesTable.id, { onDelete: "set null" }),
    locationId: varchar("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    moderationNote: text("moderation_note"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    ogImageUrl: text("og_image_url"),
    canonicalUrl: text("canonical_url"),
    isBreaking: boolean("is_breaking").notNull().default(false),
    isFeatured: boolean("is_featured").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
    viewCount: integer("view_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    shareCount: integer("share_count").notNull().default(0),
    bookmarkCount: integer("bookmark_count").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_articles_status_published").on(t.status, t.publishedAt),
    index("idx_articles_category").on(t.categoryId),
    index("idx_articles_location").on(t.locationId),
    index("idx_articles_writer").on(t.writerId),
    index("idx_articles_scheduled").on(t.status, t.scheduledAt),
  ],
);

export const articleDraftsTable = pgTable(
  "article_drafts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    writerId: varchar("writer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    summary: text("summary").notNull().default(""),
    body: text("body").notNull().default(""),
    lang: varchar("lang", { length: 4 }).notNull().default("hi"),
    coverImageUrl: text("cover_image_url"),
    youtubeUrl: text("youtube_url"),
    categoryId: varchar("category_id"),
    locationId: varchar("location_id"),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    isBreaking: boolean("is_breaking").notNull().default(false),
    isFeatured: boolean("is_featured").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    ogImageUrl: text("og_image_url"),
    canonicalUrl: text("canonical_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("idx_article_drafts_writer").on(t.writerId, t.updatedAt)],
);

export const articleRevisionsTable = pgTable(
  "article_revisions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    articleId: varchar("article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    editedBy: varchar("edited_by").references(() => usersTable.id, { onDelete: "set null" }),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_article_revisions_article").on(t.articleId, t.createdAt)],
);

export const articleLikesTable = pgTable(
  "article_likes",
  {
    articleId: varchar("article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.userId] })],
);

export const articleBookmarksTable = pgTable(
  "article_bookmarks",
  {
    articleId: varchar("article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.userId] })],
);

export const articleSharesTable = pgTable("article_shares", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  articleId: varchar("article_id")
    .notNull()
    .references(() => articlesTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  platform: varchar("platform", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const articleViewsTable = pgTable(
  "article_views",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    articleId: varchar("article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_views_article_created").on(t.articleId, t.createdAt)],
);

export const commentsTable = pgTable(
  "comments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    articleId: varchar("article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .references(() => usersTable.id, { onDelete: "set null" }),
    guestName: varchar("guest_name", { length: 80 }),
    parentId: varchar("parent_id"),
    body: text("body").notNull(),
    isHidden: boolean("is_hidden").notNull().default(false),
    reportedCount: integer("reported_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_comments_article").on(t.articleId)],
);

export const followsWritersTable = pgTable(
  "follows_writers",
  {
    followerId: varchar("follower_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    writerId: varchar("writer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.writerId] })],
);

export const followsCategoriesTable = pgTable(
  "follows_categories",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    categoryId: varchar("category_id")
      .notNull()
      .references(() => categoriesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.categoryId] })],
);

export const followsLocationsTable = pgTable(
  "follows_locations",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    locationId: varchar("location_id")
      .notNull()
      .references(() => locationsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId] })],
);

export const pushPrefsCategoriesTable = pgTable(
  "push_prefs_categories",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    categoryId: varchar("category_id")
      .notNull()
      .references(() => categoriesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.categoryId] })],
);

export const pushPrefsLocationsTable = pgTable(
  "push_prefs_locations",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    locationId: varchar("location_id")
      .notNull()
      .references(() => locationsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId] })],
);

export const reportsTable = pgTable("reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  targetType: varchar("target_type", { length: 16 }).notNull(),
  targetId: varchar("target_id").notNull(),
  reporterId: varchar("reporter_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedBy: varchar("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const writerApplicationsTable = pgTable("writer_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  fullName: varchar("full_name", { length: 160 }).notNull(),
  firstName: varchar("first_name", { length: 80 }),
  age: integer("age"),
  phone: varchar("phone", { length: 30 }),
  contactEmail: varchar("contact_email", { length: 200 }),
  education: text("education"),
  previousWork: text("previous_work"),
  profession: text("profession"),
  bio: text("bio").notNull(),
  sampleLink: text("sample_link"),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  moderationNote: text("moderation_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamInvitationsTable = pgTable("team_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 200 }).notNull().unique(),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  role: varchar("role", { length: 32 }).notNull().default("writer"),
  notes: text("notes"),
  invitedBy: varchar("invited_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmOrganizationsTable = pgTable(
  "crm_organizations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 200 }).notNull(),
    type: varchar("type", { length: 32 }).notNull().default("other"),
    website: text("website"),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 200 }),
    locationId: varchar("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    address: text("address"),
    notes: text("notes"),
    createdBy: varchar("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("idx_crm_org_name").on(t.name), index("idx_crm_org_type").on(t.type)],
);

export const crmContactsTable = pgTable(
  "crm_contacts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    type: varchar("type", { length: 32 }).notNull().default("supporter"),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 200 }),
    whatsapp: varchar("whatsapp", { length: 32 }),
    organizationId: varchar("organization_id").references(() => crmOrganizationsTable.id, {
      onDelete: "set null",
    }),
    roleTitle: varchar("role_title", { length: 120 }),
    locationId: varchar("location_id").references(() => locationsTable.id, { onDelete: "set null" }),
    address: text("address"),
    source: varchar("source", { length: 64 }),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    notes: text("notes"),
    isArchived: boolean("is_archived").notNull().default(false),
    assignedTo: varchar("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
    linkedUserId: varchar("linked_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdBy: varchar("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_crm_contact_name").on(t.fullName),
    index("idx_crm_contact_type").on(t.type),
    index("idx_crm_contact_org").on(t.organizationId),
    index("idx_crm_contact_assigned").on(t.assignedTo),
  ],
);

export const crmActivitiesTable = pgTable(
  "crm_activities",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    contactId: varchar("contact_id").references(() => crmContactsTable.id, { onDelete: "cascade" }),
    organizationId: varchar("organization_id").references(() => crmOrganizationsTable.id, {
      onDelete: "cascade",
    }),
    type: varchar("type", { length: 16 }).notNull(),
    subject: varchar("subject", { length: 240 }).notNull(),
    body: text("body"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_crm_act_contact").on(t.contactId),
    index("idx_crm_act_org").on(t.organizationId),
    index("idx_crm_act_occurred").on(t.occurredAt),
  ],
);

export const crmTasksTable = pgTable(
  "crm_tasks",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    priority: varchar("priority", { length: 8 }).notNull().default("normal"),
    contactId: varchar("contact_id").references(() => crmContactsTable.id, { onDelete: "set null" }),
    organizationId: varchar("organization_id").references(() => crmOrganizationsTable.id, {
      onDelete: "set null",
    }),
    assignedTo: varchar("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
    createdBy: varchar("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_crm_task_assigned").on(t.assignedTo),
    index("idx_crm_task_status").on(t.status),
    index("idx_crm_task_due").on(t.dueAt),
  ],
);

export const deviceTokensTable = pgTable(
  "device_tokens",
  {
    token: varchar("token", { length: 256 }).primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 16 }).notNull().default("expo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("idx_device_tokens_user").on(t.userId)],
);

export const breakingPushDeliveriesTable = pgTable(
  "breaking_push_deliveries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    articleId: varchar("article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    slug: varchar("slug", { length: 220 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_breaking_push_user_sent").on(t.userId, t.sentAt),
    uniqueIndex("uniq_breaking_push_user_article").on(t.userId, t.articleId),
  ],
);

export const auditLogTable = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorId: varchar("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: varchar("action", { length: 64 }).notNull(),
  targetType: varchar("target_type", { length: 32 }),
  targetId: varchar("target_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const articlesRelations = relations(articlesTable, ({ one }) => ({
  writer: one(usersTable, { fields: [articlesTable.writerId], references: [usersTable.id] }),
  category: one(categoriesTable, { fields: [articlesTable.categoryId], references: [categoriesTable.id] }),
  location: one(locationsTable, { fields: [articlesTable.locationId], references: [locationsTable.id] }),
}));

export const validationReportSharesTable = pgTable("validation_report_shares", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: varchar("token", { length: 64 }).notNull().unique(),
  csvContent: text("csv_content").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdByUserId: varchar("created_by_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Article = typeof articlesTable.$inferSelect;
export type InsertArticle = typeof articlesTable.$inferInsert;
export type Category = typeof categoriesTable.$inferSelect;
export type Location = typeof locationsTable.$inferSelect;
export type UserProfile = typeof userProfilesTable.$inferSelect;
export type Comment = typeof commentsTable.$inferSelect;
export type WriterApplication = typeof writerApplicationsTable.$inferSelect;
export type CrmContact = typeof crmContactsTable.$inferSelect;
export type CrmOrganization = typeof crmOrganizationsTable.$inferSelect;
export type CrmActivity = typeof crmActivitiesTable.$inferSelect;
export type CrmTask = typeof crmTasksTable.$inferSelect;

export const donationSettingsTable = pgTable("donation_settings", {
  key: varchar("key", { length: 32 }).primaryKey(),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const donationsTable = pgTable("donations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  donorName: varchar("donor_name", { length: 255 }),
  donorEmail: varchar("donor_email", { length: 255 }),
  donorPhone: varchar("donor_phone", { length: 20 }),
  amount: integer("amount").notNull(),
  method: varchar("method", { length: 32 }).notNull().default("upi"),
  receivedUpiId: varchar("received_upi_id", { length: 255 }),
  transactionId: varchar("transaction_id", { length: 255 }),
  campaignId: varchar("campaign_id", { length: 64 }),
  note: text("note"),
  status: varchar("status", { length: 32 }).notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Donation = typeof donationsTable.$inferSelect;
