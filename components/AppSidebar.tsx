"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NotificationBell from "./NotificationBell";
import {
  LayoutDashboard,
  Layers,
  Cpu,
  Dna,
  LogOut,
  Plug2,
  HardDrive,
  ChevronDown,
  ChevronRight,
  Wand2,
  GitBranch,
  ShieldCheck,
  Terminal,
  Bell,
  Workflow,
  Brain,
  Factory as FactoryIcon,
  Store,
  HelpCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useIntegrationStatus } from "@/lib/use-integration-status";
import { brand } from "@/lib/brand";

export type AppSection =
  | "command-center"
  | "studio"
  | "projects"
  | "providers"
  | "storage"
  | "orchestration"
  | "notifications"
  | "dna"
  | "wizard"
  | "cicd"
  | "knowledge"
  | "mcp-servers"
  | "agents"
  | "admin-access"
  | "settings"
  | "factory-settings"
  | "marketplace"
  | "help"
  | "profile";

interface NavItem {
  id: AppSection;
  label: string;
  icon: React.FC<{ size?: number; strokeWidth?: number }>;
  href: string;
  group: "factory" | "org" | "config" | "marketplace" | "help" | "admin";
}

const NAV: NavItem[] = [
  { id: "dna",              label: "DNA",         icon: Dna,             href: "/dna",               group: "factory"     },
  { id: "studio",           label: "Studio",      icon: Layers,          href: "/studio",            group: "factory"     },
  { id: "command-center",   label: "Office",      icon: LayoutDashboard, href: "/",                  group: "factory"     },
  { id: "factory-settings", label: "Factory Manager", icon: FactoryIcon,  href: "/factory-settings",  group: "org"         },
  { id: "wizard",           label: "Wizard",      icon: Wand2,           href: "/wizard",            group: "config"      },
  { id: "cicd",             label: "CI/CD",       icon: GitBranch,       href: "/cicd",              group: "config"      },
  { id: "marketplace",      label: "Marketplace", icon: Store,           href: "/marketplace",       group: "marketplace" },
  { id: "help",             label: "User Guides", icon: HelpCircle,      href: "/help",              group: "help"        },
  { id: "admin-access",     label: "Access",      icon: ShieldCheck,     href: "/admin",             group: "admin"       },
];

const GROUP_LABELS: Record<string, string> = {
  factory:     "Factory",
  org:         "Org",
  config:      "Configuration",
  marketplace: "Marketplace",
  help:        "Help",
  admin:       "Admin",
};

const OWNER_ONLY_GROUPS = ["admin"] as const;

interface AppSidebarProps {
  active: AppSection;
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default function AppSidebar({ active }: AppSidebarProps) {
  const router = useRouter();
  const groups = ["org", "factory", "config", "marketplace", "help", "admin"] as const;

  const { tenantId, tenantName, factoryName, memberRole, factories, setActiveFactory, factoryId, session } = useAuth();
  const isOwner = memberRole === "owner";
  const integrationAlerts = useIntegrationStatus();
  const [integrationsOpen, setIntegrationsOpen] = useState(active === "providers" || active === "storage" || active === "orchestration" || active === "notifications" || active === "knowledge" || active === "mcp-servers");

  // Active factory avatar
  const activeFactory = factories.find((f) => f.id === factoryId);
  const factoryAvatarUrl = activeFactory?.avatar ?? null;
  const userMeta = session?.user?.user_metadata as Record<string, unknown> | undefined;
  const userAvatarUrl = userMeta?.avatar_url as string | undefined;
  const userDisplayName = userMeta?.display_name as string | undefined;

  // Update page title + favicon
  useEffect(() => {
    if (!tenantName) return;
    document.title = `${tenantName} | ${brand.name}`;

    // Use factory avatar if available, otherwise generate initials SVG
    if (factoryAvatarUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
      link.href = factoryAvatarUrl;
      return;
    }

    const ini = initials(tenantName);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${brand.theme.primary}"/>
        <stop offset="100%" stop-color="${brand.theme.accent}"/>
      </linearGradient></defs>
      <rect width="64" height="64" rx="14" fill="url(#g)"/>
      <text x="32" y="32" dominant-baseline="central" text-anchor="middle"
        font-family="system-ui,sans-serif" font-size="${ini.length > 1 ? 26 : 32}"
        font-weight="800" fill="#fff">${ini}</text>
    </svg>`;
    const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = url;
  }, [tenantName, factoryAvatarUrl]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────── */}
      <aside className="app-sidebar" style={{
        width: 240, minWidth: 240,
        height: "100vh",
        background: "var(--crust)",
        borderRight: "1px solid var(--surface0)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}>
        {/* Logo + workspace */}
        <div style={{
          padding: "20px 16px 16px",
          borderBottom: "1px solid var(--surface0)",
        }}>
          {/* Tenant identity */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Link href="/profile" title="Your profile" style={{ textDecoration: "none", flexShrink: 0 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9,
                background: "var(--tirsa-gradient)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em",
                cursor: "pointer", overflow: "hidden",
              }}>
                {userAvatarUrl
                  ? <img src={userAvatarUrl} alt="" style={{ width: 36, height: 36, objectFit: "cover" }} />
                  : tenantName ? initials(tenantName) : "…"}
              </div>
            </Link>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {tenantName ?? "Loading…"}
              </div>
              {userDisplayName && (
                <div style={{ fontSize: 11, color: "var(--subtext0)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {userDisplayName}
                </div>
              )}
            </div>
          </div>

          {/* Bell + Factory selector row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <div style={{ flex: 1, position: "relative",
            display: "flex", alignItems: "center",
            borderRadius: 8,
            background: factoryId ? "rgba(20,99,255,0.06)" : "rgba(245,159,0,0.05)",
            border: `1px solid ${factoryId ? "rgba(20,99,255,0.18)" : "rgba(245,159,0,0.2)"}`,
            boxShadow: factoryId
              ? "0 0 12px rgba(20,99,255,0.12), inset 0 0 8px rgba(20,99,255,0.05)"
              : "0 0 12px rgba(245,159,0,0.08), inset 0 0 8px rgba(245,159,0,0.03)",
            overflow: "hidden",
          }}>
            {factoryId && factoryAvatarUrl ? (
              <img src={factoryAvatarUrl} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: "cover", flexShrink: 0, position: "absolute", left: 8, pointerEvents: "none" }} />
            ) : (
              <div style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                position: "absolute", left: 10, pointerEvents: "none",
                background: factoryId ? "#1463ff" : "#f59f00",
                boxShadow: factoryId
                  ? "0 0 6px 2px rgba(20,99,255,0.6), 0 0 12px 4px rgba(20,99,255,0.25)"
                  : "0 0 6px 2px rgba(245,159,0,0.5), 0 0 12px 4px rgba(245,159,0,0.2)",
              }} />
            )}
            <select
              value={factoryId ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "") {
                  // "None" selected — store sentinel and go to Factory Manager
                  if (tenantId) { try { localStorage.setItem(`tirsa_active_factory_${tenantId}`, "__none__"); } catch { /* noop */ } }
                  window.location.href = "/factory-settings";
                } else {
                  setActiveFactory(val);
                  window.location.reload();
                }
              }}
              style={{
                width: "100%",
                padding: factoryId && factoryAvatarUrl ? "7px 10px 7px 30px" : "7px 10px 7px 24px",
                background: "transparent", border: "none",
                color: factoryId ? "#5b9aff" : "#f5c542",
                fontSize: 10, fontWeight: 700,
                letterSpacing: "0.04em", textTransform: "uppercase",
                outline: "none", cursor: "pointer",
                fontFamily: "var(--font-sans)",
                appearance: "none", WebkitAppearance: "none",
              }}
            >
              <option value="" style={{ textTransform: "none", color: "var(--text)", background: "var(--crust)" }}>None</option>
              {factories.filter((f) => f.enabled !== false).map((f) => (
                <option key={f.id} value={f.id} style={{ textTransform: "none", color: "var(--text)", background: "var(--crust)" }}>
                  {f.name}
                </option>
              ))}
            </select>
            <ChevronDown size={11} color={factoryId ? "#5b9aff" : "#f5c542"} style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
            </div>
            <NotificationBell />
          </div>

          {/* Powered-by badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", background: "var(--surface0)", borderRadius: 6 }}>
            <img src={brand.assets.logoMark} alt={brand.shortName} style={{ width: 14, height: 14 }} />
            <span style={{ fontSize: 10, color: "var(--overlay0)", fontWeight: 600, letterSpacing: "0.04em" }}>POWERED BY {brand.holdingName.toUpperCase()}</span>
          </div>
        </div>

        {/* Nav groups */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "12px 8px" }}>
          {groups.map((group) => {
            if ((OWNER_ONLY_GROUPS as readonly string[]).includes(group) && !isOwner) return null;
            const items = NAV.filter((n) => n.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  color: "var(--overlay0)", textTransform: "uppercase",
                  padding: "0 8px", marginBottom: 4,
                }}>
                  {GROUP_LABELS[group]}
                </div>
                {items.map((item) => {
                  const isActive = item.id === active;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "7px 8px", borderRadius: 7,
                        marginBottom: 1,
                        background: isActive ? "var(--surface0)" : "transparent",
                        color: isActive ? "var(--text)" : "var(--subtext0)",
                        textDecoration: "none",
                        fontSize: 13, fontWeight: isActive ? 600 : 400,
                        transition: "all 0.12s ease",
                        borderLeft: isActive ? "2px solid var(--blue)" : "2px solid transparent",
                      }}
                    >
                      <Icon size={15} strokeWidth={isActive ? 2 : 1.5} />
                      {item.label}
                    </Link>
                  );
                })}

                {/* Integrations collapsible — only in config group */}
                {group === "config" && (
                  <div style={{ marginTop: 1 }}>
                    <button
                      onClick={() => setIntegrationsOpen((o) => !o)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "7px 8px", borderRadius: 7, marginBottom: 1,
                        width: "100%", background: "transparent", border: "none",
                        cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)",
                        color: (active === "providers" || active === "storage" || active === "orchestration" || active === "notifications" || active === "knowledge" || active === "mcp-servers") ? "var(--text)" : "var(--subtext0)",
                        fontSize: 13,
                        fontWeight: (active === "providers" || active === "storage" || active === "orchestration" || active === "notifications" || active === "knowledge" || active === "mcp-servers") ? 600 : 400,
                        borderLeft: "2px solid transparent",
                      }}
                    >
                      <Plug2 size={15} strokeWidth={1.5} />
                      <span style={{ flex: 1 }}>Integrations</span>
                      {integrationAlerts.platforms && !integrationsOpen && (
                        <span style={{
                          width: 16, height: 16, borderRadius: 99,
                          background: integrationAlerts.platforms === "red" ? "rgba(228,75,95,0.15)" : "rgba(245,159,0,0.15)",
                          color: integrationAlerts.platforms === "red" ? "var(--red)" : "var(--peach)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 800, flexShrink: 0,
                        }}>!</span>
                      )}
                      {integrationsOpen
                        ? <ChevronDown size={11} color="var(--overlay0)" />
                        : <ChevronRight size={11} color="var(--overlay0)" />}
                    </button>

                    {integrationsOpen && (
                      <div style={{ paddingLeft: 14 }}>
                        {([
                          { id: "providers",      label: "Providers",      href: "/providers",      icon: Cpu,       alert: null },
                          { id: "storage",        label: "Storage",        href: "/storage",        icon: HardDrive, alert: null },
                          { id: "orchestration",  label: "Orchestration",  href: "/orchestration",  icon: Workflow,  alert: integrationAlerts.platforms },
                          { id: "notifications",  label: "Notifications",  href: "/notifications",  icon: Bell,      alert: null },
                          { id: "knowledge",      label: "Knowledge",      href: "/knowledge",      icon: Brain,     alert: null },
                          { id: "mcp-servers",    label: "Tools",          href: "/mcp-servers",    icon: Terminal,  alert: null },
                        ] as const).map((sub) => {
                          const isActive = active === sub.id;
                          const Icon = sub.icon;
                          return (
                            <Link
                              key={sub.id}
                              href={sub.href}
                              style={{
                                display: "flex", alignItems: "center", gap: 9,
                                padding: "6px 8px", borderRadius: 7, marginBottom: 1,
                                background: isActive ? "var(--surface0)" : "transparent",
                                color: isActive ? "var(--text)" : "var(--subtext0)",
                                textDecoration: "none",
                                fontSize: 12, fontWeight: isActive ? 600 : 400,
                                transition: "all 0.12s ease",
                                borderLeft: isActive ? "2px solid var(--blue)" : "2px solid transparent",
                              }}
                            >
                              <Icon size={13} strokeWidth={isActive ? 2 : 1.5} />
                              <span style={{ flex: 1 }}>{sub.label}</span>
                              {sub.alert && (
                                <span style={{
                                  width: 14, height: 14, borderRadius: 99,
                                  background: sub.alert === "red" ? "rgba(228,75,95,0.15)" : "rgba(245,159,0,0.15)",
                                  color: sub.alert === "red" ? "var(--red)" : "var(--peach)",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 9, fontWeight: 800, flexShrink: 0,
                                }}>!</span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom: logout */}
        <div style={{
          padding: "12px 8px",
          borderTop: "1px solid var(--surface0)",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <button
            onClick={handleLogout}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "7px 8px", borderRadius: 7,
              color: "var(--overlay1)",
              background: "transparent", border: "none",
              cursor: "pointer", fontSize: 12, textAlign: "left",
              width: "100%",
              transition: "color 0.12s ease",
              fontFamily: "var(--font-sans)",
            }}
          >
            <LogOut size={14} strokeWidth={1.5} />
            Sign out
          </button>

          <div style={{ display: "flex", gap: 10, padding: "6px 8px 2px", flexWrap: "wrap" }}>
            <Link href="/legal/tos"     style={{ fontSize: 10, color: "var(--overlay0)", textDecoration: "none" }} title="Terms of Service">Terms</Link>
            <Link href="/legal/privacy" style={{ fontSize: 10, color: "var(--overlay0)", textDecoration: "none" }} title="Privacy Policy">Privacy</Link>
          </div>
          {process.env.NEXT_PUBLIC_APP_VERSION && (
            <div style={{ padding: "4px 8px", fontSize: 9, color: "var(--overlay0)", fontFamily: "var(--font-mono)", letterSpacing: "0.02em" }}>
              {process.env.NEXT_PUBLIC_APP_VERSION}
            </div>
          )}
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────── */}
      <nav className="bottom-nav">
        {NAV.filter((n) => n.group === "factory").slice(0, 3).map((item) => {
          const isActive = item.id === active;
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 3, padding: "8px 0", flex: 1,
                color: isActive ? "var(--blue)" : "var(--overlay1)",
                textDecoration: "none", fontSize: 10,
              }}
            >
              <Icon size={18} strokeWidth={isActive ? 2 : 1.5} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
