"use server";

import { headers } from "next/headers";
import { commentReviewReason } from "@/lib/comment-filter";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, dataDirectory, rateLimit } from "@/lib/db";
import {
  createSession,
  destroySession,
  getUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { getGalleryItem, getGalleryPage } from "@/lib/gallery";
import { migrateLegacyLogin } from "@/lib/legacy";
import { accountEnabled, getAccount } from "@/lib/accounts";
import { canEditArtwork, canViewArtwork } from "@/lib/permissions";
import { getSiteSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { validNewUsername, USERNAME_HELP } from "@/lib/usernames";
import { requestClientKey } from "@/lib/request-client";
import { validSoftware } from "@/lib/software";
import { uploadStorageUsage } from "@/lib/storage";
import { uploadStorageError } from "@/lib/storage-policy";

export type FormState = { error?: string; success?: string };
function field(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
function destination(form: FormData) {
  const next = field(form, "next");
  return /^\/(?!\/)/.test(next) && !next.includes("\\") ? next : "/account";
}
async function attempt(prefix: string, limit: number) {
  const ip = requestClientKey(await headers());
  return rateLimit(`${prefix}:${ip}`, limit, 15 * 60);
}
export async function register(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  if (!getSiteSettings().registrationOpen)
    return { error: "New account registration is currently paused." };
  if (!(await attempt("register", 10)))
    return {
      error: "Too many registration attempts. Please try again in 15 minutes.",
    };
  const username = field(form, "username");
  if (
    db().prepare("SELECT 1 FROM legacy_accounts WHERE username=?").get(username)
  )
    return {
      error:
        "This username belongs to a Bryce account. Sign in with your existing Bryce password.",
    };
  const password = form.get("password");
  if (!validNewUsername(username))
    return {
      error: USERNAME_HELP,
    };
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    return { error: "Choose a password between 12 and 128 characters." };
  const hash = await hashPassword(password);
  let id: number;
  try {
    id = Number(
      db()
        .prepare("INSERT INTO users(username,password) VALUES (?,?)")
        .run(username, hash).lastInsertRowid,
    );
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      return { error: "That username is already taken." };
    throw error;
  }
  await createSession(id, "registration");
  redirect(destination(form));
}
export async function login(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  if (!(await attempt("login", 30)))
    return {
      error: "Too many sign-in attempts. Please try again in 15 minutes.",
    };
  const password = form.get("password");
  if (typeof password !== "string" || password.length > 128)
    return { error: "Invalid username or password." };
  const username = field(form, "username");
  const user = db()
    .prepare("SELECT id,password FROM users WHERE username=?")
    .get(username) as { id: number; password: string } | undefined;
  // Do the same expensive hash work for unknown accounts.
  const valid = await verifyPassword(
    password,
    user?.password || `${"0".repeat(32)}:${"0".repeat(128)}`,
  );
  let userId = user && valid ? user.id : undefined;
  if (!userId) {
    // A linked Bryce name can also be used as an alias for its local account.
    const linked =
      !user &&
      (db()
        .prepare(
          "SELECT u.id,u.password FROM legacy_accounts l JOIN users u ON u.id=l.user_id WHERE l.username=?",
        )
        .get(username) as { id: number; password: string } | undefined);
    if (linked && (await verifyPassword(password, linked.password)))
      userId = linked.id;
    else {
      const migrated = await migrateLegacyLogin(username, password);
      if (migrated.error) return { error: migrated.error };
      userId = migrated.id;
    }
  }
  if (!userId || !accountEnabled(userId))
    return { error: "Invalid username or password." };
  await createSession(userId, "password");
  redirect(destination(form));
}
export async function logout() {
  await destroySession();
  redirect("/");
}

export async function linkLegacyAccount(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { error: "Please sign in." };
  if (!rateLimit(`legacy-link:${user.id}`, 10, 900))
    return { error: "Too many attempts. Try again in 15 minutes." };
  const password = form.get("legacyPassword");
  if (typeof password !== "string" || password.length > 128)
    return {
      error:
        "Invalid Bryce username or password, or this account is already linked or inactive.",
    };
  const result = await migrateLegacyLogin(
    field(form, "legacyUsername"),
    password,
    user.id,
  );
  if (!result.id)
    return {
      error:
        result.error ||
        "Invalid Bryce username or password, or this account is already linked or inactive.",
    };
  revalidatePath("/account");
  return {
    success:
      "Bryce account linked. Keep using your local password or passkey to sign in.",
  };
}

export async function changePassword(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { error: "Please sign in." };
  if (!rateLimit(`password:${user.id}`, 10, 900))
    return { error: "Too many attempts. Try again in 15 minutes." };
  const current = form.get("currentPassword"),
    password = form.get("password");
  if (
    typeof current !== "string" ||
    current.length > 128 ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    return {
      error:
        "Enter your current password and a new password of 12–128 characters.",
    };
  const row = db()
    .prepare("SELECT password FROM users WHERE id=?")
    .get(user.id) as { password: string };
  if (!(await verifyPassword(current, row.password)))
    return { error: "Your current password is incorrect." };
  const hashed = await hashPassword(password);
  db().exec("BEGIN IMMEDIATE");
  try {
    db().prepare("UPDATE users SET password=? WHERE id=?").run(hashed, user.id);
    db().prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
  await createSession(user.id);
  return { success: "Password changed. Other sessions have been signed out." };
}

export async function updateArtwork(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { error: "Please sign in." };
  const id = Number(field(form, "artworkId")),
    title = field(form, "title"),
    description = field(form, "description"),
    categoryId = Number(field(form, "category"));
  if (!title || title.length > 120 || description.length > 5000)
    return {
      error:
        "Use a title up to 120 characters and a description up to 5,000 characters.",
    };
  const { categories } = await getGalleryPage({
    query: "",
    category: "",
    sort: "recent",
    page: 1,
  });
  if (!categories.some((c) => c.id === categoryId))
    return { error: "Choose a valid category." };
  const item = await getGalleryItem(id);
  if (!item || !canEditArtwork(user, item))
    return { error: "Artwork not found or it belongs to another artist." };
  const software = form.has("software")
    ? field(form, "software")
    : item.software || "bryce";
  if (!validSoftware(software))
    return { error: "Choose a valid software application." };
  if (item.materialEntry && software !== "bryce")
    return {
      error: "Archived Bryce material presets must remain classified as Bryce.",
    };
  const tags = field(form, "tags");
  if (tags.length > 300) return { error: "Keep tags under 300 characters." };
  const locked = (item.moderated || item.pending) && user.role !== "admin";
  const hidden = locked || field(form, "visibility") === "hidden" ? 1 : 0;
  const moderated = user.role === "admin" ? hidden : locked ? 1 : 0;
  db()
    .prepare(
      `INSERT INTO artwork_metadata(artwork_id,title,description,category_id,tags,hidden,moderated,updated,updated_by) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(artwork_id) DO UPDATE SET title=excluded.title,description=excluded.description,category_id=excluded.category_id,tags=excluded.tags,hidden=excluded.hidden,moderated=excluded.moderated,updated=excluded.updated,updated_by=excluded.updated_by`,
    )
    .run(
      id,
      title,
      description,
      categoryId,
      tags,
      hidden,
      moderated,
      new Date().toISOString(),
      user.id,
    );
  audit(user.id, "Artwork updated", String(id), title);
  db()
    .prepare(
      "INSERT INTO artwork_software(artwork_id,software) VALUES (?,?) ON CONFLICT(artwork_id) DO UPDATE SET software=excluded.software",
    )
    .run(id, software);
  if (item.ownerId && user.role === "admin" && !hidden)
    db()
      .prepare("UPDATE uploads SET approved=1 WHERE id=?")
      .run(id - 1_000_000_000);
  revalidatePath("/admin", "layout");
  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath(`/art/${id}`);
  redirect(`/art/${id}`);
}

export async function uploadArtwork(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { error: "Please sign in before uploading." };
  const software = field(form, "software") || "bryce";
  if (!validSoftware(software))
    return { error: "Choose a valid software application." };
  if (!getSiteSettings().uploadsOpen && user.role !== "admin")
    return { error: "Artwork uploads are currently paused." };
  if (!rateLimit(`upload:${user.id}`, 30, 3600))
    return { error: "Upload limit reached. Try again in an hour." };
  const title = field(form, "title"),
    description = field(form, "description"),
    categoryId = Number(field(form, "category"));
  if (!title || title.length > 120 || description.length > 5000)
    return {
      error:
        "Add a title up to 120 characters and a description up to 5,000 characters.",
    };
  const { categories } = await getGalleryPage({
    query: "",
    category: "",
    sort: "recent",
    page: 1,
  });
  if (!categories.some((c) => c.id === categoryId))
    return { error: "Choose a valid gallery category." };
  const file = form.get("image");
  if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)
    return { error: "Choose a JPEG, PNG or WebP image under 10 MB." };
  let image: Buffer;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(bytes, {
      limitInputPixels: 40_000_000,
      animated: false,
    }).metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
      return { error: "Only JPEG, PNG and WebP images are supported." };
    image = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({
        width: 5000,
        height: 5000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 92 })
      .toBuffer();
  } catch {
    return {
      error:
        "This image could not be read. Try a different JPEG, PNG or WebP file (up to 40 megapixels).",
    };
  }
  const filename = `${randomUUID()}.webp`;
  const directory = path.join(dataDirectory, "uploads");
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(directory, "previews"), { recursive: true });
  const preview = await sharp(image)
    .resize({
      width: 480,
      height: 360,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
  let id: number;
  const written: string[] = [];
  const storageSettings = getSiteSettings();
  // No awaits inside this transaction: concurrent submissions and backup staging
  // cannot observe a quota check without its matching file/row creation.
  db().exec("BEGIN IMMEDIATE");
  try {
    const problem = uploadStorageError({
      ...uploadStorageUsage(user.id),
      incoming: image.length + preview.length,
      totalLimitMiB: storageSettings.uploadStorageLimitMiB,
      memberLimitMiB: storageSettings.memberStorageLimitMiB,
    });
    if (problem) {
      db().exec("ROLLBACK");
      return { error: problem };
    }
    for (const [target, bytes] of [
      [path.join(directory, filename), image],
      [path.join(directory, "previews", filename), preview],
    ] as const) {
      writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
      written.push(target);
    }
    id =
      Number(
        db()
          .prepare(
            "INSERT INTO uploads(user_id,title,description,category_id,filename,created,approved) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            user.id,
            title,
            description,
            categoryId,
            filename,
            new Date().toISOString(),
            user.role === "admin" || getAccount(user.id)?.autoApprove ? 1 : 0,
          ).lastInsertRowid,
      ) + 1_000_000_000;
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    for (const target of written) {
      try { unlinkSync(target); } catch { /* Leave failed cleanup for storage inspection. */ }
    }
    if ((error as NodeJS.ErrnoException).code === "ENOSPC")
      return { error: "Uploads are temporarily paused because server storage is full. Please contact an administrator." };
    throw error;
  }
  revalidatePath("/");
  revalidatePath("/account");
  audit(user.id, "Artwork uploaded", String(id), title);
  db()
    .prepare("INSERT INTO artwork_software(artwork_id,software) VALUES (?,?)")
    .run(id, software);
  redirect(`/art/${id}`);
}

export async function addComment(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { error: "Sign in to leave a comment." };
  const id = Number(field(form, "artworkId")),
    body = field(form, "body");
  const item = await getGalleryItem(id);
  if (!item || !canViewArtwork(user, item))
    return { error: "Artwork not found." };
  if (!body || body.length > 2000)
    return { error: "Write a comment between 1 and 2,000 characters." };
  if (!rateLimit(`comment:${user.id}`, 20, 3600))
    return { error: "Comment limit reached. Try again in an hour." };
  if (!rateLimit(`comment-minute:${user.id}`, 3, 60)) return { error: "Please wait a minute before posting more comments." };
  if (db().prepare("SELECT 1 FROM comments WHERE user_id=? AND body=? AND created >= datetime('now','-1 day')").get(user.id,body)) return { error: "You already posted this comment." };
  const reason = commentReviewReason(body, user.role === "admin" || !!getAccount(user.id)?.autoApprove);
  db().exec("BEGIN IMMEDIATE");
  try {
    const result = db().prepare("INSERT INTO comments(artwork_id,user_id,body) VALUES (?,?,?)").run(id, user.id, body);
    if (reason) db().prepare("INSERT INTO comment_moderation(comment_id,reason) VALUES(?,?)").run(result.lastInsertRowid,reason);
    db().exec("COMMIT");
  } catch (error) { db().exec("ROLLBACK"); throw error; }
  revalidatePath(`/art/${id}`);
  revalidatePath("/admin/comments");
  return reason ? { success: "Your comment was submitted for admin review." } : { success: "Comment posted." };
}
export async function toggleFavorite(form: FormData) {
  const user = await getUser();
  if (!user) redirect("/login");
  const id = Number(field(form, "artworkId"));
  const item = await getGalleryItem(id);
  if (!item || !canViewArtwork(user, item)) return;
  const result = db()
    .prepare("DELETE FROM favorites WHERE artwork_id=? AND user_id=?")
    .run(id, user.id);
  if (!result.changes)
    db()
      .prepare(
        "INSERT OR IGNORE INTO favorites(artwork_id,user_id) VALUES (?,?)",
      )
      .run(id, user.id);
  revalidatePath(`/art/${id}`);
  revalidatePath("/account");
}
export async function deleteComment(form: FormData) {
  const user = await getUser();
  if (!user) return;
  const commentId = Number(field(form, "commentId"));
  if (!Number.isSafeInteger(commentId) || commentId === 0) return;
  const row = commentId < 0 ? db().prepare("UPDATE legacy_comments SET deleted=1 WHERE legacy_id=? AND deleted=0 AND (?=1 OR EXISTS(SELECT 1 FROM legacy_accounts WHERE legacy_id=legacy_comments.legacy_user_id AND user_id=?)) RETURNING artwork_id").get(-commentId,user.role === "admin" ? 1 : 0,user.id) as { artwork_id: number } | undefined : db()
    .prepare(
      "DELETE FROM comments WHERE id=? AND (user_id=? OR ?=1) RETURNING artwork_id",
    )
    .get(
      commentId,
      user.id,
      user.role === "admin" ? 1 : 0,
    ) as { artwork_id: number } | undefined;
  if (row) {
    db().prepare("DELETE FROM comment_moderation WHERE comment_id=?").run(commentId);
    audit(
      user.id,
      "Comment deleted",
      String(row.artwork_id),
      "Comment removed",
    );
    revalidatePath(`/art/${row.artwork_id}`);
    revalidatePath("/admin/comments");
  }
}
export async function deleteUpload(form: FormData) {
  const user = await getUser();
  if (!user) return;
  const id = Number(field(form, "artworkId"));
  const row = db()
    .prepare("SELECT filename FROM uploads WHERE id=? AND (user_id=? OR ?=1)")
    .get(id - 1_000_000_000, user.id, user.role === "admin" ? 1 : 0) as
    { filename: string } | undefined;
  if (!row) return;
  db().exec("BEGIN IMMEDIATE");
  try {
    db()
      .prepare("DELETE FROM uploads WHERE id=?")
      .run(id - 1_000_000_000);
    db().prepare("DELETE FROM artwork_metadata WHERE artwork_id=?").run(id);
    db().prepare("DELETE FROM artwork_software WHERE artwork_id=?").run(id);
    db().prepare("DELETE FROM comment_moderation WHERE comment_id IN (SELECT id FROM comments WHERE artwork_id=?)").run(id);
    db().prepare("DELETE FROM comments WHERE artwork_id=?").run(id);
    db().prepare("DELETE FROM favorites WHERE artwork_id=?").run(id);
    db().prepare("DELETE FROM artwork_viewers WHERE artwork_id=?").run(id);
    audit(user.id, "Upload deleted", String(id), "Uploaded artwork removed");
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
  await unlink(path.join(dataDirectory, "uploads", row.filename)).catch(
    () => {},
  );
  await unlink(
    path.join(dataDirectory, "uploads", "previews", row.filename),
  ).catch(() => {});
  revalidatePath("/");
  revalidatePath("/account");
  redirect("/account");
}
