import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { dataDirectory } from "@/lib/db";
import { getGalleryItem } from "@/lib/gallery";
import { getUser } from "@/lib/auth";
import { canViewArtwork } from "@/lib/permissions";
import { getModelPreviewDownload } from "@/lib/materials";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format");
  if (format !== null && format !== "glb") return new Response("Not found", { status: 404 });
  if (!/^[1-9]\d{0,8}$/.test(id))
    return new Response("Not found", { status: 404 });
  const item = await getGalleryItem(Number(id));
  const user = await getUser();
  let download = item?.modelDownload || item?.materialDownload;
  if (!item || !download || !canViewArtwork(user, item))
    return new Response("Not found", { status: 404 });
  // Bryce's original material category restricted downloads to registered members.
  if (!user)
    return Response.redirect(
      new URL(`/login?next=/art/${id}`, request.url),
      303,
    );
  let bytes: Buffer;
  const model = !!item.modelDownload;
  if (format === "glb") {
    if (!item.modelDownload) return new Response("Not found", { status: 404 });
    download = await getModelPreviewDownload(Number(id), item.modelDownload);
    if (!download) return new Response("This preview is currently unavailable.", { status: 404 });
  }
  const extension = format === "glb" ? ".glb" : model ? ".3ds" : ".mat";
  try {
    bytes = await readFile(path.join(dataDirectory, model ? "models" : "materials", `${id}${extension}`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new Response("This download is currently unavailable.", {
        status: 404,
      });
    throw error;
  }
  if (bytes.length !== download.bytes || createHash("sha256").update(bytes).digest("hex") !== download.sha256)
    return new Response("This download is currently unavailable.", {
      status: 503,
    });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": format === "glb" ? "model/gltf-binary" : "application/octet-stream",
      "Content-Disposition": `attachment; filename="${model ? "model" : "material"}-${id}${extension}"; filename*=UTF-8''${encodeURIComponent(download.name).replaceAll("'", "%27")}`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
