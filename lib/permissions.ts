import type { User } from "./auth";
import type { GalleryItem } from "./gallery";
export function canEditArtwork(user: User | null, item: GalleryItem) {
  return (
    !!user &&
    (user.role === "admin" ||
      item.ownerId === user.id ||
      item.archiveOwnerId === user.id)
  );
}
export function canViewArtwork(user: User | null, item: GalleryItem) {
  return !item.hidden || canEditArtwork(user, item);
}
