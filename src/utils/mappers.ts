import { readingTimeMin } from "./readingTime";

function youtubeUrlFromBody(body: string): string | null {
  const match = body.match(/https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})(?:[^\"'\s<]*)?/i);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : null;
}


export interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  coverImageUrl: string | null;
  youtubeUrl: string | null;
  lang: string;
  status: string;
  writerId: string;
  categoryId: string | null;
  locationId: string | null;
  tags: string[];
  moderationNote: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  isBreaking: boolean;
  isFeatured: boolean;
  isPinned: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  bookmarkCount: number;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface JoinedArticle {
  article: ArticleRow;
  category: { id: string; slug: string; nameHi: string; nameEn: string } | null;
  location: { id: string; slug: string; type: string; nameHi: string; nameEn: string } | null;
  writer: { id: string; displayName: string; profileImageUrl: string | null; isVerified: boolean } | null;
}

export function mapArticleCard(row: JoinedArticle) {
  const a = row.article;
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    coverImageUrl: a.coverImageUrl,
    // Older/admin-editor articles stored the embed in body HTML only.
    youtubeUrl: a.youtubeUrl ?? youtubeUrlFromBody(a.body),
    lang: a.lang as "hi" | "en",
    publishedAt: a.publishedAt,
    viewCount: a.viewCount,
    likeCount: a.likeCount,
    commentCount: a.commentCount,
    shareCount: a.shareCount,
    isBreaking: a.isBreaking,
    isFeatured: a.isFeatured,
    readingTimeMin: readingTimeMin(a.body),
    category: row.category ?? undefined,
    location: row.location ?? undefined,
    writer: row.writer
      ? {
          id: row.writer.id,
          displayName: row.writer.displayName,
          profileImageUrl: row.writer.profileImageUrl ?? null,
          verified: row.writer.isVerified,
        }
      : undefined,
  };
}

export function mapArticleDetail(row: JoinedArticle, isLiked = false, isBookmarked = false) {
  const a = row.article;
  return {
    ...mapArticleCard(row),
    body: a.body,
    tags: a.tags ?? [],
    isLiked,
    isBookmarked,
    updatedAt: a.updatedAt,
  };
}

export function mapMyArticle(row: JoinedArticle) {
  const a = row.article;
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    body: a.body,
    coverImageUrl: a.coverImageUrl,
    youtubeUrl: a.youtubeUrl,
    lang: a.lang as "hi" | "en",
    status: a.status as "draft" | "pending" | "scheduled" | "published" | "rejected" | "changes_requested",
    categoryId: a.categoryId,
    locationId: a.locationId,
    category: row.category ?? undefined,
    location: row.location ?? undefined,
    tags: a.tags ?? [],
    moderationNote: a.moderationNote,
    seoTitle: a.seoTitle,
    seoDescription: a.seoDescription,
    ogImageUrl: a.ogImageUrl,
    canonicalUrl: a.canonicalUrl,
    isBreaking: a.isBreaking,
    isFeatured: a.isFeatured,
    isPinned: a.isPinned,
    viewCount: a.viewCount,
    likeCount: a.likeCount,
    commentCount: a.commentCount,
    publishedAt: a.publishedAt,
    scheduledAt: a.scheduledAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}
