"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
async function request(action: string, body?: unknown) {
  const response = await fetch(`/api/passkeys/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please try again.");
  return data;
}
export function PasskeyButton({
  mode,
  next = "/account",
}: {
  mode: "login" | "register";
  next?: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <div className="passkey-control">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setMessage("");
          setBusy(true);
          try {
            if (!browserSupportsWebAuthn())
              throw new Error(
                "This browser does not support passkeys. Use your password instead.",
              );
            const optionsJSON = await request(`${mode}-options`);
            const result =
              mode === "register"
                ? await startRegistration({ optionsJSON })
                : await startAuthentication({ optionsJSON });
            await request(`${mode}-verify`, result);
            if (mode === "login") {
              router.push(
                /^\/(?!\/)/.test(next) && !next.includes("\\")
                  ? next
                  : "/account",
              );
              router.refresh();
            } else {
              setMessage("Passkey added. You can now use it to sign in.");
              router.refresh();
            }
          } catch (error) {
            setMessage(
              error instanceof Error && error.name === "NotAllowedError"
                ? "Passkey request cancelled or timed out. You can try again."
                : error instanceof Error
                  ? error.message
                  : "Unable to use this passkey.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Waiting for your device…"
          : mode === "register"
            ? "Add a passkey"
            : "Sign in with a passkey"}
      </button>
      {message && (
        <p role="status" className="help">
          {message}
        </p>
      )}
    </div>
  );
}
export function RemovePasskey({ id }: { id: string }) {
  const router = useRouter(),
    [message, setMessage] = useState("");
  return (
    <span>
      <button
        type="button"
        className="danger"
        onClick={async () => {
          try {
            await request("delete", { id });
            router.refresh();
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Unable to remove passkey.",
            );
          }
        }}
      >
        Remove
      </button>
      {message && <span role="alert">{message}</span>}
    </span>
  );
}
