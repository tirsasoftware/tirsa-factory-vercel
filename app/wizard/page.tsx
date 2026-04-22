"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Wand2 } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import { WizardSection } from "@/components/WizardSection";
import { useAuth } from "@/lib/auth-context";

export default function WizardPage() {
  const router = useRouter();
  const { session, tenantId, loading } = useAuth();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  function close() { router.back(); }

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "var(--font-sans)", color: "var(--text)", background: "var(--base)" }}>
      <AppSidebar active="wizard" />

      {/* Modal overlay */}
      <div
        onClick={close}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "24px",
        }}
      >
        {/* Dialog card */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%", maxWidth: 620,
            maxHeight: "calc(100vh - 80px)",
            background: "var(--base)",
            border: "1px solid var(--surface1)",
            borderRadius: 16,
            display: "flex", flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "16px 20px",
            borderBottom: "1px solid var(--surface0)",
            flexShrink: 0,
          }}>
            <Wand2 size={16} color="var(--overlay1)" />
            <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Wizard</span>
            <button
              onClick={close}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--overlay1)", display: "flex", padding: 4, borderRadius: 6 }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
            {loading ? (
              <div style={{ color: "var(--subtext0)", fontSize: 14 }}>Loading…</div>
            ) : !tenantId ? (
              <div style={{ color: "var(--subtext0)", fontSize: 14 }}>
                No tenant found. <a href="/onboard" style={{ color: "var(--blue)" }}>Set up your workspace first.</a>
              </div>
            ) : (
              <WizardSection tenantId={tenantId} collapsible={false} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
