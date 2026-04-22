"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { brand } from "@/lib/brand";
import { Mail, Lock, AlertCircle, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // If already authenticated, skip login.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
      else setChecking(false);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      router.replace("/");
    }
  }

  if (checking) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 40px 11px 14px",
    background: "var(--surface0)",
    border: "1px solid var(--surface1)",
    borderRadius: 8,
    color: "var(--text)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
    fontFamily: "var(--font-sans)",
  };

  return (
    <div style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "24px 16px",
      background: "linear-gradient(180deg, var(--base) 0%, var(--mantle) 100%)",
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>

        {/* Subtitle */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 14, color: "var(--subtext0)" }}>
            Sign in to your workspace
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: "var(--mantle)",
          border: "1px solid var(--surface0)",
          borderRadius: 16,
          padding: "32px 28px",
        }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Email */}
            <div style={{ position: "relative" }}>
              <Mail size={15} color="var(--overlay0)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input
                type="email"
                placeholder="admin@acme.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                style={{ ...inputStyle, paddingLeft: 38 }}
              />
            </div>

            {/* Password */}
            <div style={{ position: "relative" }}>
              <Lock size={15} color="var(--overlay0)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ ...inputStyle, paddingLeft: 38 }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 12px", borderRadius: 8,
                background: "rgba(237,67,55,0.1)",
                border: "1px solid rgba(237,67,55,0.25)",
                color: "#ed4337", fontSize: 13,
              }}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "12px 20px",
                background: loading ? "var(--surface1)" : "#1463ff",
                border: "none", borderRadius: 10,
                color: loading ? "var(--subtext0)" : "#fff",
                fontSize: 14, fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "all 0.15s",
                fontFamily: "var(--font-sans)",
              }}
            >
              {loading ? "Signing in…" : <>Sign in <ArrowRight size={15} /></>}
            </button>
          </form>
        </div>

        {/* Setup link */}
        <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: "var(--subtext0)" }}>
          New workspace?{" "}
          <a href="/onboard" style={{ color: "var(--blue)", textDecoration: "none", fontWeight: 500 }}>
            Set up your factory
          </a>
        </div>

        {/* Legal footer */}
        <div style={{ textAlign: "center", marginTop: 32, fontSize: 11, color: "var(--overlay0)", lineHeight: 1.6 }}>
          By signing in you agree to our{" "}
          <a href="/legal/tos" style={{ color: "var(--overlay1)", textDecoration: "underline" }}>Terms of Service</a>
          {" "}and{" "}
          <a href="/legal/privacy" style={{ color: "var(--overlay1)", textDecoration: "underline" }}>Privacy Policy</a>.
        </div>
      </div>
    </div>
  );
}
