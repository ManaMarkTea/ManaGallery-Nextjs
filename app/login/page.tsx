import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { AuthForm } from "@/components/forms";
import { PasskeyButton } from "@/components/passkeys";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getUser()) redirect("/account");
  const { next } = await searchParams;
  return (
    <main className="form-page panel">
      <h1>Welcome back</h1>
      <p>Sign in to share artwork and join the conversation.</p>
      <AuthForm mode="login" next={next || "/account"} />
      <div className="form-divider">or</div>
      <PasskeyButton mode="login" next={next || "/account"} />
      <p className="help">
        New here? <Link href="/register">Create an account</Link>
      </p>
      <p className="help">
        Bryce5 members can sign in with their existing username and password.
        Already created a local account? Sign in with its local password and
        link Bryce from My account.
      </p>
    </main>
  );
}
