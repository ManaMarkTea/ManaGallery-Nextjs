import { cookies } from "next/headers";
import { randomBytes, createHash } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransport } from "@simplewebauthn/server";
import { db, rateLimit } from "@/lib/db";
import { getUser, createSession } from "@/lib/auth";
import { requestClientKey } from "@/lib/request-client";

const origin = process.env.APP_ORIGIN || "http://localhost:3000";
const rpID = new URL(origin).hostname;
const cookieName = "rendergallery_challenge";
type Passkey = {
  id: string;
  user_id: number;
  public_key: Uint8Array;
  counter: number;
  transports: string;
};
function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function handle(id: number) {
  return createHash("sha256").update(`rendergallery-user:${id}`).digest();
}
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
async function saveChallenge(challenge: string, kind: string, userId?: number) {
  const token = randomBytes(32).toString("hex");
  db().prepare("DELETE FROM challenges WHERE expires<?").run(Date.now());
  db()
    .prepare(
      "INSERT INTO challenges(token,challenge,user_id,kind,expires) VALUES (?,?,?,?,?)",
    )
    .run(
      tokenHash(token),
      challenge,
      userId ?? null,
      kind,
      Date.now() + 300_000,
    );
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: origin.startsWith("https:"),
    path: "/api/passkeys",
    maxAge: 300,
  });
}
async function consumeChallenge(kind: string) {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  jar.set(cookieName, "", { path: "/api/passkeys", maxAge: 0 });
  if (!token) return;
  const challenge = db()
    .prepare("DELETE FROM challenges WHERE token=? RETURNING *")
    .get(tokenHash(token)) as
    | {
        challenge: string;
        user_id: number | null;
        kind: string;
        expires: number;
      }
    | undefined;
  if (challenge?.kind === kind && challenge.expires > Date.now())
    return challenge;
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  if (request.headers.get("origin") !== origin)
    return json(
      {
        error:
          "Origin not allowed. Open the site using its configured APP_ORIGIN.",
      },
      403,
    );
  const { action } = await params;
  const ip = requestClientKey(request.headers);
  if (!rateLimit(`passkey:${ip}`, 100, 900))
    return json({ error: "Too many requests. Try again in 15 minutes." }, 429);
  const user = await getUser();
  try {
    if (action === "register-options") {
      if (!user) return json({ error: "Sign in first." }, 401);
      const existing = db()
        .prepare("SELECT id,transports FROM passkeys WHERE user_id=?")
        .all(user.id) as { id: string; transports: string }[];
      if (existing.length >= 10)
        return json(
          {
            error:
              "You can register up to 10 passkeys. Remove an old one first.",
          },
          400,
        );
      const options = await generateRegistrationOptions({
        rpName: "RenderGallery",
        rpID,
        userName: user.username,
        userID: handle(user.id),
        attestationType: "none",
        excludeCredentials: existing.map((p) => ({
          id: p.id,
          transports: JSON.parse(p.transports),
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });
      await saveChallenge(options.challenge, "register", user.id);
      return json(options);
    }
    if (action === "login-options") {
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "required",
      });
      await saveChallenge(options.challenge, "login");
      return json(options);
    }
    const raw = await request.text();
    if (raw.length > 65536) return json({ error: "Request too large." }, 413);
    const body = JSON.parse(raw);
    if (action === "register-verify") {
      const challenge = await consumeChallenge("register");
      if (!user || !challenge || challenge.user_id !== user.id)
        return json({ error: "Registration expired. Please try again." }, 400);
      const result = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo)
        return json({ error: "Passkey could not be verified." }, 400);
      const { credential } = result.registrationInfo;
      db()
        .prepare(
          "INSERT INTO passkeys(id,user_id,public_key,counter,transports) VALUES (?,?,?,?,?)",
        )
        .run(
          credential.id,
          user.id,
          Buffer.from(credential.publicKey),
          credential.counter,
          JSON.stringify(credential.transports || []),
        );
      return json({ verified: true });
    }
    if (action === "login-verify") {
      const challenge = await consumeChallenge("login");
      if (!challenge)
        return json({ error: "Sign-in expired. Please try again." }, 400);
      const key = db()
        .prepare("SELECT * FROM passkeys WHERE id=?")
        .get(body.id) as Passkey | undefined;
      if (!key)
        return json({ error: "This passkey is not registered here." }, 400);
      if (
        body.response?.userHandle &&
        body.response.userHandle !== handle(key.user_id).toString("base64url")
      )
        return json({ error: "Invalid passkey account." }, 400);
      const result = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: key.id,
          publicKey: new Uint8Array(key.public_key),
          counter: key.counter,
          transports: JSON.parse(key.transports) as AuthenticatorTransport[],
        },
        requireUserVerification: true,
      });
      if (!result.verified)
        return json({ error: "Passkey could not be verified." }, 400);
      const updated = db()
        .prepare("UPDATE passkeys SET counter=? WHERE id=? AND counter=?")
        .run(result.authenticationInfo.newCounter, key.id, key.counter);
      if (!updated.changes)
        return json({ error: "Please try signing in again." }, 400);
      await createSession(key.user_id, "passkey");
      return json({ verified: true });
    }
    if (action === "delete") {
      if (!user) return json({ error: "Sign in first." }, 401);
      db()
        .prepare("DELETE FROM passkeys WHERE id=? AND user_id=?")
        .run(body.id, user.id);
      return json({ deleted: true });
    }
    return json({ error: "Not found." }, 404);
  } catch {
    return json(
      { error: "Passkey verification failed. Please try again." },
      400,
    );
  }
}
