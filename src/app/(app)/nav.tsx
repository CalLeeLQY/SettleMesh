"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Coins, Code, LogOut } from "lucide-react";

export function Nav({
  username,
  credits,
}: {
  username: string;
  credits: number;
}) {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="border-b border-border bg-white sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-bold text-accent">
            AnyPay
          </Link>
          <Link
            href="/developer"
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-foreground transition-colors"
          >
            <Code size={16} />
            API
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/topup"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-muted rounded-full text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            <Coins size={14} className="text-accent" />
            {credits.toLocaleString()} credits
          </Link>
          <span className="text-sm text-gray-500">{username}</span>
          <button
            onClick={handleSignOut}
            className="text-gray-400 hover:text-foreground transition-colors"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}
