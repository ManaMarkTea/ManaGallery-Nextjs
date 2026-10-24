import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getGalleryPage } from "@/lib/gallery";
import { UploadForm } from "@/components/forms";
import { getSiteSettings } from "@/lib/settings";
import { getAccount } from "@/lib/accounts";
import { uploadStorageUsage } from "@/lib/storage";
import { formatBytes, MiB } from "@/lib/storage-policy";
export default async function Upload() {
  const user = await getUser();
  if (!user) redirect("/login?next=/upload");
  if (!getSiteSettings().uploadsOpen && user.role !== "admin")
    return (
      <main className="form-page panel">
        <h1>Uploads are paused</h1>
        <p>Please check back later to share your artwork.</p>
      </main>
    );
  const { categories } = await getGalleryPage({
    query: "",
    category: "",
    sort: "recent",
    page: 1,
  });
  const storage = uploadStorageUsage(user.id);
  const settings = getSiteSettings();
  return (
    <main className="form-page panel">
      <h1>Share your artwork</h1>
      <p>A new landscape, an experiment, a world of your own.</p>
      <p className="upload-storage-note">
        Your uploads use {formatBytes(storage.member)} of{" "}
        {formatBytes(settings.memberStorageLimitMiB * MiB)}. Images and previews
        count toward this limit.
      </p>
      {user.role !== "admin" && !getAccount(user.id)?.autoApprove && (
        <p>
          Your upload will be visible to you while it waits for admin approval.
        </p>
      )}
      <UploadForm
        categories={categories}
        requiresApproval={
          user.role !== "admin" && !getAccount(user.id)?.autoApprove
        }
      />
    </main>
  );
}
