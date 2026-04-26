import { createClient } from "@/lib/supabase/server";
import { generateApiKey, getAdminClient } from "@/lib/merchant-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { merchant_id } = await request.json();

  // Verify the merchant belongs to the user
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("id", merchant_id)
    .eq("user_id", user.id)
    .single();

  if (!merchant) {
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  }

  const { key, prefix, hash } = generateApiKey();

  const admin = getAdminClient();

  const { error } = await admin.from("merchant_api_keys").insert({
    merchant_id: merchant.id,
    key_prefix: prefix,
    key_hash: hash,
    label: "Default",
  });

  if (error) {
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }

  return NextResponse.json({ api_key: key });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key_id } = await request.json();

  // Verify ownership via RLS — the policy checks merchant.user_id = auth.uid()
  const { error } = await supabase
    .from("merchant_api_keys")
    .delete()
    .eq("id", key_id);

  if (error) {
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
