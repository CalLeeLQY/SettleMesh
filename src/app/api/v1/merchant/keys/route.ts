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

  let body: { merchant_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { merchant_id } = body;
  if (!merchant_id) {
    return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 });
  }

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

  let body: { key_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { key_id } = body;
  if (!key_id) {
    return NextResponse.json({ error: "Missing key_id" }, { status: 400 });
  }

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
