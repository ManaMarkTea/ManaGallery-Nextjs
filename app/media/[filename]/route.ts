import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory, db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  if (!/^[a-f0-9-]{36}\.webp$/.test(filename))
    return new Response("Not found", { status: 404 });
  const upload = db()
    .prepare(
      "SELECT p.user_id,p.approved,m.hidden FROM uploads p LEFT JOIN artwork_metadata m ON m.artwork_id=p.id+1000000000 WHERE p.filename=?",
    )
    .get(filename) as
    { user_id: number; approved: number; hidden: number | null } | undefined;
  if (!upload) return new Response("Not found", { status: 404 });
  if (!upload.approved || upload.hidden) {
    const user = await getUser();
    if (!user || (user.id !== upload.user_id && user.role !== "admin"))
      return new Response("Not found", { status: 404 });
  }
  try {
    const fullPath = path.join(dataDirectory, "uploads", filename);
    const bytes =
      new URL(request.url).searchParams.get("preview") === "1"
        ? await readFile(
            path.join(dataDirectory, "uploads", "previews", filename),
          ).catch(() => readFile(fullPath))
        : await readFile(fullPath);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
