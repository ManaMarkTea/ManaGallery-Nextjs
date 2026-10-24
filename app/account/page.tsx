import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { loadGallery } from "@/lib/gallery";
import { db } from "@/lib/db";
import {
  PasswordForm,
  DeleteArtworkForm,
  LegacyLinkForm,
} from "@/components/forms";
import { PasskeyButton, RemovePasskey } from "@/components/passkeys";
import { canViewArtwork } from "@/lib/permissions";
export default async function Account() {
  const user = await getUser();
  if (!user) redirect("/login");
  const { items } = await loadGallery();
  const uploads = items.filter((i) => i.ownerId === user.id);
  const archive = items.filter((i) => i.archiveOwnerId === user.id);
  const legacy = db()
    .prepare("SELECT username FROM legacy_accounts WHERE user_id=?")
    .get(user.id) as { username: string } | undefined;
  const favorites = new Set(
    (
      db()
        .prepare("SELECT artwork_id FROM favorites WHERE user_id=?")
        .all(user.id) as { artwork_id: number }[]
    ).map((r) => r.artwork_id),
  );
  const passkeys = db()
    .prepare("SELECT id,created FROM passkeys WHERE user_id=?")
    .all(user.id) as { id: string; created: string }[];
  return (
    <main className="account-page">
      <div className="panel">
        <h1>Hello, {user.username}</h1>
        <p>Your corner of the Bryce community.</p>
        {user.role === "admin" && (
          <p>
            <Link href="/admin">Open admin control panel →</Link>
          </p>
        )}
        <Link className="button button-light" href="/upload">
          Upload artwork →
        </Link>
      </div>
      <section className="panel">
        <h2>Bryce account</h2>
        {legacy ? (
          <p>
            Linked to <strong>{legacy.username}</strong>. Your archived artwork
            appears below.
          </p>
        ) : (
          <>
            <p>
              Already have a Bryce5 account? Verify its password to connect your
              archived artwork to this account. Your local password and passkeys
              stay the same.
            </p>
            <LegacyLinkForm />
          </>
        )}
      </section>
      {legacy && (
        <section className="panel">
          <h2>Your Bryce archive ({archive.length})</h2>
          {archive.slice(0, 24).map((i) => (
            <div className="account-art" key={i.id}>
              <Link href={`/art/${i.id}`}>
                <img src={i.image || undefined} alt="" />
                <span>
                  {i.title}
                  {i.pending
                    ? " · Awaiting approval"
                    : i.hidden
                      ? " · Hidden"
                      : ""}
                </span>
              </Link>
              <Link href={`/art/${i.id}/edit`}>Edit</Link>
            </div>
          ))}
          {archive.length > 24 && (
            <p className="help">
              Showing the first 24 archived works.{" "}
              <Link href={`/?q=${encodeURIComponent(legacy.username)}`}>
                Find more in the gallery →
              </Link>
            </p>
          )}
          {!archive.length && (
            <p>
              No public archived artwork is associated with this Bryce account.
            </p>
          )}
        </section>
      )}
      <section className="panel">
        <h2>Passkeys</h2>
        <p>
          Sign in using Windows Hello, your phone, or a security key. Keep your
          password as a backup.
        </p>
        <PasskeyButton mode="register" />
        {passkeys.map((p, i) => (
          <div className="passkey-row" key={p.id}>
            <span>
              Passkey {i + 1} · added {p.created.slice(0, 10)}
            </span>
            <RemovePasskey id={p.id} />
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Change password</h2>
        <PasswordForm />
      </section>
      <section className="panel">
        <h2>Your uploads ({uploads.length})</h2>
        {uploads.length ? (
          uploads.map((i) => (
            <div className="account-art" key={i.id}>
              <Link href={`/art/${i.id}`}>
                <img src={i.image} alt="" />
                <span>{i.title}</span>
              </Link>
              <div className="account-art-actions">
                <Link href={`/art/${i.id}/edit`}>Edit</Link>
                <DeleteArtworkForm id={i.id} />
              </div>
            </div>
          ))
        ) : (
          <p>
            You haven’t uploaded anything yet.{" "}
            <Link href="/upload">Share your first render.</Link>
          </p>
        )}
      </section>
      <section className="panel">
        <h2>
          Favorites (
          {
            items.filter((i) => favorites.has(i.id) && canViewArtwork(user, i))
              .length
          }
          )
        </h2>
        {items
          .filter((i) => favorites.has(i.id) && canViewArtwork(user, i))
          .map((i) => (
            <div className="account-art" key={i.id}>
              <Link href={`/art/${i.id}`}>
                <img src={i.image || undefined} alt="" />
                <span>
                  {i.title} <small>by {i.author}</small>
                </span>
              </Link>
            </div>
          ))}
        {!favorites.size && (
          <p>Save artwork from its detail page to find it here.</p>
        )}
      </section>
    </main>
  );
}
