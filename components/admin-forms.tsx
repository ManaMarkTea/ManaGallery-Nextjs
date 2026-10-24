"use client";
import { useActionState, startTransition, useRef, useEffect } from "react";
import Link from "next/link";
import {
  moderateArtwork,
  saveAccountAccess,
  saveCategory,
  saveSettings,
  moderateComment,
  toggleAutoApprove,
  saveAdsSettings,
} from "@/app/admin/actions";
import type { GalleryItem, GalleryCategory } from "@/lib/gallery";
import type { ManagedAccount } from "@/lib/admin";
import type { FormState } from "@/app/actions";

function Feedback({ state }: { state: FormState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="admin-feedback error">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="admin-feedback">
          {state.success}
        </p>
      )}
    </>
  );
}
function AutoApproveButton({
  userId,
  enabled,
  author,
}: {
  userId: number;
  enabled: boolean;
  author: string;
}) {
  const [state, action, pending] = useActionState(toggleAutoApprove, {});
  return (
    <div>
      <button
        type="button"
        className="admin-secondary"
        aria-label={`Auto upload for ${author}`}
        aria-pressed={enabled}
        disabled={pending}
        onClick={() => {
          const data = new FormData();
          data.set("userId", String(userId));
          data.set("enabled", enabled ? "0" : "1");
          startTransition(() => action(data));
        }}
      >
        {pending ? "Saving…" : `Auto upload: ${enabled ? "On" : "Off"}`}
      </button>
      <Feedback state={state} />
    </div>
  );
}
export function ArtworkAdminTable({
  items,
  approvalByUser = {},
}: {
  items: GalleryItem[];
  approvalByUser?: Record<number, boolean>;
}) {
  const [state, action, pending] = useActionState(moderateArtwork, {});
  return (
    <form
      action={action}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null;
        data.set("visibility", submitter?.value || "");
        startTransition(() => action(data));
      }}
    >
      <div className="admin-table-tools">
        <span>Select images to change their visibility</span>
        <div>
          <button disabled={pending} name="visibility" value="public">
            Publish selected
          </button>
          <button
            disabled={pending}
            className="admin-secondary"
            name="visibility"
            value="hidden"
          >
            Hide selected
          </button>
        </div>
      </div>
      <Feedback state={state} />
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Select</span>
              </th>
              <th>Artwork</th>
              <th>Artist</th>
              <th>Category</th>
              <th>Status</th>
              <th>Added</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <input
                    type="checkbox"
                    name="artworkId"
                    value={item.id}
                    aria-label={`Select ${item.title}`}
                  />
                </td>
                <td>
                  <Link href={`/art/${item.id}`} className="admin-art-title">
                    <img src={item.image || undefined} alt="" />
                    <span>
                      {item.title}
                      <small>
                        #{item.id} ·{" "}
                        {item.ownerId ? "New upload" : "Bryce archive"}
                      </small>
                    </span>
                  </Link>
                </td>
                <td>
                  {item.author || "Unknown artist"}
                  {item.ownerId && (
                    <AutoApproveButton
                      userId={item.ownerId}
                      author={item.author}
                      enabled={!!approvalByUser[item.ownerId]}
                    />
                  )}
                </td>
                <td>{item.category}</td>
                <td>
                  <span
                    className={`admin-badge ${item.hidden ? "muted" : "success"}`}
                  >
                    {item.pending
                      ? "Awaiting approval"
                      : item.hidden
                        ? "Hidden"
                        : "Published"}
                  </span>
                </td>
                <td className="admin-nowrap">
                  {item.date?.slice(0, 10) || "—"}
                </td>
                <td>
                  <Link
                    className="admin-edit-link"
                    href={`/art/${item.id}/edit`}
                  >
                    Edit ↗
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <div className="admin-empty">No artworks match your filters.</div>
      )}
    </form>
  );
}
export function AccountAccessForm({
  account,
  self,
}: {
  account: ManagedAccount;
  self: boolean;
}) {
  const [state, action, pending] = useActionState(saveAccountAccess, {});
  return (
    <form action={action} className="admin-access-form">
      <input type="hidden" name="accountKey" value={account.key} />
      <select
        aria-label={`Role for ${account.username}`}
        name="role"
        defaultValue={account.role}
        disabled={self}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <select
        aria-label={`Status for ${account.username}`}
        name="status"
        defaultValue={account.disabled ? "disabled" : "active"}
        disabled={self}
      >
        <option value="active">Active</option>
        <option value="disabled">Disabled</option>
      </select>
      <button disabled={self || pending}>
        {self ? "Your account" : pending ? "Saving…" : "Save"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
export function CategoryForm({ category }: { category?: GalleryCategory }) {
  const [state, action, pending] = useActionState(saveCategory, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!category && state.success) formRef.current?.reset();
  }, [category, state]);
  return (
    <form
      action={action}
      className="admin-form"
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null;
        const operation = submitter?.value || "save";
        if (operation === "delete" && !confirm("Delete this empty category?"))
          return;
        const data = new FormData(event.currentTarget);
        data.set("operation", operation);
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="id" value={category?.id || ""} />
      <label>
        Category name
        <input
          name="name"
          defaultValue={category?.name || ""}
          required
          maxLength={80}
        />
      </label>
      <label>
        Description
        <textarea
          name="description"
          defaultValue={category?.description || ""}
          aria-label="Description"
          maxLength={500}
          rows={2}
        />
      </label>
      <label>
        Sort order
        <input
          name="order"
          type="number"
          min={-10000}
          max={10000}
          defaultValue={category?.order || 0}
        />
      </label>
      <Feedback state={state} />
      <div className="admin-form-buttons">
        <button disabled={pending} name="operation" value="save">
          {pending ? "Saving…" : category ? "Save category" : "Create category"}
        </button>
        {category && (
          <button
            type="submit"
            name="operation"
            value="delete"
            className="admin-danger"
            disabled={pending || category.count > 0}
          >
            Delete empty category
          </button>
        )}
      </div>
    </form>
  );
}
export function SettingsForm({
  settings,
}: {
  settings: {
    siteName: string;
    description: string;
    registrationOpen: boolean;
    uploadsOpen: boolean;
    uploadStorageLimitMiB: number;
    memberStorageLimitMiB: number;
  };
}) {
  const [state, action, pending] = useActionState(saveSettings, {});
  return (
    <form action={action} className="admin-form">
      <label>
        Site name
        <input
          name="siteName"
          defaultValue={settings.siteName}
          required
          maxLength={60}
        />
      </label>
      <label>
        Site description
        <textarea
          name="description"
          defaultValue={settings.description}
          aria-label="Site description"
          rows={4}
          maxLength={400}
        />
      </label>
      <label className="admin-toggle">
        <input
          name="registrationOpen"
          type="checkbox"
          defaultChecked={settings.registrationOpen}
        />
        <span>
          Allow new registrations
          <small>
            Existing members can still sign in when registration is paused.
          </small>
        </span>
      </label>
      <label className="admin-toggle">
        <input
          name="uploadsOpen"
          type="checkbox"
          defaultChecked={settings.uploadsOpen}
        />
        <span>
          Allow artwork uploads
          <small>
            Administrators can continue uploading while member uploads are
            paused.
          </small>
        </span>
      </label>
      <label>
        Gallery upload storage (MiB)
        <input
          name="uploadStorageLimitMiB"
          type="number"
          min={1}
          max={1048576}
          required
          defaultValue={settings.uploadStorageLimitMiB}
        />
        <small>
          Includes uploaded images and previews. Imported archive files are
          separate.
        </small>
      </label>
      <label>
        Storage per member (MiB)
        <input
          name="memberStorageLimitMiB"
          type="number"
          min={1}
          max={1048576}
          required
          defaultValue={settings.memberStorageLimitMiB}
        />
        <small>
          Applies to every uploader, including administrators. Lowering a limit
          preserves existing artwork.
        </small>
      </label>
      <Feedback state={state} />
      <button disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
export function AdsSettingsForm({
  settings,
}: {
  settings: { enabled: boolean; publisher: string; slot: string };
}) {
  const [state, action, pending] = useActionState(saveAdsSettings, {});
  return (
    <form action={action} className="admin-form" aria-label="AdSense settings">
      <label className="admin-toggle">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={settings.enabled}
        />
        <span>
          Enable AdSense
          <small>Localhost and development builds show a preview only.</small>
        </span>
      </label>
      <label>
        Publisher ID
        <input
          name="publisher"
          defaultValue={settings.publisher}
          required
          pattern="ca-pub-[0-9]{16}"
          maxLength={23}
          spellCheck={false}
          placeholder="ca-pub-0000000000000000"
        />
      </label>
      <label>
        Ad slot ID
        <input
          name="slot"
          defaultValue={settings.slot}
          required
          pattern="[0-9]{10}"
          maxLength={10}
          inputMode="numeric"
          placeholder="0000000000"
        />
      </label>
      <p>
        Use the IDs from your AdSense ad unit. Saving also updates /ads.txt
        automatically.
      </p>
      <Feedback state={state} />
      <button disabled={pending}>
        {pending ? "Saving…" : "Save AdSense settings"}
      </button>
    </form>
  );
}
export function DeleteAdminComment({ id }: { id: number }) {
  const [state, action, pending] = useActionState(moderateComment, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Permanently delete this comment?")) e.preventDefault();
      }}
    >
      <input name="id" type="hidden" value={id} />
      <button className="admin-danger" disabled={pending}>
        {pending ? "Deleting…" : "Delete comment"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
