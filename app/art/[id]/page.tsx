import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGalleryItem, getComments } from "@/lib/gallery";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toggleFavorite, deleteComment } from "@/app/actions";
import { CommentForm } from "@/components/forms";
import { ImageViewer } from "@/components/image-viewer";
import { canEditArtwork, canViewArtwork } from "@/lib/permissions";
import { ArtworkViews } from "@/components/artwork-views";
import { getAdsConfig } from "@/lib/ads";
import { Advertisement } from "@/components/advertisement";
import { softwareName } from "@/lib/software";
import { getModelPreviewDownload } from "@/lib/materials";

type Props = { params: Promise<{ id: string }> };

function commentDate(value: string) {
  const iso = value.replace(" ", "T") + (/Z$|[+-]\d\d:\d\d$/.test(value) ? "" : "Z");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const artwork = await getGalleryItem(Number.parseInt(id, 10));
  const user = await getUser();
  return {
    title: artwork && canViewArtwork(user, artwork) ? artwork.title : "Artwork",
  };
}

export default async function ArtworkPage({ params }: Props) {
  const { id } = await params;
  const artworkId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(artworkId) || artworkId < 1) notFound();
  const artwork = await getGalleryItem(artworkId);
  if (!artwork) notFound();
  const user = await getUser();
  if (!canViewArtwork(user, artwork)) notFound();
  const modelPreview = user && artwork.modelDownload ? await getModelPreviewDownload(artworkId, artwork.modelDownload) : null;
  const comments = getComments(artworkId);
  const favorite =
    user &&
    db()
      .prepare("SELECT 1 FROM favorites WHERE artwork_id=? AND user_id=?")
      .get(artworkId, user.id);

  return (
    <main className="artwork-page">
      <div className="artwork-topline">
        <Link className="text-link" href="/#gallery">
          ← Back to the gallery
        </Link>
        <span>{artwork.category}</span>
      </div>
      {!user && !artwork.hidden && <Advertisement config={getAdsConfig()} />}
      <div className="artwork-layout">
        <div className="artwork-image-wrap">
          {artwork.fullImage || artwork.image ? (
            <img
              alt={artwork.title}
              className="artwork-image"
              src={artwork.fullImage || artwork.image}
            />
          ) : (
            <div
              aria-label="Artwork preview unavailable"
              className="art-placeholder artwork-placeholder"
              role="img"
            >
              <span>✳</span>
            </div>
          )}
        </div>
        <article className="artwork-info">
          <p className="eyebrow">FROM THE COMMUNITY COLLECTION</p>
          <h1>{artwork.title}</h1>
          <p>
            <Link href={`/?software=${artwork.software || "bryce"}`}>
              Made with {softwareName(artwork.software || "bryce")}
            </Link>
          </p>
          {artwork.pending && (
            <p role="status">
              Awaiting admin approval. You can review and edit this upload
              before it is published.
            </p>
          )}
          <p className="artwork-byline">
            Created by <strong>{artwork.author || "Community artist"}</strong>
          </p>
          {artwork.description && (
            <p className="artwork-description">{artwork.description}</p>
          )}
          <div className="artwork-stats">
            <ArtworkViews id={artworkId} initialCount={artwork.views} />
            {!artwork.ownerId && (
              <>
                <span>
                  <strong>
                    {(artwork.archivedViews || 0).toLocaleString()}
                  </strong>{" "}
                  unverified legacy hits
                </span>
                <span>
                  <strong>{artwork.rating.toFixed(1)}</strong> archived rating
                </span>
              </>
            )}
            <span>
              <strong>{artwork.date?.slice(0, 10) || "Unknown"}</strong> added
            </span>
          </div>
          {canEditArtwork(user, artwork) && (
            <p>
              <Link href={`/art/${artworkId}/edit`}>
                {user?.role === "admin" ? "Edit artwork" : "Edit your artwork"}{" "}
                →
              </Link>
            </p>
          )}
          <div className="artwork-actions">
            {artwork.hidden && (
              <p className="help">This artwork is hidden from the gallery.</p>
            )}
            {artwork.tags && <p className="help">Tags: {artwork.tags}</p>}
            {user ? (
              <form action={toggleFavorite}>
                <input type="hidden" name="artworkId" value={artworkId} />
                <button>
                  {favorite ? "★ Remove favorite" : "☆ Save to favorites"}
                </button>
              </form>
            ) : (
              <Link href={`/login?next=/art/${artworkId}`}>
                Sign in to save this artwork
              </Link>
            )}
            {artwork.fullImage && (
              <ImageViewer src={artwork.fullImage} title={artwork.title} />
            )}
            {artwork.modelDownload && (
              <section className="material-download" aria-label="3D model download">
                <h2>3D model</h2>
                <p>.3DS file · {Math.max(1, Math.ceil(artwork.modelDownload.bytes / 1024))} KB</p>
                {user ? <a className="button button-light" href={`/download/${artworkId}`}>Download model (.3ds) ↓</a> :
                  <Link className="button button-light" href={`/login?next=/art/${artworkId}`}>Sign in to download model</Link>}
                <p className="help">Import this file into software that supports the 3D Studio (.3ds) format. The image above is a preview.</p>
                {modelPreview && <>
                  <p><a className="button" href={`/download/${artworkId}?format=glb`}>Download GLB geometry ↓</a></p>
                  <p className="help">Modern GLB alternative · {Math.max(1, Math.ceil(modelPreview.bytes / 1024))} KB. Geometry and basic colors only; external textures and animation are omitted.</p>
                </>}
              </section>
            )}
            {artwork.modelEntry && !artwork.modelDownload && (
              <p className="help">Preview only — no model file is available for this entry.</p>
            )}
            {artwork.materialDownload && (
              <section
                className="material-download"
                aria-label="Material download"
              >
                <h2>Bryce material preset</h2>
                <p>
                  .MAT file ·{" "}
                  {artwork.materialDownload.bytes >= 1024 * 1024
                    ? `${(artwork.materialDownload.bytes / (1024 * 1024)).toFixed(1)} MB`
                    : `${Math.max(1, Math.ceil(artwork.materialDownload.bytes / 1024))} KB`}
                </p>
                {user ? (
                  <a
                    className="button button-light"
                    href={`/download/${artworkId}`}
                  >
                    Download material (.mat) ↓
                  </a>
                ) : (
                  <Link
                    className="button button-light"
                    href={`/login?next=/art/${artworkId}`}
                  >
                    Sign in to download material
                  </Link>
                )}
                <p className="help">
                  Import this preset into Bryce’s material library. The gallery
                  image is a preview of the material.
                </p>
              </section>
            )}
            {artwork.materialEntry && !artwork.materialDownload && (
              <p className="help">
                Preview only — no material file is available for this entry.
              </p>
            )}
            <Link href={`/?category=${artwork.categoryId}`}>
              More in {artwork.category} →
            </Link>
          </div>
        </article>
      </div>
      <section className="comments panel" aria-labelledby="comments-heading">
        <div className="comments-heading">
          <h2 id="comments-heading">Comments <span className="comment-count">{comments.length.toLocaleString()}</span></h2>
          <span className="comments-caption">A conversation around the artwork</span>
        </div>
        {user ? (
          <CommentForm id={artworkId} />
        ) : (
          <p className="comment-sign-in">
            <Link href={`/login?next=/art/${artworkId}`}>Sign in</Link> to join
            the conversation.
          </p>
        )}
        {comments.map((c) => (
          <article className="comment" key={c.id}>
            <span className="comment-avatar" aria-hidden="true">{Array.from(c.username.trim()).slice(0, 2).join("").toUpperCase()}</span>
            <div className="comment-content">
              <div className="comment-heading">
                <div className="comment-author"><strong>{c.username}</strong>{!!c.archived && <span className="comment-archive-label">Archived</span>}</div>
                <time title={`${c.created} UTC`}>{commentDate(c.created)}</time>
              </div>
              <p className="comment-body">{c.archived ? c.body.replace(/^[-–—]\s*\r?\n/, "") : c.body}</p>
            {(c.userId === user?.id || user?.role === "admin") && (
              <form action={deleteComment} className="comment-controls">
                <input name="commentId" value={c.id} type="hidden" />
                <button className="quiet-button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" /></svg>
                  Delete comment
                </button>
              </form>
            )}
            </div>
          </article>
        ))}
        {!comments.length && (
          <p className="help">
            No comments yet. Be the first to leave a thought.
          </p>
        )}
      </section>
    </main>
  );
}
