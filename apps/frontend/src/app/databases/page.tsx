"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Database,
  Search,
  Filter,
  RefreshCw,
  PlusCircle,
  ExternalLink,
  Clock,
  TrendingUp,
  Shield,
} from "lucide-react";
import { listDatabases } from "@/lib/api";
import type { DatabaseInstance, Environment, DbType, InstanceStatus } from "@/lib/types";
import { StatusBadge, Card, Spinner, EmptyState, Button } from "@/components/ui";

const envColors: Record<Environment, string> = {
  production: "bg-danger/15 text-danger",
  staging: "bg-warning/15 text-warning",
  development: "bg-info/15 text-info",
  dr: "bg-muted/15 text-muted",
};

const dbTypeIcons: Record<DbType, string> = {
  postgres: "🐘",
  mysql: "🐬",
  mssql: "🔷",
  oracle: "🔴",
};

export default function DatabasesPage() {
  const router = useRouter();
  const [instances, setInstances] = useState<DatabaseInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [envFilter, setEnvFilter] = useState<Environment | "">("");
  const [typeFilter, setTypeFilter] = useState<DbType | "">("");
  const [statusFilter, setStatusFilter] = useState<InstanceStatus | "">("");

  const fetchInstances = useCallback(async () => {
    try {
      setLoading(true);
      const filters: Record<string, string> = {};
      if (envFilter) filters.environment = envFilter;
      if (typeFilter) filters.dbType = typeFilter;
      if (statusFilter) filters.status = statusFilter;
      const data = await listDatabases(filters);
      setInstances(data.instances);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [envFilter, typeFilter, statusFilter]);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const filtered = instances.filter((inst) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      inst.name.toLowerCase().includes(q) ||
      inst.display_name?.toLowerCase().includes(q) ||
      inst.host.toLowerCase().includes(q) ||
      inst.application?.toLowerCase().includes(q) ||
      inst.team?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Databases</h1>
          <p className="text-sm text-muted mt-1">
            Manage all onboarded database instances
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchInstances}
            className="p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Link href="/databases/onboard">
            <Button>
              <PlusCircle className="w-4 h-4" />
              Onboard
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Card className="!p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search by name, host, app, team..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <select
                value={envFilter}
                onChange={(e) => setEnvFilter(e.target.value as Environment | "")}
                className="pl-8 pr-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary appearance-none cursor-pointer"
              >
                <option value="">All Envs</option>
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
                <option value="dr">DR</option>
              </select>
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as DbType | "")}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary appearance-none cursor-pointer"
            >
              <option value="">All Types</option>
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
              <option value="mssql">SQL Server</option>
              <option value="oracle">Oracle</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as InstanceStatus | "")}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary appearance-none cursor-pointer"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Results */}
      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Database className="w-8 h-8" />}
          message={
            instances.length === 0
              ? "No databases onboarded yet"
              : "No databases match your filters"
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((inst) => (
            <Link key={inst.id} href={`/databases/${inst.id}`}>
              <Card className="hover:border-primary/30 transition-all cursor-pointer h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {dbTypeIcons[inst.db_type]}
                    </span>
                    <div>
                      <h3 className="font-semibold text-foreground text-sm">
                        {inst.display_name || inst.name}
                      </h3>
                      {inst.display_name && inst.display_name !== inst.name && (
                        <p className="text-xs text-muted">{inst.name}</p>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={inst.status} />
                </div>
                          {/* Navigation buttons for FRA Risk and Predictions */}
                          <div className="flex gap-2 mt-4">
                            <Link href={`/databases/${inst.id}/fra-risk`}>
                              <Button size="sm" variant="outline">FRA Risk</Button>
                            </Link>
                            <Link href={`/databases/${inst.id}/predictions`}>
                              <Button size="sm" variant="outline">Predictions</Button>
                            </Link>
                          </div>

                <div className="space-y-2 text-xs text-muted">
                  <div className="flex items-center justify-between">
                    <span>Host</span>
                    <span className="text-foreground font-mono">
                      {inst.host}:{inst.port}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Database</span>
                    <span className="text-foreground">{inst.database_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Environment</span>
                    <span className={`px-2 py-0.5 rounded-full font-medium ${envColors[inst.environment]}`}>
                      {inst.environment}
                    </span>
                  </div>
                  {inst.application && (
                    <div className="flex items-center justify-between">
                      <span>Application</span>
                      <span className="text-foreground">{inst.application}</span>
                    </div>
                  )}
                  {inst.team && (
                    <div className="flex items-center justify-between">
                      <span>Team</span>
                      <span className="text-foreground">{inst.team}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                  {inst.last_health_check ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                      <Clock className="w-3 h-3" />
                      {new Date(inst.last_health_check).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">No health check yet</span>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/databases/${inst.id}/predictions`); }}
                      className="p-1 rounded hover:bg-primary/15 text-muted hover:text-primary transition-colors"
                      title="Storage Predictions"
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/databases/${inst.id}/fra-risk`); }}
                      className="p-1 rounded hover:bg-info/15 text-muted hover:text-info transition-colors"
                      title="FRA Risk"
                    >
                      <Shield className="w-3.5 h-3.5" />
                    </button>
                    <ExternalLink className="w-3.5 h-3.5 text-muted" />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-muted text-right">
        {filtered.length} of {instances.length} instances shown
      </p>
    </div>
  );
}
