import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabase/viewer";
import { Nav } from "./nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user } = await getServerViewer();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile }, { data: wallet }] = await Promise.all([
    supabase
      .from("profiles")
      .select("username, avatar_url")
      .eq("id", user.id)
      .single(),
    supabase
      .from("wallets")
      .select("available_credit")
      .eq("user_id", user.id)
      .single(),
  ]);

  return (
    <div className="flex flex-col min-h-full">
      <Nav
        username={profile?.username ?? user.email ?? "User"}
        credits={wallet?.available_credit ?? 0}
      />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
