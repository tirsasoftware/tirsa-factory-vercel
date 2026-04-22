"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { brand } from "@/lib/brand";
import {
  ChevronDown, ChevronRight, Layers, Store,
  CheckSquare, Download, Check, AlertCircle,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────── */

interface Listing {
  id: string;
  publisher_id: string;
  publisher_name: string;
  category_slug: string;
  name: string;
  description: string | null;
  avatar: string | null;
  price_cents: number;
  currency: string;
  origin: "tirsa" | "community" | "paid";
  installed: boolean;
  transaction_id: string | null;
}

type CatAgent = {
  slug: string; name: string; level: string | null;
  autonomy: string; enabled: boolean;
  squad_name: string; squad_color: string | null;
};

const ORIGIN_COLOR: Record<string, string> = {
  tirsa: "#1463ff",
  community: "#10b981",
  paid: "#f59e0b",
};

const AGENT_ICON: Record<string, string> = {
  intake: "📥", scout: "🔭", research: "🔬", "product-owner": "🎯", finance: "💰",
  monetization: "💳", portfolio: "📁", architect: "🏗", devops: "🚀",
  plm: "📋", spec: "📐", design: "🎨", brand: "✨", eval: "⚖️",
  security: "🛡", compliance: "⚖️", privacy: "🔒", "b2b-sales": "🤝",
  developer: "⚙️", qa: "✅", debt: "🔧", docs: "📝", review: "👁",
  release: "📦", growth: "📈", experiment: "🧪", localization: "🌍",
  data: "📊", "executive-ux": "🖥", commandops: "⚡", support: "🎧",
  incident: "🚨",
};

type ShelfSection = "factories" | "pipelines";
const SHELF_SECTIONS: { id: ShelfSection; label: string; icon: React.FC<{ size?: number }> }[] = [
  { id: "factories", label: "Factories", icon: Layers },
  { id: "pipelines", label: "Pipelines", icon: Layers },
];

type FactoryTab = "tirsa" | "community" | "paid" | "myorg";

/* ─── Main ──────────────────────────────────────────────── */

export default function MarketplacePage() {
  const router = useRouter();
  const { session, loading: authLoading, refreshFactories } = useAuth();

  const [section, setSection] = useState<ShelfSection>("factories");
  const [subTab, setSubTab] = useState<FactoryTab>("tirsa");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [expandedListing, setExpandedListing] = useState<string | null>(null);
  const [catAgents, setCatAgents] = useState<CatAgent[]>([]);
  const [catAgentsLoading, setCatAgentsLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [authLoading, session, router]);

  const loadListings = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s) return;
    const res = await fetch("/api/marketplace", {
      headers: { Authorization: `Bearer ${s.access_token}` },
    });
    if (res.ok) {
      const body = await res.json() as { listings: Listing[] };
      setListings(body.listings);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => { loadListings(); }, [loadListings]);

  async function handleInstall(listing: Listing) {
    setInstalling(listing.id);
    setMessage(null);
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s) return;
    const res = await fetch("/api/marketplace/install", {
      method: "POST",
      headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ listingId: listing.id }),
    });
    const body = await res.json() as { message?: string; error?: string };
    setInstalling(null);
    if (res.ok) {
      setMessage({ type: "success", text: body.message ?? "Installed!" });
      await loadListings();
      await refreshFactories();
    } else {
      setMessage({ type: "error", text: body.error ?? "Install failed" });
    }
    setTimeout(() => setMessage(null), 4000);
  }

  async function loadAgents(_categorySlug: string, listingId: string) {
    if (expandedListing === listingId) { setExpandedListing(null); return; }
    setExpandedListing(listingId);
    setCatAgentsLoading(true);
    const { data: squads } = await supabase.from("squads").select("id, name, color").eq("origin", "built-in").order("display_order");
    if (!squads || squads.length === 0) { setCatAgents([]); setCatAgentsLoading(false); return; }
    const squadIds = squads.map((s) => s.id);
    const { data: agents } = await supabase.from("agent_definitions")
      .select("slug, name, level, autonomy, enabled, squad_id")
      .in("squad_id", squadIds)
      .eq("origin", "built-in")
      .order("name");
    const squadMap = new Map(squads.map((s) => [s.id, s]));
    setCatAgents((agents ?? []).map((a) => {
      const sq = squadMap.get(a.squad_id);
      return { slug: a.slug as string, name: a.name as string, level: a.level as string | null, autonomy: a.autonomy as string, enabled: a.enabled as boolean, squad_name: (sq?.name ?? "") as string, squad_color: (sq?.color ?? null) as string | null };
    }));
    setCatAgentsLoading(false);
  }

  const agentIcon = (slug: string) => AGENT_ICON[slug] ?? "🤖";

  function formatPrice(cents: number, currency: string): string {
    if (cents === 0) return "Free";
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }

  const filteredListings = listings.filter((l) => l.origin === subTab);

  /* ── Listing card ── */
  function ListingCard({ l }: { l: Listing }) {
    const color = ORIGIN_COLOR[l.origin] ?? "#6b7a9e";
    const isExpanded = expandedListing === l.id;
    const isInstalling = installing === l.id;

    return (
      <div style={{
        borderRadius: 14, overflow: "hidden",
        border: `1.5px solid ${l.installed ? "rgba(28,191,107,0.3)" : `${color}30`}`,
        background: l.installed ? "rgba(28,191,107,0.03)" : `${color}04`,
        transition: "all 0.2s",
      }}>
        <div style={{ padding: "22px 22px 18px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 12 }}>
            {l.avatar ? (
              <img src={l.avatar} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Layers size={20} color={color} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "var(--font-heading)", color: "var(--text)", marginBottom: 2 }}>{l.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "var(--overlay0)" }}>by {l.publisher_name}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: `${color}12`, color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {l.origin === "tirsa" ? brand.name : l.origin}
                </span>
              </div>
            </div>
            {/* Price */}
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: l.price_cents === 0 ? "var(--green)" : "var(--text)", fontFamily: "var(--font-heading)" }}>
                {formatPrice(l.price_cents, l.currency)}
              </div>
            </div>
          </div>

          {/* Description */}
          {l.description && (
            <p style={{ fontSize: 12, color: "var(--subtext0)", marginBottom: 14, lineHeight: 1.6 }}>{l.description}</p>
          )}

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {l.installed ? (
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "var(--green)", padding: "6px 14px", borderRadius: 8, background: "rgba(28,191,107,0.08)", border: "1px solid rgba(28,191,107,0.2)" }}>
                <CheckSquare size={14} /> Installed
              </span>
            ) : (
              <button
                onClick={() => handleInstall(l)}
                disabled={isInstalling}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "7px 18px", borderRadius: 8, border: "none",
                  background: isInstalling ? "var(--surface1)" : `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
                  color: isInstalling ? "var(--overlay0)" : "#fff",
                  fontSize: 12, fontWeight: 700, cursor: isInstalling ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <Download size={13} /> {isInstalling ? "Installing…" : l.price_cents === 0 ? "Install — Free" : `Install — ${formatPrice(l.price_cents, l.currency)}`}
              </button>
            )}
            <button
              onClick={() => loadAgents(l.category_slug, l.id)}
              style={{
                padding: "7px 14px", borderRadius: 8,
                border: `1px solid ${color}30`,
                background: isExpanded ? `${color}10` : "transparent",
                color: isExpanded ? color : "var(--subtext0)",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
                fontFamily: "var(--font-sans)",
              }}
            >
              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Explore agents
            </button>
          </div>
        </div>

        {/* Agent table */}
        {isExpanded && (
          <div style={{ borderTop: `1px solid ${color}15`, background: "var(--crust)", padding: "12px 16px", maxHeight: 320, overflowY: "auto" }}>
            {catAgentsLoading ? (
              <div style={{ textAlign: "center", padding: 16, color: "var(--overlay0)", fontSize: 12 }}>Loading agents…</div>
            ) : catAgents.length === 0 ? (
              <div style={{ textAlign: "center", padding: 16, color: "var(--overlay0)", fontSize: 12 }}>No built-in agents found.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--surface0)" }}>
                    {["", "Agent", "Squad", "Level", "Autonomy"].map((h) => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {catAgents.map((a) => (
                    <tr key={a.slug} style={{ borderBottom: "1px solid var(--surface0)" }}>
                      <td style={{ padding: "5px 8px", fontSize: 14, width: 28, textAlign: "center" }}>{agentIcon(a.slug)}</td>
                      <td style={{ padding: "5px 8px", fontWeight: 600, color: "var(--text)" }}>{a.name}</td>
                      <td style={{ padding: "5px 8px" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: `${a.squad_color ?? "#6b7a9e"}18`, color: a.squad_color ?? "#6b7a9e" }}>{a.squad_name}</span>
                      </td>
                      <td style={{ padding: "5px 8px", color: "var(--subtext0)", fontSize: 11 }}>{a.level ?? "—"}</td>
                      <td style={{ padding: "5px 8px" }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: a.autonomy === "human" ? "var(--peach)" : "var(--green)" }}>
                          {a.autonomy === "human" ? "🧑 human" : "⚡ auto"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "var(--font-sans)", color: "var(--text)", background: "var(--base)" }}>
      <AppSidebar active="marketplace" />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left nav — Shelf */}
        <div style={{ width: 180, minWidth: 180, borderRight: "1px solid var(--surface0)", background: "var(--crust)", padding: "16px 8px", overflowY: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 10px", marginBottom: 8 }}>Shelf</div>
          {SHELF_SECTIONS.map(({ id, label, icon: Icon }) => {
            const active = section === id;
            return (
              <button key={id} onClick={() => setSection(id)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "7px 10px", borderRadius: 7, border: "none",
                background: active ? "var(--surface0)" : "transparent",
                color: active ? "var(--text)" : "var(--subtext0)",
                fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer",
                fontFamily: "var(--font-sans)", textAlign: "left",
                borderLeft: active ? "2px solid var(--blue)" : "2px solid transparent",
              }}>
                <Icon size={14} /> {label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {/* Message */}
          {message && (
            <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 8, background: message.type === "success" ? "rgba(28,191,107,0.08)" : "rgba(228,75,95,0.08)", border: `1px solid ${message.type === "success" ? "rgba(28,191,107,0.3)" : "rgba(228,75,95,0.3)"}`, color: message.type === "success" ? "var(--green)" : "var(--red)" }}>
              {message.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />} {message.text}
            </div>
          )}

          {section === "factories" && (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 24 }}>
                {([
                  { id: "tirsa" as FactoryTab, label: brand.name },
                  { id: "community" as FactoryTab, label: "Community" },
                  { id: "paid" as FactoryTab, label: "Paid" },
                  { id: "myorg" as FactoryTab, label: "My Org" },
                ]).map((t) => (
                  <button key={t.id} onClick={() => setSubTab(t.id)} style={{
                    padding: "7px 18px", borderRadius: 8, border: "none",
                    background: subTab === t.id ? "var(--surface0)" : "transparent",
                    color: subTab === t.id ? "var(--text)" : "var(--overlay0)",
                    fontSize: 13, fontWeight: subTab === t.id ? 700 : 500,
                    cursor: "pointer", fontFamily: "var(--font-sans)",
                  }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {loading && <div style={{ textAlign: "center", padding: 40, color: "var(--overlay0)", fontSize: 13 }}>Loading…</div>}

              {/* Official templates */}
              {!loading && subTab === "tirsa" && (
                <div>
                  <p style={{ fontSize: 13, color: "var(--subtext0)", marginBottom: 20 }}>
                    Official {brand.name} templates. Install to add pre-configured squads and built-in agents to your organization.
                  </p>
                  {filteredListings.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--overlay0)" }}>
                      <Store size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
                      <div style={{ fontSize: 14 }}>No listings available yet.</div>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 16 }}>
                      {filteredListings.map((l) => <ListingCard key={l.id} l={l} />)}
                    </div>
                  )}
                </div>
              )}

              {/* Community */}
              {!loading && subTab === "community" && (
                <div style={{ textAlign: "center", padding: "64px 20px", color: "var(--overlay0)" }}>
                  <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>🌐</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--subtext1)", marginBottom: 6 }}>Community Factories</div>
                  <p style={{ fontSize: 13, maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
                    Factories published by the {brand.name} community on GitHub.
                  </p>
                  <div style={{ marginTop: 20, fontSize: 11, fontWeight: 600, color: "var(--overlay0)", padding: "6px 14px", borderRadius: 8, background: "var(--surface0)", display: "inline-block" }}>Coming soon</div>
                </div>
              )}

              {/* Paid */}
              {!loading && subTab === "paid" && (
                <div style={{ textAlign: "center", padding: "64px 20px", color: "var(--overlay0)" }}>
                  <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>💎</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--subtext1)", marginBottom: 6 }}>Paid Factories</div>
                  <p style={{ fontSize: 13, maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
                    Premium factory templates created by verified organizations.
                  </p>
                  <div style={{ marginTop: 20, fontSize: 11, fontWeight: 600, color: "var(--overlay0)", padding: "6px 14px", borderRadius: 8, background: "var(--surface0)", display: "inline-block" }}>Coming soon</div>
                </div>
              )}

              {/* My Org */}
              {!loading && subTab === "myorg" && (
                <div style={{ textAlign: "center", padding: "64px 20px", color: "var(--overlay0)" }}>
                  <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>🏢</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--subtext1)", marginBottom: 6 }}>My Org</div>
                  <p style={{ fontSize: 13, maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
                    Publish your custom factories to the Marketplace for other organizations to discover and install.
                  </p>
                  <div style={{ marginTop: 20, fontSize: 11, fontWeight: 600, color: "var(--overlay0)", padding: "6px 14px", borderRadius: 8, background: "var(--surface0)", display: "inline-block" }}>Coming soon</div>
                </div>
              )}
            </>
          )}

          {/* ── Pipelines shelf ── */}
          {section === "pipelines" && (
            <div style={{ textAlign: "center", padding: "64px 20px", color: "var(--overlay0)" }}>
              <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>🔀</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--subtext1)", marginBottom: 6 }}>Pipeline Templates</div>
              <p style={{ fontSize: 13, maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>
                Pre-built pipeline configurations that define agent execution order, gates, and phases.
                Install pipeline templates and customize them for your projects.
              </p>
              <div style={{ marginTop: 20, fontSize: 11, fontWeight: 600, color: "var(--overlay0)", padding: "6px 14px", borderRadius: 8, background: "var(--surface0)", display: "inline-block" }}>Coming soon</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
