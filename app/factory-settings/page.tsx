"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Check, AlertCircle, Trash2, Pencil,
  ToggleLeft, ToggleRight, Star, Factory as FactoryIcon,
  ChevronRight, ChevronDown, Puzzle, Store, Info,
} from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import { useAuth } from "@/lib/auth-context";
import type { FactoryInfo } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { brand } from "@/lib/brand";

const ORIGIN_LABEL: Record<string, { label: string; color: string }> = {
  tirsa:     { label: brand.name,       color: "#1463ff" },
  community: { label: "Community",      color: "#10b981" },
  paid:      { label: "Paid",           color: "#f59e0b" },
  custom:    { label: "My Org",         color: "#a78bfa" },
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 14px", borderRadius: 8,
  background: "var(--surface0)", border: "1px solid var(--surface1)",
  color: "var(--text)", fontSize: 13, outline: "none",
  fontFamily: "var(--font-sans)", boxSizing: "border-box" as const,
};

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

type ManagerTab = "factories" | "extensions";

export default function FactoryManagerPage() {
  const router = useRouter();
  const { session, loading: authLoading, tenantId, factories, factoryId, setActiveFactory, refreshFactories } = useAuth();

  const [tab, setTab] = useState<ManagerTab>("factories");
  const [showNewFactory, setShowNewFactory]       = useState(false);
  const [showNewExtension, setShowNewExtension]   = useState(false);
  const [newForm, setNewForm]       = useState({ name: "", slug: "", extendsId: "", inheritsId: "" });
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editForm, setEditForm]     = useState({ name: "", slug: "", avatar: "", maxConcurrentProjects: 1 });
  const [message, setMessage]       = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [expandedFactory, setExpandedFactory] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [authLoading, session, router]);


  const myFactories = factories.filter((f) => (f.type ?? "factory") === "factory");
  const myExtensions = factories.filter((f) => f.type === "extension");

  const refreshAll = useCallback(async () => { await refreshFactories(); }, [refreshFactories]);
  useEffect(() => { if (tenantId) refreshAll(); }, [tenantId, refreshAll]);

  const isFirstTime = !authLoading && session && tenantId && factories.length === 0;

  function canDelete(f: FactoryInfo): boolean {
    // Marketplace-installed (has listing_id) tirsa/paid cannot be deleted, only disabled.
    // Everything else (custom, community, pre-migration) is deletable.
    if (f.listing_id && (f.origin === "tirsa" || f.origin === "paid")) return false;
    return true;
  }

  function getExtensionsFor(factoryId: string): FactoryInfo[] {
    return myExtensions.filter((e) => e.extends_factory_id === factoryId);
  }

  async function createFactory() {
    if (!newForm.name.trim() || !newForm.slug.trim()) { setFormError("Name and slug are required."); return; }
    if (!tenantId) return;
    setSaving(true); setFormError(null);

    const { data, error } = await supabase.from("factories")
      .insert({
        tenant_id: tenantId, name: newForm.name.trim(), slug: newForm.slug.trim(),
        category: newForm.slug.trim(),
        origin: "custom", type: "factory", enabled: true,
        config: { max_concurrent_projects: 3, default_provider: "anthropic", default_model: "claude-sonnet-4-6" },
      })
      .select("id").single();
    setSaving(false);
    if (error) { setFormError(error.message); return; }
    // Create inheritance if selected
    if (newForm.inheritsId && data) {
      await supabase.from("factory_inheritance").insert({ factory_id: data.id, inherits_id: newForm.inheritsId });
    }
    if (factories.length === 0 && data) setActiveFactory(data.id);
    await refreshFactories();
    setShowNewFactory(false);
    setNewForm({ name: "", slug: "", extendsId: "", inheritsId: "" });
    showMsg("success", "Factory created.");
  }

  async function createExtension() {
    if (!newForm.name.trim() || !newForm.slug.trim()) { setFormError("Name and slug are required."); return; }
    if (!newForm.extendsId) { setFormError("Select a factory to extend."); return; }
    if (!tenantId) return;
    setSaving(true); setFormError(null);
    const parent = factories.find((f) => f.id === newForm.extendsId);
    const { error } = await supabase.from("factories")
      .insert({
        tenant_id: tenantId, name: newForm.name.trim(), slug: newForm.slug.trim(),
        category: parent?.category ?? "custom", origin: "custom", type: "extension",
        extends_factory_id: newForm.extendsId, enabled: true, config: {},
      });
    setSaving(false);
    if (error) { setFormError(error.message); return; }
    await refreshFactories();
    setShowNewExtension(false);
    setNewForm({ name: "", slug: "", extendsId: "", inheritsId: "" });
    showMsg("success", "Extension created.");
  }

  async function toggleFactory(f: FactoryInfo) {
    await supabase.from("factories").update({ enabled: !f.enabled }).eq("id", f.id);
    await refreshFactories();
    showMsg("success", `"${f.name}" ${!f.enabled ? "enabled" : "disabled"}.`);
  }

  async function updateFactory(id: string) {
    if (!editForm.name.trim()) { setFormError("Name is required."); return; }
    const max = Math.round(editForm.maxConcurrentProjects);
    if (!Number.isFinite(max) || max < 1 || max > 10) {
      setFormError("Max concurrent projects must be between 1 and 10."); return;
    }
    setSaving(true); setFormError(null);

    // Merge into existing config so we don't drop other keys (default_provider, etc).
    const { data: existing } = await supabase.from("factories")
      .select("config").eq("id", id).single();
    const prevConfig = (existing?.config as Record<string, unknown> | null) ?? {};
    const nextConfig = { ...prevConfig, max_concurrent_projects: max };

    const { error } = await supabase.from("factories")
      .update({
        name:   editForm.name.trim(),
        slug:   editForm.slug.trim(),
        avatar: editForm.avatar.trim() || null,
        config: nextConfig,
      })
      .eq("id", id);
    setSaving(false);
    if (error) { setFormError(error.message); return; }
    await refreshFactories();
    setEditingId(null);
    showMsg("success", "Updated.");
  }

  async function openEdit(f: FactoryInfo) {
    const { data } = await supabase.from("factories")
      .select("config").eq("id", f.id).maybeSingle();
    const cfg = (data?.config as Record<string, unknown> | null) ?? {};
    const max = Number(cfg.max_concurrent_projects);
    setEditForm({
      name: f.name,
      slug: f.slug,
      avatar: f.avatar ?? "",
      maxConcurrentProjects: Number.isFinite(max) && max >= 1 ? max : 1,
    });
    setEditingId(f.id);
    setFormError(null);
  }

  async function deleteFactory(f: FactoryInfo) {
    if (!canDelete(f)) { showMsg("error", `"${f.name}" cannot be deleted — only disabled.`); return; }
    const { data: projects } = await supabase.from("projects").select("id").eq("factory_id", f.id).limit(1);
    if (projects && projects.length > 0) { showMsg("error", `Cannot delete "${f.name}" — it has projects.`); return; }
    if (!confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("factories").delete().eq("id", f.id);
    if (error) { showMsg("error", `Delete failed: ${error.message}`); return; }
    // If deleted factory was active, set to none
    if (f.id === factoryId && tenantId) {
      try { localStorage.setItem(`tirsa_active_factory_${tenantId}`, "__none__"); } catch { /* noop */ }
    }
    await refreshFactories();
    showMsg("success", "Deleted.");
  }

  function makeActive(f: FactoryInfo) {
    setActiveFactory(f.id);
    showMsg("success", `"${f.name}" is now active.`);
  }

  function showMsg(type: "success" | "error", text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  }

  /* ── Inline extension row (inside factory card) ── */
  function ExtensionRow({ ext }: { ext: FactoryInfo }) {
    const origin = ORIGIN_LABEL[ext.origin ?? "custom"] ?? ORIGIN_LABEL.custom;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--surface0)" }}>
        <Puzzle size={12} color="#a78bfa" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1 }}>{ext.name}</span>
        {ext.origin !== "custom" && <span title={`Origin: ${origin.label}`} style={{ display: "inline-flex", alignItems: "center", cursor: "help", color: origin.color }}><Info size={12} /></span>}
        <button onClick={() => toggleFactory(ext)} style={{ background: "none", border: "none", cursor: "pointer", color: ext.enabled ? "var(--green)" : "var(--overlay0)", padding: 2, display: "flex" }}>
          {ext.enabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
        </button>
        {canDelete(ext) && (
          <button onClick={() => deleteFactory(ext)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", padding: 2, display: "flex", opacity: 0.5 }}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
    );
  }

  /* ── Factory card renderer (not a component — avoids remount on state change) ── */
  function renderFactoryCard(f: FactoryInfo) {
    const isActive = f.id === factoryId;
    const isEditing = editingId === f.id;
    const origin = ORIGIN_LABEL[f.origin ?? "custom"] ?? ORIGIN_LABEL.custom;
    const deletable = canDelete(f);
    const extensions = getExtensionsFor(f.id);
    const isExpanded = expandedFactory === f.id;

    return (
      <div style={{
        marginBottom: 8, borderRadius: 12, overflow: "hidden",
        border: `1.5px solid ${isActive ? "rgba(20,99,255,0.4)" : f.enabled ? "var(--surface1)" : "var(--surface0)"}`,
        background: isActive ? "rgba(20,99,255,0.04)" : f.enabled ? "var(--mantle)" : "var(--crust)",
        opacity: f.enabled ? 1 : 0.6,
      }}>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          {isEditing ? (
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <input value={editForm.name} onChange={(e) => { const v = e.target.value; setEditForm((f) => ({ ...f, name: v, slug: slugify(v) })); }} placeholder="Name" style={{ ...inputStyle, flex: 1 }} />
                <input value={editForm.slug} onChange={(e) => { const v = e.target.value; setEditForm((f) => ({ ...f, slug: slugify(v) })); }} placeholder="slug" style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-mono)", fontSize: 11 }} />
              </div>
              <div style={{ marginBottom: 8 }}>
                <input value={editForm.avatar} onChange={(e) => setEditForm({ ...editForm, avatar: e.target.value })} placeholder="Avatar URL (optional)" style={{ ...inputStyle, fontSize: 11 }} />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--subtext0)", marginBottom: 4, fontFamily: "var(--font-sans)" }}>
                  Max concurrent projects
                  <span style={{ fontWeight: 400, marginLeft: 6, color: "var(--overlay0)" }}>
                    how many projects in this factory may run sprints in parallel
                  </span>
                </label>
                <input
                  type="number" min={1} max={10} step={1}
                  value={editForm.maxConcurrentProjects}
                  onChange={(e) => setEditForm({ ...editForm, maxConcurrentProjects: Number(e.target.value) || 1 })}
                  style={{ ...inputStyle, width: 120, fontSize: 12, fontFamily: "var(--font-mono)" }}
                />
              </div>
              {formError && editingId === f.id && <div style={{ color: "var(--red)", fontSize: 11, marginBottom: 6 }}>{formError}</div>}
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => updateFactory(f.id)} disabled={saving} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#1463ff", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Save</button>
                <button onClick={() => { setEditingId(null); setFormError(null); }} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--surface1)", background: "transparent", color: "var(--subtext0)", fontSize: 11, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {f.avatar && <img src={f.avatar} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: f.enabled ? "var(--text)" : "var(--overlay0)" }}>{f.name}</span>
                  {f.origin !== "custom" && <span title={`Origin: ${origin.label}`} style={{ display: "inline-flex", alignItems: "center", cursor: "help", color: origin.color }}><Info size={13} /></span>}
                </div>
                <div style={{ fontSize: 10, color: "var(--overlay0)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{f.slug}</div>
                {f.inherits && f.inherits.length > 0 && (
                  <div style={{ fontSize: 10, color: "var(--subtext0)", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                    inherits: {f.inherits.map((pid) => { const p = factories.find((ff) => ff.id === pid); return p?.name ?? pid.slice(0, 8); }).join(", ")}
                  </div>
                )}
              </div>
              {isActive && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--blue)", display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}><Star size={11} /> Active</span>}
              {!isActive && f.enabled && <button onClick={() => makeActive(f)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--surface1)", background: "transparent", color: "var(--subtext0)", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", flexShrink: 0 }}>Set active</button>}
              <button onClick={() => toggleFactory(f)} title={f.enabled ? "Disable" : "Enable"} style={{ background: "none", border: "none", cursor: "pointer", color: f.enabled ? "var(--green)" : "var(--overlay0)", padding: 4, display: "flex", flexShrink: 0 }}>
                {f.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              </button>
              <button onClick={() => { void openEdit(f); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--overlay0)", padding: 4, display: "flex", flexShrink: 0 }}><Pencil size={13} /></button>
              {deletable ? (
                <button onClick={() => deleteFactory(f)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", padding: 4, display: "flex", opacity: 0.6, flexShrink: 0 }}><Trash2 size={13} /></button>
              ) : <div style={{ width: 21, flexShrink: 0 }} />}
            </>
          )}
        </div>

        {/* Collapsible extensions section */}
        {!isEditing && (
          <div style={{ borderTop: "1px solid var(--surface0)" }}>
            <button onClick={() => setExpandedFactory(isExpanded ? null : f.id)} style={{
              display: "flex", alignItems: "center", gap: 6, width: "100%",
              padding: "8px 16px", background: "none", border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 600, color: "var(--overlay0)",
              fontFamily: "var(--font-sans)", textAlign: "left",
            }}>
              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <Puzzle size={11} /> Extensions ({extensions.length})
              {!isExpanded && extensions.length > 0 && (
                <span style={{ fontSize: 10, color: "var(--subtext0)", marginLeft: 4 }}>
                  {extensions.filter((e) => e.enabled).length} active
                </span>
              )}
            </button>
            {isExpanded && (
              <div style={{ padding: "0 16px 12px" }}>
                {extensions.length === 0 ? (
                  <div style={{ fontSize: 11, color: "var(--overlay0)", padding: "8px 0" }}>No extensions attached.</div>
                ) : (
                  extensions.map((ext) => <ExtensionRow key={ext.id} ext={ext} />)
                )}
                <button onClick={() => { setShowNewExtension(true); setNewForm({ ...newForm, extendsId: f.id }); setFormError(null); setTab("factories"); }}
                  style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "1px dashed var(--surface1)", background: "transparent", color: "var(--subtext0)", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
                  <Plus size={10} /> Add extension
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 20px", borderRadius: 8, border: "none",
    background: active ? "var(--surface0)" : "transparent",
    color: active ? "var(--text)" : "var(--overlay0)",
    fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer",
    fontFamily: "var(--font-sans)",
  });

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "var(--font-sans)", color: "var(--text)", background: "var(--base)" }}>
      <AppSidebar active="factory-settings" />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 80px" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: "linear-gradient(135deg, #1463ff, #0f4ed0)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <FactoryIcon size={24} color="#fff" strokeWidth={1.5} />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-heading)", marginBottom: 2 }}>Factory Manager</h1>
              <p style={{ fontSize: 13, color: "var(--subtext0)", margin: 0 }}>Manage factories and extensions. Edit components in Studio.</p>
            </div>
          </div>

          {/* No factory selected — neon alert */}
          {!factoryId && !isFirstTime && (
            <div style={{
              margin: "20px 0", padding: "14px 18px", borderRadius: 10,
              background: "rgba(245,159,0,0.05)",
              border: "1px solid rgba(245,159,0,0.25)",
              boxShadow: "0 0 16px rgba(245,159,0,0.08), inset 0 0 10px rgba(245,159,0,0.03)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: "#f59f00",
                boxShadow: "0 0 6px 2px rgba(245,159,0,0.5), 0 0 14px 4px rgba(245,159,0,0.2)",
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#f5c542" }}>
                No factory selected. Enable or install a factory to access Studio and Office.
              </span>
            </div>
          )}

          {/* First-time banner */}
          {isFirstTime && (
            <div style={{
              margin: "20px 0", padding: "18px 20px", borderRadius: 10,
              background: "rgba(20,99,255,0.04)",
              border: "1px solid rgba(20,99,255,0.2)",
              boxShadow: "0 0 16px rgba(20,99,255,0.08), inset 0 0 10px rgba(20,99,255,0.03)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: "#1463ff",
                boxShadow: "0 0 6px 2px rgba(20,99,255,0.5), 0 0 14px 4px rgba(20,99,255,0.2)",
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#5b9aff" }}>
                Welcome! Install a factory from the <a href="/marketplace" style={{ color: "#7db5ff", textDecoration: "underline" }}>Marketplace</a> or create a custom one below.
              </span>
            </div>
          )}

          {/* Message */}
          {message && (
            <div style={{ margin: "16px 0", padding: "10px 16px", borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 8, background: message.type === "success" ? "rgba(28,191,107,0.08)" : "rgba(228,75,95,0.08)", border: `1px solid ${message.type === "success" ? "rgba(28,191,107,0.3)" : "rgba(228,75,95,0.3)"}`, color: message.type === "success" ? "var(--green)" : "var(--red)" }}>
              {message.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />} {message.text}
            </div>
          )}

          {/* Quick links */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 20 }}>
            <a href="/marketplace" style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 16px", borderRadius: 8, background: "linear-gradient(135deg, #1463ff 0%, #0f4ed0 100%)", color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none", fontFamily: "var(--font-sans)" }}>
              <Store size={13} /> Go to Marketplace
            </a>
            {factoryId && (
              <a href="/studio" style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 16px", borderRadius: 8, border: "1px solid var(--surface1)", background: "transparent", color: "var(--subtext1)", fontSize: 12, fontWeight: 700, textDecoration: "none", fontFamily: "var(--font-sans)" }}>
                Go to Studio
              </a>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--surface0)", marginBottom: 20 }}>
            {([
              { id: "factories" as ManagerTab, label: `My Factories (${myFactories.length})` },
              { id: "extensions" as ManagerTab, label: `Extensions Catalog (${myExtensions.length})` },
            ]).map((t) => {
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: "10px 20px", border: "none",
                  background: "transparent",
                  color: active ? "var(--text)" : "var(--overlay0)",
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  cursor: "pointer", fontFamily: "var(--font-sans)",
                  borderBottom: active ? "2px solid var(--blue)" : "2px solid transparent",
                  marginBottom: -1,
                }}>
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* ── My Factories tab ── */}
          {tab === "factories" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 12 }}>
                <button onClick={() => { setShowNewFactory(true); setShowNewExtension(false); setFormError(null); }} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "5px 14px", borderRadius: 7, border: "none",
                  background: "linear-gradient(135deg, #1463ff 0%, #0f4ed0 100%)", color: "#fff",
                  fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)",
                }}>
                  <Plus size={12} /> New Factory
                </button>
              </div>

              {showNewFactory && (
                <div style={{ marginBottom: 12, padding: "16px", borderRadius: 10, background: "var(--mantle)", border: "1px solid var(--surface0)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>New Custom Factory</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <input value={newForm.name} onChange={(e) => { const v = e.target.value; setNewForm((f) => ({ ...f, name: v, slug: slugify(v) })); }} placeholder="Name" style={inputStyle} />
                    <input value={newForm.slug} onChange={(e) => { const v = e.target.value; setNewForm((f) => ({ ...f, slug: slugify(v) })); }} placeholder="slug" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--subtext0)", marginBottom: 4 }}>Inherits from <span style={{ fontWeight: 400, color: "var(--overlay0)" }}>(optional)</span></label>
                    <select value={newForm.inheritsId} onChange={(e) => setNewForm({ ...newForm, inheritsId: e.target.value })} style={{ ...inputStyle, cursor: "pointer" }}>
                      <option value="">None — blank factory</option>
                      {myFactories.filter((f) => f.id !== factoryId).map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                  {formError && <div style={{ color: "var(--red)", fontSize: 11, marginBottom: 8 }}>{formError}</div>}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={createFactory} disabled={saving} style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: "#1463ff", color: "#fff", fontSize: 11, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: "var(--font-sans)" }}>{saving ? "Creating…" : "Create"}</button>
                    <button onClick={() => setShowNewFactory(false)} style={{ padding: "6px 16px", borderRadius: 7, border: "1px solid var(--surface1)", background: "transparent", color: "var(--subtext0)", fontSize: 11, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* New extension form (triggered from inside a factory card) */}
              {showNewExtension && tab === "factories" && (
                <div style={{ marginBottom: 12, padding: "16px", borderRadius: 10, background: "var(--mantle)", border: "1px solid rgba(167,139,250,0.2)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Puzzle size={14} color="#a78bfa" /> New Extension for {factories.find((f) => f.id === newForm.extendsId)?.name ?? "…"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <input value={newForm.name} onChange={(e) => { const v = e.target.value; setNewForm((f) => ({ ...f, name: v, slug: slugify(v) })); }} placeholder="Extension name" style={inputStyle} />
                    <input value={newForm.slug} onChange={(e) => setNewForm({ ...newForm, slug: slugify(e.target.value) })} placeholder="slug" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                  </div>
                  <p style={{ fontSize: 11, color: "var(--subtext0)", marginBottom: 10, lineHeight: 1.5 }}>
                    Extensions add custom squads and agents. Edit them in Studio.
                  </p>
                  {formError && <div style={{ color: "var(--red)", fontSize: 11, marginBottom: 8 }}>{formError}</div>}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={createExtension} disabled={saving} style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: "#6d28d9", color: "#fff", fontSize: 11, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: "var(--font-sans)" }}>{saving ? "Creating…" : "Create"}</button>
                    <button onClick={() => setShowNewExtension(false)} style={{ padding: "6px 16px", borderRadius: 7, border: "1px solid var(--surface1)", background: "transparent", color: "var(--subtext0)", fontSize: 11, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Cancel</button>
                  </div>
                </div>
              )}

              {myFactories.length === 0 && !showNewFactory && (
                <div style={{ textAlign: "center", padding: "36px 16px", color: "var(--overlay0)", fontSize: 13 }}>
                  No factories yet. Install one from the <a href="/marketplace" style={{ color: "var(--blue)", textDecoration: "none" }}>Marketplace</a> or create a custom factory.
                </div>
              )}

              {myFactories.map((f) => <React.Fragment key={f.id}>{renderFactoryCard(f)}</React.Fragment>)}
            </div>
          )}

          {/* ── Extensions Catalog tab ── */}
          {tab === "extensions" && (
            <div>
              <p style={{ fontSize: 13, color: "var(--subtext0)", marginBottom: 16 }}>
                All extensions across your factories. Each extension adds custom squads and agents to its parent factory.
              </p>

              {myExtensions.length === 0 ? (
                <div style={{ textAlign: "center", padding: "36px 16px", color: "var(--overlay0)" }}>
                  <Puzzle size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                  <div style={{ fontSize: 13 }}>No extensions yet. Add one from a factory&apos;s Extensions section.</div>
                </div>
              ) : (
                myExtensions.map((ext) => {
                  const parent = myFactories.find((f) => f.id === ext.extends_factory_id);
                  const origin = ORIGIN_LABEL[ext.origin ?? "custom"] ?? ORIGIN_LABEL.custom;
                  return (
                    <div key={ext.id} style={{
                      marginBottom: 6, borderRadius: 10, padding: "12px 16px",
                      border: `1.5px solid ${ext.enabled ? "rgba(167,139,250,0.2)" : "var(--surface0)"}`,
                      background: ext.enabled ? "rgba(167,139,250,0.03)" : "var(--crust)",
                      opacity: ext.enabled ? 1 : 0.6,
                      display: "flex", alignItems: "center", gap: 10,
                    }}>
                      <Puzzle size={16} color="#a78bfa" style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{ext.name}</span>
                          {ext.origin !== "custom" && <span title={`Origin: ${origin.label}`} style={{ display: "inline-flex", alignItems: "center", cursor: "help", color: origin.color }}><Info size={12} /></span>}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--overlay0)", marginTop: 2 }}>
                          <span style={{ fontFamily: "var(--font-mono)" }}>{ext.slug}</span>
                          {parent && <> · extends <strong style={{ color: "var(--subtext0)" }}>{parent.name}</strong></>}
                        </div>
                      </div>
                      <button onClick={() => toggleFactory(ext)} style={{ background: "none", border: "none", cursor: "pointer", color: ext.enabled ? "var(--green)" : "var(--overlay0)", padding: 4, display: "flex", flexShrink: 0 }}>
                        {ext.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>
                      {canDelete(ext) && (
                        <button onClick={() => deleteFactory(ext)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", padding: 4, display: "flex", opacity: 0.6, flexShrink: 0 }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
