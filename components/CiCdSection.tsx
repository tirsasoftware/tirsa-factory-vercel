"use client";

import React, { useState, useEffect } from "react";
import {
  Loader2, Copy, Check, RefreshCw, Terminal, CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { brand } from "@/lib/brand";

/* ─── CopyField ─────────────────────────────────────────────────────────────── */

export function CopyField({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: 1, padding: "9px 12px", borderRadius: 8, background: "var(--surface0)", border: "1px solid var(--surface1)", fontSize: 13, color: "var(--text)", fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)", userSelect: "all" }}>{value}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
        title="Copy"
        style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--surface1)", background: "var(--surface0)", cursor: "pointer", color: copied ? "var(--green)" : "var(--overlay0)", display: "flex", alignItems: "center", flexShrink: 0 }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

/* ─── CiCdSection ───────────────────────────────────────────────────────────── */

interface WorkspaceInfo {
  tenant:    { id: string; name: string; slug: string };
  factories: { id: string; name: string; slug: string }[];
}

export function CiCdSection({ tenantId }: { tenantId: string }) {
  const { session } = useAuth();
  const [ws,         setWs]         = useState<WorkspaceInfo | null>(null);
  const [keyExists,  setKeyExists]  = useState(false);
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const [newKey,     setNewKey]     = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied,     setCopied]     = useState(false);
  const [selectedFactory, setSelectedFactory] = useState<string>("");

  useEffect(() => {
    if (!session) return;
    const token = session.access_token;
    Promise.all([
      fetch(`/api/settings/workspace?tenantId=${tenantId}`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`/api/settings/apikey?tenantId=${tenantId}`,    { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(async ([wsRes, keyRes]) => {
      if (wsRes.ok) { const b = await wsRes.json() as WorkspaceInfo; setWs(b); if (b.factories[0]) setSelectedFactory(b.factories[0].slug); }
      if (keyRes.ok) { const b = await keyRes.json() as { exists: boolean; preview?: string }; setKeyExists(b.exists); setKeyPreview(b.preview ?? null); }
    });
  }, [tenantId, session]);

  async function generateKey() {
    if (!session) return;
    setGenerating(true);
    const res = await fetch("/api/settings/apikey", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ tenantId }) });
    setGenerating(false);
    if (res.ok) { const b = await res.json() as { key: string; preview: string }; setNewKey(b.key); setKeyPreview(b.preview); setKeyExists(true); }
  }

  const factorySlug = ws?.factories.find((f) => f.slug === selectedFactory)?.slug ?? selectedFactory;
  const tenantSlug  = ws?.tenant.slug ?? "";
  const snippet = [`TIRSA_TENANT=${tenantSlug}`, `TIRSA_FACTORY=${factorySlug}`, `TIRSA_API_KEY=${newKey ?? "<your-api-key>"}`].join("\n");

  if (!ws) return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--subtext0)", fontSize: 14 }}>
      <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--subtext0)", marginBottom: 28 }}>
        Use these environment variables in CI pipelines, GitHub Actions secrets, or any non-interactive context that calls the {brand.name} API.
      </p>
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--subtext1)", marginBottom: 6 }}>TIRSA_TENANT</label>
        <CopyField value={ws.tenant.slug} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--subtext1)", marginBottom: 6 }}>
          TIRSA_FACTORY
          {ws.factories.length > 1 && (
            <select
              value={selectedFactory}
              onChange={(e) => setSelectedFactory(e.target.value)}
              style={{ marginLeft: 12, padding: "2px 8px", borderRadius: 6, fontSize: 12, background: "var(--surface0)", border: "1px solid var(--surface1)", color: "var(--text)", fontFamily: "var(--font-sans)", cursor: "pointer" }}
            >
              {ws.factories.map((f) => <option key={f.id} value={f.slug}>{f.name}</option>)}
            </select>
          )}
        </label>
        <CopyField value={factorySlug} />
      </div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--subtext1)" }}>TIRSA_API_KEY</label>
          <button
            onClick={generateKey}
            disabled={generating}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 7, border: "1px solid var(--surface1)", background: "var(--surface0)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: generating ? 0.6 : 1 }}
          >
            <RefreshCw size={12} style={generating ? { animation: "spin 1s linear infinite" } : {}} />
            {keyExists ? "Regenerate" : "Generate key"}
          </button>
        </div>
        {newKey ? (
          <div>
            <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 8, background: "rgba(28,191,107,0.08)", border: "1px solid rgba(28,191,107,0.3)", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--green)" }}>
              <CheckCircle2 size={13} /> Copy this key now — it will not be shown again.
            </div>
            <CopyField value={newKey} />
          </div>
        ) : keyExists ? (
          <div style={{ padding: "9px 12px", borderRadius: 8, background: "var(--surface0)", border: "1px solid var(--surface1)", fontSize: 13, color: "var(--overlay0)", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>sk_live_••••••••••••••••••{keyPreview?.replace("…", "")}</span>
            <span style={{ fontSize: 11, color: "var(--overlay0)" }}>Regenerate to get a new value</span>
          </div>
        ) : (
          <div style={{ padding: "9px 12px", borderRadius: 8, background: "var(--surface0)", border: "1px solid var(--surface1)", fontSize: 13, color: "var(--overlay0)" }}>No key generated yet.</div>
        )}
      </div>
      <div style={{ background: "var(--crust)", border: "1px solid var(--surface0)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--surface0)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--overlay0)" }}><Terminal size={13} /> .env / CI secrets</div>
          <button
            onClick={() => { navigator.clipboard.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }); }}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--surface1)", background: "transparent", color: copied ? "var(--green)" : "var(--overlay0)", fontSize: 11, cursor: "pointer" }}
          >
            {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy all</>}
          </button>
        </div>
        <pre style={{ margin: 0, padding: "16px", fontSize: 13, lineHeight: 1.7, fontFamily: "var(--font-mono)", color: "var(--text)", overflowX: "auto" }}>
          {[
            { k: "TIRSA_TENANT",  v: tenantSlug  },
            { k: "TIRSA_FACTORY", v: factorySlug },
            { k: "TIRSA_API_KEY", v: newKey ?? "<your-api-key>" },
          ].map(({ k, v }) => (
            <span key={k}><span style={{ color: "#00c2a8" }}>{k}</span><span style={{ color: "var(--overlay0)" }}>=</span><span style={{ color: "#a78bfa" }}>{v}</span>{"\n"}</span>
          ))}
        </pre>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
