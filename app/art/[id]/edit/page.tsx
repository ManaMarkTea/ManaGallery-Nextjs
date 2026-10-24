import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getGalleryItem, loadGallery } from "@/lib/gallery";
import { EditArtworkForm } from "@/components/forms";
import { canEditArtwork } from "@/lib/permissions";
import Link from "next/link";
export default async function Edit({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");
  const item = await getGalleryItem(Number((await params).id));
  if (!item || !canEditArtwork(user, item)) notFound();
  const { categories } = await loadGallery();
  return (
    <main className="form-page panel">
      <h1>Edit artwork</h1>
      <p>
        Update the title, description, category, tags, and gallery visibility.
      </p>
      <Link href={`/art/${item.id}`}>← Back to artwork</Link>
      <EditArtworkForm
        item={item}
        categories={categories}
        moderationLocked={!!item.moderated && user.role !== "admin"}
      />
    </main>
  );
}
