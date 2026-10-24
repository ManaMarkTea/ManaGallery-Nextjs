import { requireAdmin } from "@/lib/admin";
import { loadGallery } from "@/lib/gallery";
import { AdminHeading } from "@/components/admin-ui";
import { CategoryForm } from "@/components/admin-forms";
export default async function Categories() {
  await requireAdmin();
  const { categories, items } = await loadGallery();
  return (
    <>
      <AdminHeading
        title="Gallery categories"
        description="Give every world a home. Create categories, update their names, and set their order."
      >
        <a className="admin-primary-link" href="#new-category">
          + New category
        </a>
      </AdminHeading>
      <div className="admin-category-layout">
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>All categories</h2>
              <p>{categories.length} categories, in gallery order</p>
            </div>
          </div>
          {categories.map((c) => (
            <details key={c.id} className="admin-category-detail">
              <summary>
                <span className="admin-category-icon">▦</span>
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {items
                      .filter((i) => i.categoryId === c.id)
                      .length.toLocaleString()}{" "}
                    artworks · Order {c.order || 0}
                  </small>
                </div>
                <span>⌄</span>
              </summary>
              <CategoryForm
                category={{
                  ...c,
                  count: items.filter((i) => i.categoryId === c.id).length,
                }}
              />
            </details>
          ))}
        </section>
        <section id="new-category" className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>Create a category</h2>
              <p>Lower sort orders appear first.</p>
            </div>
          </div>
          <CategoryForm />
        </section>
      </div>
    </>
  );
}
