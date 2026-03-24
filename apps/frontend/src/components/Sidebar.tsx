"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Database,
  LayoutDashboard,
  PlusCircle,
  Activity,
  Server,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/databases", label: "Databases", icon: Database },
  { href: "/databases/onboard", label: "Onboard", icon: PlusCircle },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:flex-col md:w-64 bg-surface border-r border-border min-h-screen">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
        <div className="p-2 bg-primary/20 rounded-lg">
          <Server className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">AutoDBA</h1>
          <p className="text-xs text-muted">Agent Console</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/"
              ? pathname === "/"
              : pathname.startsWith(href) && !pathname.includes("/onboard");
          const isOnboard = href.includes("/onboard") && pathname.includes("/onboard");
          const active = isActive || isOnboard;

          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Activity className="w-3.5 h-3.5" />
          <span>v1.0.0</span>
        </div>
      </div>
    </aside>
  );
}
