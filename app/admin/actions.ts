"use server";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getGalleryItem, loadGallery } from "@/lib/gallery";
import { getManagedAccounts } from "@/lib/admin";
import { audit } from "@/lib/audit";
import type { FormState } from "@/app/actions";

function field(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}
function refresh() {
  revalidatePath("/", "layout");
}

export async function moderateArtwork(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (user?.role !== "admin")
    return { error: "Administrator access required." };
  const ids = [...new Set(form.getAll("artworkId").map(Number))];
  if (
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1)
  )
    return { error: "Select between 1 and 100 artworks." };
  const visibility = field(form, "visibility");
  if (!["hidden", "public"].includes(visibility))
    return { error: "Choose a visibility action." };
  const items = await Promise.all(ids.map(getGalleryItem));
  if (items.some((i) => !i))
    return {
      error: "One of these artworks no longer exists. Refresh and try again.",
    };
  db().exec("BEGIN IMMEDIATE");
  try {
    for (const item of items) {
      if (!item) continue;
      if (item.ownerId && visibility === "public")
        db()
          .prepare("UPDATE uploads SET approved=1 WHERE id=?")
          .run(item.id - 1_000_000_000);
      db()
        .prepare(
          `INSERT INTO artwork_metadata(artwork_id,title,description,category_id,tags,hidden,moderated,updated,updated_by) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(artwork_id) DO UPDATE SET hidden=excluded.hidden,moderated=excluded.moderated,updated=excluded.updated,updated_by=excluded.updated_by`,
        )
        .run(
          item.id,
          item.title,
          item.description,
          item.categoryId,
          item.tags || "",
          visibility === "hidden" ? 1 : 0,
          visibility === "hidden" ? 1 : 0,
          new Date().toISOString(),
          user.id,
        );
      audit(
        user.id,
        visibility === "hidden" ? "Artwork hidden" : "Artwork published",
        String(item.id),
        item.title,
      );
    }
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
  refresh();
  return {
    success: `${ids.length} artwork${ids.length === 1 ? "" : "s"} ${visibility === "hidden" ? "hidden" : "published"}.`,
  };
}

export async function toggleAutoApprove(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (user?.role !== "admin")
    return { error: "Administrator access required." };
  const id = Number(field(form, "userId"));
  const enabled = field(form, "enabled");
  if (
    !Number.isSafeInteger(id) ||
    !db().prepare("SELECT 1 FROM users WHERE id=?").get(id) ||
    !["0", "1"].includes(enabled)
  )
    return { error: "Choose a valid member and approval setting." };
  db()
    .prepare(
      "INSERT INTO account_policy(account_key,auto_approve) VALUES (?,?) ON CONFLICT(account_key) DO UPDATE SET auto_approve=excluded.auto_approve",
    )
    .run(`local:${id}`, Number(enabled));
  audit(
    user.id,
    enabled === "1" ? "Auto approval enabled" : "Auto approval disabled",
    `local:${id}`,
    "Future uploads only; pending uploads still need review",
  );
  refresh();
  return {
    success:
      enabled === "1"
        ? "Future uploads will publish automatically."
        : "Future uploads require approval.",
  };
}

export async function saveAccountAccess(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (user?.role !== "admin")
    return { error: "Administrator access required." };
  const key = field(form, "accountKey"),
    role = field(form, "role"),
    status = field(form, "status");
  const account = getManagedAccounts().find((a) => a.key === key);
  if (
    !account ||
    !["admin", "member"].includes(role) ||
    !["active", "disabled"].includes(status)
  )
    return { error: "Choose a valid account, role, and status." };
  if (account.id === user.id)
    return { error: "You cannot change your own administrative access." };
  db().exec("BEGIN IMMEDIATE");
  try {
    db()
      .prepare(
        "INSERT INTO account_policy(account_key,role,disabled) VALUES (?,?,?) ON CONFLICT(account_key) DO UPDATE SET role=excluded.role,disabled=excluded.disabled",
      )
      .run(key, role, status === "disabled" ? 1 : 0);
    if (account.id && status === "disabled")
      db().prepare("DELETE FROM sessions WHERE user_id=?").run(account.id);
    audit(
      user.id,
      "Account access updated",
      key,
      `${account.username} · ${role} · ${status}`,
    );
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
  refresh();
  return { success: "Account access updated." };
}

export async function saveCategory(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (user?.role !== "admin")
    return { error: "Administrator access required." };
  const { items, categories } = await loadGallery();
  const supplied = field(form, "id");
  const existing = supplied
    ? categories.find((c) => c.id === Number(supplied))
    : undefined;
  if (supplied && !existing) return { error: "Category not found." };
  const deleted = field(form, "operation") === "delete";
  if (deleted && (!existing || items.some((i) => i.categoryId === existing.id)))
    return {
      error:
        "Move all artworks out of this category before deleting it, including hidden artwork.",
    };
  const name = deleted ? existing!.name : field(form, "name"),
    description = field(form, "description"),
    order = Number(field(form, "order") || "0");
  if (
    !name ||
    name.length > 80 ||
    description.length > 500 ||
    !Number.isInteger(order) ||
    Math.abs(order) > 10000
  )
    return {
      error:
        "Use a name up to 80 characters, description up to 500 characters, and a sort order between -10000 and 10000.",
    };
  if (
    !deleted &&
    categories.some(
      (c) =>
        c.id !== existing?.id && c.name.toLowerCase() === name.toLowerCase(),
    )
  )
    return { error: "A category with that name already exists." };
  const max = db()
    .prepare("SELECT COALESCE(MAX(id),0) AS id FROM category_overrides")
    .get() as { id: number };
  const id =
    existing?.id ?? Math.max(max.id, ...categories.map((c) => c.id), 0) + 1;
  db()
    .prepare(
      "INSERT INTO category_overrides(id,name,description,sort_order,deleted) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,deleted=excluded.deleted",
    )
    .run(id, name, description, order, deleted ? 1 : 0);
  audit(
    user.id,
    deleted
      ? "Category deleted"
      : existing
        ? "Category updated"
        : "Category created",
    String(id),
    name,
  );
  refresh();
  return { success: deleted ? "Category deleted." : "Category saved." };
}

export async function saveSettings(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (user?.role !== "admin")
    return { error: "Administrator access required." };
  const siteName = field(form, "siteName"),
    description = field(form, "description");
  if (!siteName || siteName.length > 60 || description.length > 400)
    return {
      error:
        "Use a site name up to 60 characters and description up to 400 characters.",
    };
  const uploadStorageLimitMiB = Number(field(form, "uploadStorageLimitMiB"));
  const memberStorageLimitMiB = Number(field(form, "memberStorageLimitMiB"));
  if (
    ![uploadStorageLimitMiB, memberStorageLimitMiB].every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 1048576,
    )
  )
    return { error: "Choose storage limits between 1 and 1,048,576 MiB." };
  const entries = {
    siteName,
    description,
    registrationOpen: form.has("registrationOpen") ? "true" : "false",
    uploadsOpen: form.has("uploadsOpen") ? "true" : "false",
    uploadStorageLimitMiB: String(uploadStorageLimitMiB),
    memberStorageLimitMiB: String(memberStorageLimitMiB),
  };
  db().exec("BEGIN IMMEDIATE");
  try {
    for (const [key, value] of Object.entries(entries))
      db()
        .prepare(
          "INSERT INTO site_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, value);
    audit(
      user.id,
      "Gallery settings updated",
      "settings",
      "Site identity and publishing controls",
    );
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
  refresh();
  return { success: "Gallery settings saved." };
}

export async function moderateComment(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (user?.role !== "admin")
    return { error: "Administrator access required." };
  const id = Number(field(form, "id"));
  if (!Number.isSafeInteger(id) || id === 0)
    return { error: "Invalid comment." };
  const row =
    id < 0
      ? (db()
          .prepare(
            "UPDATE legacy_comments SET deleted=1 WHERE legacy_id=? AND deleted=0 RETURNING artwork_id",
          )
          .get(-id) as { artwork_id: number } | undefined)
      : (db()
          .prepare("DELETE FROM comments WHERE id=? RETURNING artwork_id")
          .get(id) as { artwork_id: number } | undefined);
  if (!row) return { error: "Comment not found." };
  db().prepare("DELETE FROM comment_moderation WHERE comment_id=?").run(id);
  audit(user.id, "Comment deleted", String(row.artwork_id), `Comment #${id}`);
  refresh();
  return { success: "Comment deleted." };
}

export async function publishComment(form: FormData): Promise<void> {
  const user = await getUser();
  if (user?.role !== "admin") return;
  const id = Number(field(form, "id"));
  if (!Number.isSafeInteger(id) || id === 0) return;
  const row = db()
    .prepare("SELECT artwork_id FROM comment_feed WHERE id=?")
    .get(id) as { artwork_id: number } | undefined;
  if (!row) return;
  const result = db()
    .prepare("DELETE FROM comment_moderation WHERE comment_id=?")
    .run(id);
  if (result.changes)
    audit(
      user.id,
      "Comment approved",
      String(row.artwork_id),
      `Comment #${id}`,
    );
  refresh();
}

export async function saveAdsSettings(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (user?.role !== "admin")
    return { error: "Administrator access required." };
  const publisher = field(form, "publisher"),
    slot = field(form, "slot");
  if (!/^ca-pub-\d{16}$/.test(publisher) || !/^\d{10}$/.test(slot))
    return {
      error:
        "Use a publisher ID like ca-pub-0000000000000000 and a 10-digit ad slot ID.",
    };
  const enabled = form.has("enabled");
  db().exec("BEGIN IMMEDIATE");
  try {
    for (const [key, value] of Object.entries({
      adsenseEnabled: String(enabled),
      adsensePublisher: publisher,
      adsenseSlot: slot,
    }))
      db()
        .prepare(
          "INSERT INTO site_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, value);
    audit(
      user.id,
      "AdSense settings updated",
      "adsense",
      enabled ? "Advertising enabled" : "Advertising disabled",
    );
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
  refresh();
  revalidatePath("/ads.txt");
  return {
    success: "AdSense settings saved. Changes take effect immediately.",
  };
}
