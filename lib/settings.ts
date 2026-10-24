import "server-only";
import { db } from "./db";
import { storageLimit } from "./storage-policy";
export function getSiteSettings() {
  const values = Object.fromEntries(
    (
      db().prepare("SELECT key,value FROM site_settings").all() as {
        key: string;
        value: string;
      }[]
    ).map((r) => [r.key, r.value]),
  );
  return {
    siteName: values.siteName || "RenderGallery",
    description:
      values.description ||
      "A community gallery of Bryce, Blender and other rendering tools, landscapes, and 3D art.",
    registrationOpen: values.registrationOpen !== "false",
    uploadsOpen: values.uploadsOpen !== "false",
    uploadStorageLimitMiB: storageLimit(values.uploadStorageLimitMiB, 2048),
    memberStorageLimitMiB: storageLimit(values.memberStorageLimitMiB, 1024),
  };
}
