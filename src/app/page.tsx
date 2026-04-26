import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Coins } from "lucide-react";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Coins size={32} className="text-accent" />
          <h1 className="text-3xl font-bold">AnyPay</h1>
        </div>
        <p className="text-gray-500 mb-8">
          Buy and sell virtual goods with credits. No bank account needed.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/register"
            className="px-6 py-2.5 bg-accent text-white rounded-lg font-medium hover:bg-accent-hover transition-colors"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="px-6 py-2.5 border border-border rounded-lg font-medium hover:bg-muted transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
