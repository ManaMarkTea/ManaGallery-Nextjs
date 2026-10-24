import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getUser } from "@/lib/auth";
import { getGalleryItem } from "@/lib/gallery";
import { canViewArtwork } from "@/lib/permissions";
import { browserViewKey, recordUniqueView } from "@/lib/views";
import { rateLimit } from "@/lib/db";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
  if (request.headers.get("origin") !== origin)
    return json({ error: "Origin not allowed." }, 403);
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) return json({ error: "Not found." }, 404);
  const item = await getGalleryItem(Number(id)),
    user = await getUser();
  if (!item || !canViewArtwork(user, item))
    return json({ error: "Not found." }, 404);
  if (
    /bot|crawler|spider|preview/i.test(
      request.headers.get("user-agent") || "",
    ) ||
    /prefetch/i.test(
      request.headers.get("purpose") ||
        request.headers.get("sec-purpose") ||
        "",
    ) ||
    request.headers.has("next-router-prefetch")
  )
    return json({ views: item.views });
  const jar = await cookies();
  let token = jar.get("rendergallery_viewer")?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = randomBytes(32).toString("hex");
    jar.set("rendergallery_viewer", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      secure:
        origin.startsWith("https:") ||
        process.env.SESSION_COOKIE_SECURE === "true",
    });
  }
  const key = browserViewKey(token);
  if (!rateLimit(`view:${user?.id ?? key}`, 120, 60))
    return json({ error: "Too many requests." }, 429);
  return json({ views: recordUniqueView(item.id, key, user?.id) });
}
