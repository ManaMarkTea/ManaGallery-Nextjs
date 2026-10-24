import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./db";

export type MaterialDownload = { name: string; bytes: number; sha256: string };

export async function getModelPreviewDownload(
  id: number,
  original: MaterialDownload,
): Promise<MaterialDownload | null> {
  let text: string;
  try {
    text = await readFile(
      path.join(dataDirectory, "models/previews.json"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const catalogue = JSON.parse(text);
  if (
    catalogue.version !== 1 ||
    catalogue.geometryOnly !== true ||
    !catalogue.entries ||
    typeof catalogue.entries !== "object"
  )
    return null;
  const preview = catalogue.entries[String(id)];
  // Never serve a derivative from a different source revision or unchecked bytes.
  if (
    !preview ||
    preview.sourceSha256 !== original.sha256 ||
    !Number.isSafeInteger(preview.bytes) ||
    preview.bytes < 12 ||
    preview.bytes > 64 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(preview.sha256)
  )
    return null;
  return {
    name: original.name.replace(/\.3ds$/i, ".glb"),
    bytes: preview.bytes,
    sha256: preview.sha256,
  };
}
export async function getMaterialCatalogue(
  folder: "materials" | "models" = "materials",
): Promise<Record<string, MaterialDownload | null>> {
  let content: string;
  try {
    content = await readFile(
      path.join(dataDirectory, folder, "catalogue.json"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const catalogue = JSON.parse(content);
  if (
    catalogue.version !== 1 ||
    !catalogue.entries ||
    typeof catalogue.entries !== "object"
  )
    throw new Error("Invalid material catalogue.");
  return catalogue.entries;
}
