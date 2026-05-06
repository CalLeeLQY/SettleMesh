import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabase/viewer";
import { Nav } from "./nav";
import { Suspense } from "react";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-full">
      <Suspense fallback={<NavFallback />}>
        <AuthenticatedNav />
      </Suspense>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}

async function AuthenticatedNav() {
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
    <Nav
      username={profile?.username ?? user.email ?? "User"}
      credits={wallet?.available_credit ?? 0}
    />
  );
}

function NavFallback() {
  return (
    <nav className="border-b border-border bg-white sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="flex items-center gap-3">
          <div className="h-8 w-28 rounded-full bg-muted" />
          <div className="h-4 w-16 rounded bg-muted" />
        </div>
      </div>
    </nav>
  );
}
