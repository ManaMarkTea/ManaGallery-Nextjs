import { requireAdmin } from "@/lib/admin";
import { AdminShell } from "@/components/admin-shell";
import "./admin.css";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  return <AdminShell username={user.username}>{children}</AdminShell>;
}
