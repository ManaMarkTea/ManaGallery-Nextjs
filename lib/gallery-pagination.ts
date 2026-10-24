export const GALLERY_PAGE_SIZES = [24, 48, 96] as const;

export function galleryPageSize(value: unknown): number {
  const size = Number(value);
  return GALLERY_PAGE_SIZES.some((allowed) => allowed === size) ? size : 24;
}
