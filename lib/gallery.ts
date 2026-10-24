import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { galleryPageSize } from "./gallery-pagination";
import { getMaterialCatalogue, type MaterialDownload } from "./materials";

export type GalleryItem = {
  id: number;
  title: string;
  description: string;
  category: string;
  categoryId: number;
  author: string;
  date: string | null;
  views: number;
  archivedViews?: number;
  rating: number;
  image: string;
  fullImage: string;
  ownerId?: number;
  archiveOwnerId?: number;
  tags?: string;
  hidden?: boolean;
  moderated?: boolean;
  pending?: boolean;
  materialEntry?: boolean;
  materialDownload?: MaterialDownload | null;
  modelEntry?: boolean;
  modelDownload?: MaterialDownload | null;
  software?: string;
};

export type GalleryCategory = {
  id: number;
  name: string;
  count: number;
  description?: string;
  order?: number;
};

type GalleryData = {
  items: GalleryItem[];
  categories: GalleryCategory[];
};

let cachedData: Promise<GalleryData> | undefined;

async function loadArchive(): Promise<GalleryData> {
  cachedData ??= readFile(
    process.env.RENDERGALLERY_ARCHIVE_FILE ||
      path.join(process.cwd(), "public", "data", "gallery.json"),
    "utf8",
  )
    .then((content) => JSON.parse(content) as GalleryData)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return {
        items: [],
        categories: [
          { id: 1, name: "Landscapes", count: 0 },
          { id: 2, name: "Still lifes", count: 0 },
          { id: 3, name: "Other artwork", count: 0 },
        ],
      };
    });
  return cachedData;
}

export async function loadGallery(): Promise<GalleryData> {
  const archive = await loadArchive();
  const software = new Map(
    (
      db()
        .prepare("SELECT artwork_id,software FROM artwork_software")
        .all() as { artwork_id: number; software: string }[]
    ).map((r) => [r.artwork_id, r.software]),
  );
  const materials = await getMaterialCatalogue();
  const models = await getMaterialCatalogue("models");
  const views = new Map(
    (
      db()
        .prepare(
          "SELECT artwork_id,COUNT(*) AS views FROM artwork_viewers WHERE claimed_by IS NULL GROUP BY artwork_id",
        )
        .all() as { artwork_id: number; views: number }[]
    ).map((r) => [r.artwork_id, r.views]),
  );
  const categoryMap = new Map(
    archive.categories.map((c, index) => [
      c.id,
      { ...c, description: "", order: index },
    ]),
  );
  const changes = db().prepare("SELECT * FROM category_overrides").all() as {
    id: number;
    name: string;
    description: string;
    sort_order: number;
    deleted: number;
  }[];
  for (const c of changes) {
    if (c.deleted) categoryMap.delete(c.id);
    else
      categoryMap.set(c.id, {
        id: c.id,
        name: c.name,
        description: c.description,
        order: c.sort_order,
        count: 0,
      });
  }
  const categories = Array.from(categoryMap.values()).sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name),
  );
  const metadata = new Map(
    (
      db().prepare("SELECT * FROM artwork_metadata").all() as {
        artwork_id: number;
        title: string;
        description: string;
        category_id: number;
        tags: string;
        hidden: number;
        moderated: number;
      }[]
    ).map((r) => [r.artwork_id, r]),
  );
  const ownership = new Map(
    (
      db()
        .prepare(
          "SELECT a.artwork_id,l.user_id FROM legacy_artwork a JOIN legacy_accounts l ON l.legacy_id=a.legacy_user_id LEFT JOIN account_policy p ON p.account_key='local:'||l.user_id LEFT JOIN account_policy lp ON lp.account_key='legacy:'||l.legacy_id WHERE l.user_id IS NOT NULL AND COALESCE(p.disabled,lp.disabled,1-l.enabled)=0",
        )
        .all() as { artwork_id: number; user_id: number }[]
    ).map((r) => [r.artwork_id, r.user_id]),
  );
  const uploads = db()
    .prepare(
      "SELECT p.*,u.username FROM uploads p JOIN users u ON u.id=p.user_id",
    )
    .all() as unknown as {
    id: number;
    user_id: number;
    title: string;
    description: string;
    category_id: number;
    filename: string;
    created: string;
    username: string;
    approved: number;
  }[];
  const additions: GalleryItem[] = uploads.map((p) => ({
    id: p.id + 1_000_000_000,
    title: p.title,
    description: p.description,
    categoryId: p.category_id,
    category:
      categories.find((c) => c.id === p.category_id)?.name || "Community art",
    author: p.username,
    date: p.created,
    views: views.get(p.id + 1_000_000_000) || 0,
    rating: 0,
    image: `/media/${p.filename}?preview=1`,
    fullImage: `/media/${p.filename}`,
    ownerId: p.user_id,
    pending: !p.approved,
  }));
  const items: GalleryItem[] = [
    ...additions,
    ...archive.items.map((item) => ({
      ...item,
      archivedViews: item.ownerId ? undefined : item.views,
      views: views.get(item.id) || 0,
      archiveOwnerId: ownership.get(item.id),
    })),
  ].map((item) => {
    const edit = metadata.get(item.id);
    const categoryId = edit?.category_id ?? item.categoryId;
    return {
      ...item,
      title: edit?.title ?? item.title,
      software: software.get(item.id) || "bryce",
      description: edit?.description ?? item.description,
      categoryId,
      category: categoryMap.get(categoryId)?.name || item.category,
      tags: edit?.tags ?? "",
      hidden: !!item.pending || !!edit?.hidden,
      moderated: !!edit?.moderated,
      materialEntry: Object.hasOwn(materials, String(item.id)),
      materialDownload: materials[String(item.id)] ?? null,
      modelEntry:
        Object.hasOwn(models, String(item.id)) || item.categoryId === 19,
      modelDownload: models[String(item.id)] ?? null,
    };
  });
  return {
    items,
    categories: categories.map((c) => ({
      ...c,
      count: items.filter((p) => !p.hidden && p.categoryId === c.id).length,
    })),
  };
}

export function getComments(id: number) {
  return db()
    .prepare(
      "SELECT id,user_id AS userId,body,created,username,archived FROM comment_feed WHERE artwork_id=? AND moderation_reason IS NULL ORDER BY created DESC,id DESC",
    )
    .all(id) as unknown as {
    id: number;
    userId: number | null;
    archived: number;
    body: string;
    created: string;
    username: string;
  }[];
}

export async function getGalleryPage({
  query,
  category,
  sort,
  page,
  software = "",
  perPage,
}: {
  query: string;
  category: string;
  sort: string;
  page: number;
  software?: string;
  perPage?: string | number;
}) {
  const pageSize = galleryPageSize(perPage);
  const gallery = await loadGallery();
  const normalizedQuery = query.toLocaleLowerCase();
  let items = gallery.items.filter((item) => {
    if (item.hidden) return false;
    if (software && item.software !== software) return false;
    const matchesCategory = !category || String(item.categoryId) === category;
    const matchesQuery =
      !normalizedQuery ||
      `${item.title} ${item.description} ${item.category} ${item.author} ${item.tags || ""}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });

  if (sort === "popular") {
    items = items.toSorted(
      (a, b) => b.views - a.views || (b.date || "").localeCompare(a.date || ""),
    );
  } else if (sort === "rated") {
    items = items.toSorted((a, b) => b.rating - a.rating || b.views - a.views);
  } else {
    items = items.toSorted((a, b) =>
      (b.date ?? "").localeCompare(a.date ?? ""),
    );
  }

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  return {
    items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    categories: gallery.categories.map((c) => ({
      ...c,
      count: gallery.items.filter(
        (i) =>
          !i.hidden &&
          i.categoryId === c.id &&
          (!software || i.software === software),
      ).length,
    })),
    total,
    pageCount,
    page: currentPage,
    pageSize,
  };
}

export async function getGalleryItem(id: number) {
  const gallery = await loadGallery();
  return gallery.items.find((item) => item.id === id);
}
