"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserCircle2, Building2, Mail, ShieldCheck, Layers, Image, Save, Check } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

const ROLE_LABEL: Record<string, string> = {
  owner:  "Owner",
  admin:  "Admin",
  member: "Member",
};

const ROLE_COLOR: Record<string, { bg: string; color: string }> = {
  owner:  { bg: "rgba(20,99,255,0.12)",   color: "var(--blue)"  },
  admin:  { bg: "rgba(162,139,250,0.15)", color: "#a78bfa"      },
  member: { bg: "var(--surface1)",         color: "var(--overlay0)" },
};

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "14px 16px",
      background: "var(--mantle)",
      border: "1px solid var(--surface1)",
      borderRadius: 10,
    }}>
      <div style={{ color: "var(--overlay1)", marginTop: 1, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>{value}</div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { session, loading, tenantName, factoryName, factoryId, memberRole, factories, refreshFactories } = useAuth();

  const [avatarUrl, setAvatarUrl] = useState("");
  const [userAvatarUrl, setUserAvatarUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [userSaved, setUserSaved] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // Load current avatars
  useEffect(() => {
    const active = factories.find((f) => f.id === factoryId);
    setAvatarUrl(active?.avatar ?? "");
  }, [factories, factoryId]);

  useEffect(() => {
    const meta = session?.user?.user_metadata as Record<string, unknown> | undefined;
    setUserAvatarUrl((meta?.avatar_url as string) ?? "");
    setDisplayName((meta?.display_name as string) ?? "");
  }, [session]);

  async function saveDisplayName() {
    setNameSaving(true);
    await supabase.auth.updateUser({ data: { display_name: displayName.trim() || null } });
    setNameSaving(false);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  async function saveUserAvatar() {
    setUserSaving(true);
    await supabase.auth.updateUser({ data: { avatar_url: userAvatarUrl.trim() || null } });
    setUserSaving(false);
    setUserSaved(true);
    setTimeout(() => setUserSaved(false), 2000);
  }

  async function saveAvatar() {
    if (!factoryId) return;
    setSaving(true);
    await supabase.from("factories").update({ avatar: avatarUrl.trim() || null }).eq("id", factoryId);
    await refreshFactories();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const email = session?.user?.email ?? "—";
  const role  = memberRole ?? "member";
  const roleColors = ROLE_COLOR[role] ?? ROLE_COLOR.member;
  const activeFactory = factories.find((f) => f.id === factoryId);

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "var(--font-sans)", color: "var(--text)", background: "var(--base)" }}>
      <AppSidebar active="profile" />

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 24px 80px" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 32 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, flexShrink: 0,
              background: "linear-gradient(135deg, #1463ff, #00c2a8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden",
            }}>
              {userAvatarUrl ? (
                <img src={userAvatarUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover" }} />
              ) : (
                <UserCircle2 size={28} color="#fff" strokeWidth={1.5} />
              )}
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-heading)", marginBottom: 4 }}>Profile</h1>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                background: roleColors.bg, color: roleColors.color,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>
                {ROLE_LABEL[role] ?? role}
              </span>
            </div>
          </div>

          {loading ? (
            <div style={{ color: "var(--subtext0)", fontSize: 14 }}>Loading…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Field icon={<Mail size={15} />} label="Email" value={email} />

              {/* Display Name */}
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "14px 16px",
                background: "var(--mantle)",
                border: "1px solid var(--surface1)",
                borderRadius: 10,
              }}>
                <div style={{ color: "var(--overlay1)", marginTop: 1, flexShrink: 0 }}><UserCircle2 size={15} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Name</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      value={displayName}
                      onChange={(e) => { setDisplayName(e.target.value); setNameSaved(false); }}
                      placeholder="Your name"
                      style={{
                        flex: 1, padding: "7px 10px", borderRadius: 7,
                        background: "var(--surface0)", border: "1px solid var(--surface1)",
                        color: "var(--text)", fontSize: 13, outline: "none",
                        fontFamily: "var(--font-sans)",
                      }}
                    />
                    <button
                      onClick={saveDisplayName}
                      disabled={nameSaving}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "6px 12px", borderRadius: 7, border: "none",
                        background: nameSaved ? "rgba(28,191,107,0.12)" : "var(--blue)",
                        color: nameSaved ? "var(--green)" : "#fff",
                        fontSize: 11, fontWeight: 700, cursor: nameSaving ? "not-allowed" : "pointer",
                        fontFamily: "var(--font-sans)", flexShrink: 0,
                      }}
                    >
                      {nameSaved ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save</>}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--overlay0)", marginTop: 4 }}>
                    Displayed below the organization name in the sidebar.
                  </div>
                </div>
              </div>

              {/* User Avatar */}
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "14px 16px",
                background: "var(--mantle)",
                border: "1px solid var(--surface1)",
                borderRadius: 10,
              }}>
                <div style={{ color: "var(--overlay1)", marginTop: 1, flexShrink: 0 }}><UserCircle2 size={15} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Avatar</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {userAvatarUrl && (
                      <img src={userAvatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid var(--surface1)" }} />
                    )}
                    <input
                      value={userAvatarUrl}
                      onChange={(e) => { setUserAvatarUrl(e.target.value); setUserSaved(false); }}
                      placeholder="https://example.com/photo.jpg"
                      style={{
                        flex: 1, padding: "7px 10px", borderRadius: 7,
                        background: "var(--surface0)", border: "1px solid var(--surface1)",
                        color: "var(--text)", fontSize: 12, outline: "none",
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                    <button
                      onClick={saveUserAvatar}
                      disabled={userSaving}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "6px 12px", borderRadius: 7, border: "none",
                        background: userSaved ? "rgba(28,191,107,0.12)" : "var(--blue)",
                        color: userSaved ? "var(--green)" : "#fff",
                        fontSize: 11, fontWeight: 700, cursor: userSaving ? "not-allowed" : "pointer",
                        fontFamily: "var(--font-sans)", flexShrink: 0,
                      }}
                    >
                      {userSaved ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save</>}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--overlay0)", marginTop: 4 }}>
                    URL to your profile photo. Displayed in the sidebar.
                  </div>
                </div>
              </div>

              <Field icon={<Building2 size={15} />} label="Organization" value={tenantName ?? "—"} />
              <Field icon={<Layers size={15} />} label="Factory" value={factoryName ?? "—"} />
              <Field
                icon={<ShieldCheck size={15} />}
                label="Role"
                value={
                  <span style={{ fontSize: 13, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: roleColors.bg, color: roleColors.color }}>
                    {ROLE_LABEL[role] ?? role}
                  </span>
                }
              />

              {/* Avatar */}
              {factoryId && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "14px 16px",
                  background: "var(--mantle)",
                  border: "1px solid var(--surface1)",
                  borderRadius: 10,
                }}>
                  <div style={{ color: "var(--overlay1)", marginTop: 1, flexShrink: 0 }}><Image size={15} /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Factory Avatar</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {avatarUrl && (
                        <img src={avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", flexShrink: 0, border: "1px solid var(--surface1)" }} />
                      )}
                      <input
                        value={avatarUrl}
                        onChange={(e) => { setAvatarUrl(e.target.value); setSaved(false); }}
                        placeholder="https://example.com/logo.png"
                        style={{
                          flex: 1, padding: "7px 10px", borderRadius: 7,
                          background: "var(--surface0)", border: "1px solid var(--surface1)",
                          color: "var(--text)", fontSize: 12, outline: "none",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                      <button
                        onClick={saveAvatar}
                        disabled={saving}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          padding: "6px 12px", borderRadius: 7, border: "none",
                          background: saved ? "rgba(28,191,107,0.12)" : "var(--blue)",
                          color: saved ? "var(--green)" : "#fff",
                          fontSize: 11, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
                          fontFamily: "var(--font-sans)", flexShrink: 0,
                        }}
                      >
                        {saved ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save</>}
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--overlay0)", marginTop: 4 }}>
                      URL to a logo or favicon. Displayed in sidebar and browser tab.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
