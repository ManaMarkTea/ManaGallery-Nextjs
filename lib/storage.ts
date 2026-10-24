import "server-only";
import { lstatSync, readdirSync, statfsSync } from "node:fs";
import path from "node:path";
import { dataDirectory, db } from "./db";

export function uploadStorageUsage(userId?: number) {
  const directory = path.join(dataDirectory, "uploads");
  const owned = new Set(
    userId === undefined
      ? []
      : (
          db()
            .prepare("SELECT filename FROM uploads WHERE user_id=?")
            .all(userId) as { filename: string }[]
        ).map((row) => row.filename),
  );
  let total = 0,
    member = 0;
  const scan = (folder: string, previews = false) => {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const name of names) {
      const item = path.join(folder, name);
      const info = lstatSync(item);
      if (info.isSymbolicLink())
        throw new Error("Unexpected link in upload storage");
      if (info.isDirectory() && name === "previews" && !previews)
        scan(item, true);
      else if (info.isFile()) {
        total += info.size;
        if (owned.has(name)) member += info.size;
      } else throw new Error("Unexpected entry in upload storage");
    }
  };
  scan(directory);
  const disk = statfsSync(dataDirectory);
  return {
    total,
    member,
    available: disk.bavail * disk.bsize,
    capacity: disk.blocks * disk.bsize,
  };
}
