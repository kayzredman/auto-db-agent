"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Database,
  Activity,
  Server,
  CheckCircle,
  XCircle,
  RefreshCw,
  Clock,
  TrendingUp,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { getDatabaseHealth } from "@/lib/api";
import type { HealthSummary, Environment } from "@/lib/types";
import { StatusBadge, StatCard, Card, Spinner } from "@/components/ui";

const envLabels: Record<Environment, string> = {
  production: "Production",
  staging: "Staging",
  development: "Development",
  dr: "DR",
};

const envColors: Record<Environment, string> = {
  production: "bg-danger/15 text-danger",
  staging: "bg-warning/15 text-warning",
  development: "bg-info/15 text-info",
  dr: "bg-muted/15 text-muted",
};

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getDatabaseHealth();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  if (loading && !health) return <Spinner />;

  if (error && !health) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <XCircle className="w-12 h-12 text-danger mb-4" />
        <p className="text-danger text-sm">{error}</p>
        <button
          onClick={fetchHealth}
          className="mt-4 text-primary text-sm hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!health) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted mt-1">
            Real-time overview of all managed database instances
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={health.overall} size="md" />
          <button
            onClick={fetchHealth}
            className="p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Instances"
          value={health.totalInstances}
          icon={<Server className="w-5 h-5" />}
          color="text-primary"
        />
        <StatCard
          label="Active"
          value={health.activeInstances}
          icon={<Database className="w-5 h-5" />}
          color="text-info"
        />
        <StatCard
          label="Healthy"
          value={health.upCount}
          icon={<CheckCircle className="w-5 h-5" />}
          color="text-success"
        />
        <StatCard
          label="Unhealthy"
          value={health.downCount}
          icon={<XCircle className="w-5 h-5" />}
          color="text-danger"
        />
      </div>

      {/* Environment breakdown */}
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Environment Breakdown
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {(Object.keys(envLabels) as Environment[]).map((env) => {
            const data = health.byEnvironment[env];
            return (
              <div
                key={env}
                className="rounded-lg border border-border p-4 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${envColors[env]}`}
                  >
                    {envLabels[env]}
                  </span>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold text-foreground">
                      {data.total}
                    </p>
                    <p className="text-xs text-muted">instances</p>
                  </div>
                  <div className="text-right text-xs space-y-1">
                    <p className="text-success">{data.up} up</p>
                    <p className="text-danger">{data.down} down</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Instance health list */}
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Instance Health
        </h2>
        {health.instances.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">
            <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No instances registered yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wider">
                  <th className="pb-3 pr-4">Instance</th>
                  <th className="pb-3 pr-4">Type</th>
                  <th className="pb-3 pr-4">Environment</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4 text-right">Latency</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {health.instances.map((inst) => (
                  <tr
                    key={inst.instanceId}
                    className="hover:bg-surface-hover/50 transition-colors"
                  >
                    <td className="py-3 pr-4">
                      <span className="font-medium text-foreground text-sm">
                        {inst.name}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-xs bg-surface-hover rounded px-2 py-1 text-muted">
                        {inst.dbType}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`text-xs rounded-full px-2 py-0.5 font-medium ${envColors[inst.environment]}`}
                      >
                        {envLabels[inst.environment]}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={inst.health.status} />
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Clock className="w-3 h-3" />
                        {inst.health.latencyMs}ms
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/databases/${inst.instanceId}/predictions`}
                          className="p-1.5 rounded-lg hover:bg-primary/15 text-muted hover:text-primary transition-colors"
                          title="Storage Predictions"
                        >
                          <TrendingUp className="w-3.5 h-3.5" />
                        </Link>
                        <Link
                          href={`/databases/${inst.instanceId}/fra-risk`}
                          className="p-1.5 rounded-lg hover:bg-info/15 text-muted hover:text-info transition-colors"
                          title="FRA Risk"
                        >
                          <Shield className="w-3.5 h-3.5" />
                        </Link>
                        <Link
                          href={`/databases/${inst.instanceId}`}
                          className="p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
                          title="View Details"
                        >
                          <Database className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Last checked */}
      <p className="text-xs text-muted text-right">
        Last updated:{" "}
        {new Date(health.checkedAt).toLocaleString()}
        {loading && (
          <span className="ml-2">
            <Activity className="w-3 h-3 inline animate-pulse" />
          </span>
        )}
      </p>
    </div>
  );
}
