/**
 * POST /api/marketplace/install
 * Installs a marketplace listing for the current tenant.
 * Creates a transaction + factory record (disabled by default).
 * Body: { listingId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = serviceClient();
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: member } = await sb
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .single();
    if (!member) return NextResponse.json({ error: "No tenant" }, { status: 404 });

    const tenantId = member.tenant_id as string;
    const body = await req.json() as { listingId?: string };
    if (!body.listingId) return NextResponse.json({ error: "listingId is required" }, { status: 400 });

    // Fetch listing
    const { data: listing, error: listErr } = await sb
      .from("marketplace_listings")
      .select("*")
      .eq("id", body.listingId)
      .eq("status", "active")
      .single();

    if (listErr || !listing) {
      return NextResponse.json({ error: "Listing not found or not active" }, { status: 404 });
    }

    // Check if already installed
    const { data: existing } = await sb
      .from("marketplace_transactions")
      .select("id")
      .eq("listing_id", listing.id)
      .eq("buyer_id", tenantId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Already installed", transactionId: existing.id }, { status: 409 });
    }

    // Create transaction
    const { data: tx, error: txErr } = await sb
      .from("marketplace_transactions")
      .insert({
        listing_id: listing.id,
        buyer_id: tenantId,
        buyer_user_id: user.id,
        price_cents: listing.price_cents,
        currency: listing.currency,
        status: "completed",
      })
      .select("id")
      .single();

    if (txErr) {
      return NextResponse.json({ error: `Transaction failed: ${txErr.message}` }, { status: 500 });
    }

    // Create factory for the tenant (disabled by default)
    const { data: factory, error: fErr } = await sb
      .from("factories")
      .insert({
        tenant_id: tenantId,
        name: listing.name,
        slug: listing.category_slug,
        category: listing.category_slug,
        origin: listing.origin,
        type: "factory",
        enabled: false,
        listing_id: listing.id,
        transaction_id: tx!.id,
        avatar: listing.avatar,
        config: {
          max_concurrent_projects: 3,
          default_provider: "anthropic",
          default_model: "claude-sonnet-4-6",
        },
      })
      .select("id")
      .single();

    if (fErr) {
      // Rollback transaction
      await sb.from("marketplace_transactions").delete().eq("id", tx!.id);
      return NextResponse.json({ error: `Factory creation failed: ${fErr.message}` }, { status: 500 });
    }

    // Emit notification
    try {
      const { createNotification } = await import("@/lib/notifications");
      await createNotification({
        tenantId,
        eventType: "factory_installed",
        severity: "info",
        title: `Factory installed — ${listing.name as string}`,
        body: `From ${listing.origin as string} marketplace. Enable it in Factory Manager.`,
        metadata: { listingId: listing.id, factoryId: factory!.id },
      });
    } catch { /* notification failure is non-blocking */ }

    return NextResponse.json({
      transactionId: tx!.id,
      factoryId: factory!.id,
      message: `"${listing.name as string}" installed. Enable it in Factory Manager.`,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
