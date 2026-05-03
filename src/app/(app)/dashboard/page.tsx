import { getServerViewer } from "@/lib/supabase/viewer";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Coins, ArrowUpRight, ArrowDownLeft } from "lucide-react";

export default async function DashboardPage() {
  const { supabase, user } = await getServerViewer();

  if (!user) redirect("/login");

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, available_credit, purchased_credit, earned_credit, total_spent, total_earned")
    .eq("user_id", user.id)
    .single();

  const w = wallet ?? {
    id: "",
    available_credit: 0,
    purchased_credit: 0,
    earned_credit: 0,
    total_spent: 0,
    total_earned: 0,
  };

  const { data: recentEntries } = await supabase
    .from("ledger_entries")
    .select("id, entry_type, amount, balance_after, created_at, credit_source, transaction:ledger_transactions(type, description)")
    .eq("wallet_id", w.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Coins size={14} />
            Available Credits
          </div>
          <div className="text-3xl font-bold text-accent">
            {w.available_credit.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Purchased: {w.purchased_credit.toLocaleString()} · Earned: {w.earned_credit.toLocaleString()}
          </div>
          <Link
            href="/topup"
            className="mt-3 inline-block text-sm text-accent hover:underline"
          >
            + Top up
          </Link>
        </div>

        <div className="border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <ArrowUpRight size={14} />
            Total Spent
          </div>
          <div className="text-3xl font-bold">
            {w.total_spent.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400 mt-1">credits</div>
        </div>

        <div className="border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <ArrowDownLeft size={14} />
            Total Earned
          </div>
          <div className="text-3xl font-bold">
            {w.total_earned.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400 mt-1">credits</div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Transactions</h2>
        {recentEntries && recentEntries.length > 0 ? (
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-gray-500">
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-left px-4 py-2 font-medium">Description</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="text-right px-4 py-2 font-medium">Balance</th>
                  <th className="text-right px-4 py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentEntries.map((entry: Record<string, unknown>) => {
                  const txn = entry.transaction as Record<string, string> | null;
                  const isCredit = entry.entry_type === "credit";
                  return (
                    <tr key={entry.id as string} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          isCredit
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        }`}>
                          {isCredit ? "+" : "-"} {txn?.type ?? "unknown"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 truncate max-w-[200px]">
                        {txn?.description ?? "—"}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-medium ${isCredit ? "text-green-600" : "text-red-600"}`}>
                        {isCredit ? "+" : "-"}{(entry.amount as number).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500">
                        {(entry.balance_after as number).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-400 text-xs">
                        {new Date(entry.created_at as string).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No transactions yet.</p>
        )}
      </div>
    </div>
  );
}
