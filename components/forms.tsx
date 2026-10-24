"use client";
import { SOFTWARE } from "@/lib/software";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  startTransition,
} from "react";
import {
  login,
  register,
  uploadArtwork,
  addComment,
  changePassword,
  updateArtwork,
  deleteUpload,
  linkLegacyAccount,
} from "@/app/actions";
import type { GalleryCategory, GalleryItem } from "@/lib/gallery";
import { USERNAME_PATTERN, USERNAME_HELP } from "@/lib/usernames";

export function AuthForm({
  mode,
  next,
}: {
  mode: "login" | "register";
  next: string;
}) {
  const [state, action, pending] = useActionState(
    mode === "login" ? login : register,
    {},
  );
  const [username, setUsername] = useState("");
  return (
    <form action={action} className="stack-form">
      <input type="hidden" name="next" value={next} />
      <label>
        Username
        <input
          name="username"
          autoComplete="username"
          required
          minLength={mode === "register" ? 3 : 1}
          maxLength={mode === "register" ? 32 : 255}
          pattern={mode === "register" ? USERNAME_PATTERN : undefined}
          title={mode === "register" ? USERNAME_HELP : undefined}
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "register" ? 12 : 1}
          maxLength={128}
        />
      </label>
      {mode === "register" && (
        <p className="help">
          Use at least 12 characters. You can add a passkey once your account is
          created.
        </p>
      )}
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button disabled={pending} type="submit">
        {pending
          ? "Please wait…"
          : mode === "login"
            ? "Sign in"
            : "Create account"}
      </button>
    </form>
  );
}
export function LegacyLinkForm() {
  const [state, action, pending] = useActionState(linkLegacyAccount, {});
  return (
    <form action={action} className="stack-form">
      <label>
        Bryce username
        <input
          name="legacyUsername"
          autoComplete="username"
          required
          maxLength={255}
        />
      </label>
      <label>
        Bryce password
        <input
          name="legacyPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
      <button disabled={pending}>
        {pending ? "Linking…" : "Link Bryce account"}
      </button>
    </form>
  );
}
export function UploadForm({
  categories,
  requiresApproval = false,
}: {
  categories: GalleryCategory[];
  requiresApproval?: boolean;
}) {
  const [state, action, pending] = useActionState(uploadArtwork, {});
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [category, setCategory] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const previewRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef("");
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );
  // Dispatch explicitly so React does not reset the selected file/category after a validation error.
  return (
    <form
      action={action}
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => action(form));
      }}
    >
      <fieldset disabled={!ready || pending} className="form-fields">
        <label>
          Artwork image
          <input
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={(e) => {
              if (urlRef.current) URL.revokeObjectURL(urlRef.current);
              const file = e.target.files?.[0];
              urlRef.current = file ? URL.createObjectURL(file) : "";
              if (previewRef.current) {
                previewRef.current.src = urlRef.current;
                previewRef.current.hidden = !file;
              }
            }}
          />
        </label>
        <img
          ref={previewRef}
          hidden
          alt="Selected artwork preview"
          className="upload-preview"
        />
        <p className="help">
          JPEG, PNG or WebP · up to 10 MB and 40 megapixels. Images are
          converted to WebP, with location metadata removed.
        </p>
        <label>
          Title
          <input
            name="title"
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Category
          <select
            aria-label="Category"
            name="category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea
            name="description"
            rows={5}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Software
          <select name="software" defaultValue="bryce" aria-label="Software">
            {SOFTWARE.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <p className="help">
          Share artwork you created or have permission to publish. Your upload
          will appear in the gallery immediately.
        </p>
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        <button disabled={pending}>
          {pending
            ? "Processing your artwork…"
            : requiresApproval
              ? "Submit for approval"
              : "Publish artwork"}
        </button>
      </fieldset>
    </form>
  );
}
export function CommentForm({ id }: { id: number }) {
  const [state, action, pending] = useActionState(addComment, {});
  return (
    <form action={action} className="stack-form comment-compose">
      <input type="hidden" name="artworkId" value={id} />
      <label>
        Leave a comment
        <textarea name="body" required maxLength={2000} rows={3} placeholder="Share your thoughts on this artwork…" aria-describedby={`comment-note-${id}`} />
      </label>
      {state.success && <p role="status">{state.success}</p>}
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      <div className="comment-compose-footer">
        <p className="help" id={`comment-note-${id}`}>Keep it constructive. Profanity, suspicious advertising and links from untrusted accounts may need admin review.</p>
        <button disabled={pending}>{pending ? "Posting…" : "Post comment"}</button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {});
  return (
    <form action={action} className="stack-form">
      <label>
        Current password
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <label>
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
      <button disabled={pending}>
        {pending ? "Changing password…" : "Change password"}
      </button>
    </form>
  );
}
export function EditArtworkForm({
  item,
  categories,
  moderationLocked = false,
}: {
  item: GalleryItem;
  categories: GalleryCategory[];
  moderationLocked?: boolean;
}) {
  const [state, action, pending] = useActionState(updateArtwork, {});
  return (
    <form action={action} className="stack-form">
      <input name="artworkId" type="hidden" value={item.id} />
      <label>
        Software
        <select
          name="software"
          defaultValue={item.software || "bryce"}
          aria-label="Software"
        >
          {SOFTWARE.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input
          name="title"
          defaultValue={item.title}
          required
          maxLength={120}
        />
      </label>
      <label>
        Category
        <select
          name="category"
          aria-label="Category"
          defaultValue={item.categoryId}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Description
        <textarea
          name="description"
          defaultValue={item.description}
          aria-label="Description"
          maxLength={5000}
          rows={6}
        />
      </label>
      <label>
        Tags
        <input
          name="tags"
          defaultValue={item.tags || ""}
          maxLength={300}
          placeholder="landscape, space, Bryce"
        />
      </label>
      <label>
        Gallery visibility
        <select
          name="visibility"
          aria-label="Gallery visibility"
          disabled={moderationLocked}
          defaultValue={item.hidden ? "hidden" : "public"}
        >
          <option value="public">Published</option>
          <option value="hidden">Hidden from the gallery</option>
        </select>
      </label>
      <p className="help">
        {moderationLocked && (
          <>
            An administrator has hidden this artwork. You can update its
            details, but an administrator must publish it again.{" "}
          </>
        )}
        Hidden artwork is only shown on its detail page to its owner and
        administrators. Previously shared image-file URLs may still be
        accessible.
      </p>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      <button disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
    </form>
  );
}
export function DeleteArtworkForm({ id }: { id: number }) {
  return (
    <form
      action={deleteUpload}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Delete this artwork and its comments? This cannot be undone.",
          )
        )
          event.preventDefault();
      }}
    >
      <input name="artworkId" type="hidden" value={id} />
      <button className="danger">Delete artwork</button>
    </form>
  );
}
