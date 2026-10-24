// Entirely fictional data; no imported artwork, account details or images.
export const fixtureGallery = {
  categories: [
    { id: 1, name: "Landscapes", count: 60 },
    { id: 2, name: "Still lifes", count: 0 },
    { id: 3, name: "Other artwork", count: 0 },
    { id: 12, name: "Material X-Change (.MAT)", count: 2 },
  ],
  items: Array.from({ length: 62 }, (_, index) => ({
    id: index + 1,
    title:
      index < 60
        ? `Sample mountain world ${index + 1}`
        : `Sample material ${index - 59}`,
    description: "Fictional artwork used only for automated tests.",
    categoryId: index < 60 ? 1 : 12,
    category: index < 60 ? "Landscapes" : "Material X-Change (.MAT)",
    author: `Sample artist ${index + 1}`,
    date: "2020-01-01",
    views: index === 49 ? 150000 : index,
    rating: 3,
    image: "/test-placeholder.svg",
    fullImage: "/test-placeholder.svg",
  })),
};
