"use client";

import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Copy, Check, Trash2, ToggleLeft, ToggleRight, Plus, Ticket } from "lucide-react";

interface InviteCode {
  id: string;
  code: string;
  email: string;
  plan: string;
  max_uses: number;
  used_count: number;
  expires_at: string;
  created_at: string;
  active: boolean;
}

const PLAN_COLOR: Record<string, string> = {
  starter: "#6b7a9e",
  pro: "#1463ff",
  enterprise: "#00c2a8",
};

async function fetchWithAuth(url: string, token: string, opts?: RequestInit) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(body.error ?? "Request failed");
  }
  return res.json();
}

function getStatus(code: InviteCode): { label: string; color: string } {
  if (!code.active) return { label: "Inactive", color: "var(--overlay0)" };
  if (new Date(code.expires_at) < new Date()) return { label: "Expired", color: "var(--red)" };
  if (code.used_count >= code.max_uses) return { label: "Depleted", color: "var(--yellow)" };
  return { label: "Active", color: "var(--green)" };
}

export default function AdminInvitesPage() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Generate form state
  const [plan, setPlan] = useState<"starter" | "pro" | "enterprise">("starter");
  const [inviteEmail, setInviteEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [maxUses, setMaxUses] = useState(1);

  const loadCodes = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const body = (await fetchWithAuth("/api/admin/invites", session.access_token)) as { codes: InviteCode[] };
      setCodes(body.codes);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCodes(); }, [loadCodes]);

  async function handleGenerate() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setGenerating(true);
    setError(null);
    setGeneratedCode(null);
    try {
      const body = (await fetchWithAuth("/api/admin/invites", session.access_token, {
        method: "POST",
        body: JSON.stringify({ plan, email: inviteEmail.trim(), expiresInDays, maxUses }),
      })) as { code: { code: string } };
      setGeneratedCode(body.code.code);
      await loadCodes();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleToggle(id: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      await fetchWithAuth(`/api/admin/invites/${id}`, session.access_token, { method: "PATCH" });
      await loadCodes();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this invite code?")) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      await fetchWithAuth(`/api/admin/invites/${id}`, session.access_token, { method: "DELETE" });
      await loadCodes();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  const thStyle: React.CSSProperties = {
    padding: "10px 18px", textAlign: "left", fontSize: 11,
    fontWeight: 700, color: "var(--overlay0)", textTransform: "uppercase",
    letterSpacing: "0.06em", whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = { padding: "12px 18px", fontSize: 13 };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 28px 80px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--font-heading)", marginBottom: 4 }}>Invite Codes</h1>
        <p style={{ fontSize: 14, color: "var(--subtext0)" }}>Generate and manage invite codes for plan access</p>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(228,75,95,0.1)", border: "1px solid rgba(228,75,95,0.3)", color: "var(--red)", fontSize: 13, marginBottom: 24 }}>
          {error}
        </div>
      )}

      {/* Generate section */}
      <div style={{ background: "var(--mantle)", border: "1px solid var(--surface0)", borderRadius: 14, padding: "24px 24px", marginBottom: 28 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={16} /> Generate Code
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 16, alignItems: "end" }}>
          {/* Plan */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--subtext0)", marginBottom: 6 }}>Plan</label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["starter", "pro", "enterprise"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlan(p)}
                  style={{
                    padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: `1.5px solid ${plan === p ? PLAN_COLOR[p] : "var(--surface1)"}`,
                    background: plan === p ? `${PLAN_COLOR[p]}18` : "transparent",
                    color: plan === p ? PLAN_COLOR[p] : "var(--subtext0)",
                    cursor: "pointer", textTransform: "capitalize",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Email */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--subtext0)", marginBottom: 6 }}>Invite email</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                background: "var(--surface0)", border: "1px solid var(--surface1)",
                color: "var(--text)", fontSize: 13, outline: "none",
                fontFamily: "var(--font-sans)", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Expiration */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--subtext0)", marginBottom: 6 }}>Expires in (days)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value) || 90)}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                background: "var(--surface0)", border: "1px solid var(--surface1)",
                color: "var(--text)", fontSize: 13, outline: "none",
                fontFamily: "var(--font-sans)",
              }}
            />
          </div>

          {/* Max uses */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--subtext0)", marginBottom: 6 }}>Max uses</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value) || 1)}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                background: "var(--surface0)", border: "1px solid var(--surface1)",
                color: "var(--text)", fontSize: 13, outline: "none",
                fontFamily: "var(--font-sans)",
              }}
            />
          </div>

          {/* Button */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding: "9px 20px", borderRadius: 9, border: "none",
              background: generating ? "var(--surface1)" : "linear-gradient(135deg, #1463ff 0%, #0f4ed0 100%)",
              color: generating ? "var(--overlay0)" : "#fff",
              fontSize: 13, fontWeight: 700, cursor: generating ? "not-allowed" : "pointer",
              whiteSpace: "nowrap", fontFamily: "var(--font-sans)",
            }}
          >
            {generating ? "Generating..." : "Generate Code"}
          </button>
        </div>

        {/* Generated code display */}
        {generatedCode && (
          <div style={{
            marginTop: 20, padding: "16px 20px", borderRadius: 10,
            background: "rgba(28,191,107,0.08)", border: "1px solid rgba(28,191,107,0.3)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--green)", marginBottom: 4 }}>Code generated</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--text)", letterSpacing: "0.06em" }}>
                {generatedCode}
              </div>
            </div>
            <button
              onClick={() => copyCode(generatedCode)}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(28,191,107,0.3)",
                background: "rgba(28,191,107,0.1)", color: "var(--green)",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {copied === generatedCode ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
            </button>
          </div>
        )}
      </div>

      {/* Codes table */}
      <div style={{ background: "var(--mantle)", border: "1px solid var(--surface0)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--surface0)", display: "flex", alignItems: "center", gap: 8 }}>
          <Ticket size={15} color="var(--overlay1)" />
          <span style={{ fontSize: 14, fontWeight: 700 }}>All Codes</span>
          <span style={{ fontSize: 12, color: "var(--overlay0)", marginLeft: 4 }}>{codes.length} total</span>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--surface0)" }}>
              {["Code", "Email", "Plan", "Uses", "Expires", "Created", "Status", "Actions"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ padding: "32px 20px", textAlign: "center", color: "var(--overlay0)", fontSize: 13 }}>Loading...</td></tr>
            )}
            {!loading && codes.length === 0 && (
              <tr><td colSpan={7} style={{ padding: "32px 20px", textAlign: "center", color: "var(--overlay0)", fontSize: 13 }}>No invite codes yet. Generate one above.</td></tr>
            )}
            {codes.map((c) => {
              const status = getStatus(c);
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--surface0)" }}>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <code style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, letterSpacing: "0.04em" }}>{c.code}</code>
                      <button
                        onClick={() => copyCode(c.code)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--overlay0)", padding: 2, display: "flex" }}
                      >
                        {copied === c.code ? <Check size={12} color="var(--green)" /> : <Copy size={12} />}
                      </button>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "var(--subtext0)" }}>
                    {c.email ?? "—"}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99,
                      background: `${PLAN_COLOR[c.plan] ?? "#6b7a9e"}18`,
                      color: PLAN_COLOR[c.plan] ?? "#6b7a9e",
                      textTransform: "uppercase",
                    }}>
                      {c.plan}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "var(--subtext0)" }}>
                    {c.used_count} / {c.max_uses}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: new Date(c.expires_at) < new Date() ? "var(--red)" : "var(--subtext0)" }}>
                    {new Date(c.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "var(--overlay0)" }}>
                    {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99,
                      background: `${status.color}18`, color: status.color,
                    }}>
                      {status.label}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        onClick={() => handleToggle(c.id)}
                        title={c.active ? "Deactivate" : "Activate"}
                        style={{ background: "none", border: "none", cursor: "pointer", color: c.active ? "var(--green)" : "var(--overlay0)", padding: 4, display: "flex" }}
                      >
                        {c.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        title="Delete"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", padding: 4, display: "flex", opacity: 0.7 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
