import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { AuthForm } from "@/components/forms";
import { getSiteSettings } from "@/lib/settings";
export default async function Register() {
  if (await getUser()) redirect("/account");
  if (!getSiteSettings().registrationOpen)
    return (
      <main className="form-page panel">
        <h1>Registration is paused</h1>
        <p>
          Existing members can still <Link href="/login">sign in</Link>.
        </p>
      </main>
    );
  return (
    <main className="form-page panel">
      <h1>Join the community</h1>
      <p>Create a local RenderGallery account.</p>
      <AuthForm mode="register" next="/account" />
      <p className="help">
        Already a member? <Link href="/login">Sign in</Link>
      </p>
      <p className="help">
        No email is collected in this local version. Keep your password
        somewhere safe; email recovery is not available yet.
      </p>
    </main>
  );
}
