"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Edit3,
  Key,
  Power,
  Trash2,
  Activity,
  Clock,
  Server,
  CheckCircle,
  XCircle,
  Save,
  X,
  TrendingUp,
  Cpu,
  HardDrive,
  Database,
  Shield,
  AlertTriangle,
  Zap,
  Users,
  Timer,
  Layers,
  GitBranch,
} from "lucide-react";
import {
  getDatabase,
  getInstanceHealth,
  getHealthReport,
  refreshDatabases,
  updateDatabase,
  updateCredentials,
  deactivateDatabase,
  reactivateDatabase,
  deleteDatabase,
} from "@/lib/api";
import type {
  DatabaseInstance,
  DiscoveredDatabase,
  InstanceHealth,
  HealthReport,
  Environment,
} from "@/lib/types";
import { Card, StatusBadge, Button, Modal, Spinner } from "@/components/ui";

const envColors: Record<Environment, string> = {
  production: "bg-danger/15 text-danger",
  staging: "bg-warning/15 text-warning",
  development: "bg-info/15 text-info",
  dr: "bg-muted/15 text-muted",
};

const dbTypeLabels: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mssql: "SQL Server",
  oracle: "Oracle",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatUptime(hours: number): string {
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = Math.floor(hours / 24);
  const remaining = hours % 24;
  return `${days}d ${remaining.toFixed(0)}h`;
}

export default function DatabaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [instance, setInstance] = useState<DatabaseInstance | null>(null);
  const [health, setHealth] = useState<InstanceHealth | null>(null);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [dbRefreshing, setDbRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    displayName: "",
    application: "",
    team: "",
    ownerEmail: "",
    environment: "" as Environment,
  });

  // Credentials modal
  const [credsOpen, setCredsOpen] = useState(false);
  const [credsForm, setCredsForm] = useState({ username: "", password: "", role: "default" });

  // Delete confirm
  const [deleteOpen, setDeleteOpen] = useState(false);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchInstance = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getDatabase(id);
      setInstance(data);
      setEditForm({
        displayName: data.display_name || "",
        application: data.application || "",
        team: data.team || "",
        ownerEmail: data.owner_email || "",
        environment: data.environment,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load instance");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchHealth = useCallback(async () => {
    try {
      setHealthLoading(true);
      const data = await getInstanceHealth(id);
      setHealth(data);
    } catch {
      // silent
    } finally {
      setHealthLoading(false);
    }
  }, [id]);

  const fetchHealthReport = useCallback(async () => {
    try {
      setReportLoading(true);
      setReportError(null);
      const data = await getHealthReport(id);
      setHealthReport(data);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to load health report");
    } finally {
      setReportLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchInstance();
    fetchHealth();
    fetchHealthReport();
  }, [fetchInstance, fetchHealth, fetchHealthReport]);

  const handleUpdate = async () => {
    try {
      const payload: Record<string, string> = {};
      if (editForm.displayName) payload.displayName = editForm.displayName;
      if (editForm.application) payload.application = editForm.application;
      if (editForm.team) payload.team = editForm.team;
      if (editForm.ownerEmail) payload.ownerEmail = editForm.ownerEmail;
      if (editForm.environment) payload.environment = editForm.environment;

      await updateDatabase(id, payload);
      setEditOpen(false);
      showToast("Instance updated successfully", "success");
      fetchInstance();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Update failed", "error");
    }
  };

  const handleCredsUpdate = async () => {
    try {
      const payload: { username: string; password: string; additionalOptions?: Record<string, unknown> } = {
        username: credsForm.username,
        password: credsForm.password,
      };
      // Pass Oracle role via additionalOptions
      if (instance?.db_type === "oracle" && credsForm.role && credsForm.role !== "default") {
        payload.additionalOptions = { role: credsForm.role };
      }
      await updateCredentials(id, payload);
      setCredsOpen(false);
      setCredsForm({ username: "", password: "", role: "default" });
      showToast("Credentials updated successfully", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Credentials update failed", "error");
    }
  };

  const handleToggleActive = async () => {
    try {
      if (instance?.status === "active") {
        await deactivateDatabase(id);
        showToast("Instance deactivated", "success");
      } else {
        await reactivateDatabase(id);
        showToast("Instance reactivated", "success");
      }
      fetchInstance();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Action failed", "error");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteDatabase(id);
      showToast("Instance deleted", "success");
      router.push("/databases");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  };

  if (loading) return <Spinner />;

  if (error || !instance) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <XCircle className="w-12 h-12 text-danger mb-4" />
        <p className="text-danger text-sm">{error || "Instance not found"}</p>
        <button
          onClick={() => router.push("/databases")}
          className="mt-4 text-primary text-sm hover:underline"
        >
          Back to Databases
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-success/15 text-success border border-success/30"
              : "bg-danger/15 text-danger border border-danger/30"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/databases")}
            className="p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {instance.display_name || instance.name}
            </h1>
            {instance.display_name && instance.display_name !== instance.name && (
              <p className="text-sm text-muted">{instance.name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={instance.status} size="md" />
          <Button variant="ghost" size="sm" onClick={() => router.push(`/databases/${id}/predictions`)}>
            <TrendingUp className="w-3.5 h-3.5" /> Predictions
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.push(`/databases/${id}/fra-risk`)}>
            <Activity className="w-3.5 h-3.5" /> FRA Risk
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCredsOpen(true)}>
            <Key className="w-3.5 h-3.5" /> Credentials
          </Button>
          <Button
            variant={instance.status === "active" ? "warning" : "success"}
            size="sm"
            onClick={handleToggleActive}
          >
            <Power className="w-3.5 h-3.5" />
            {instance.status === "active" ? "Deactivate" : "Reactivate"}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Connection & Metadata */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Connection info */}
        <Card>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Connection Details
          </h2>
          <dl className="space-y-3">
            {[
              ["Type", dbTypeLabels[instance.db_type] || instance.db_type],
              ["Host", `${instance.host}:${instance.port}`],
              ["Database", instance.database_name],
              ["Pool", `min ${instance.pool_min} / max ${instance.pool_max}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-sm">
                <dt className="text-muted">{label}</dt>
                <dd className="text-foreground font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {/* Metadata */}
        <Card>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Metadata
          </h2>
          <dl className="space-y-3">
            {[
              [
                "Environment",
                <span
                  key="env"
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${envColors[instance.environment]}`}
                >
                  {instance.environment}
                </span>,
              ],
              ["Application", instance.application || "—"],
              ["Team", instance.team || "—"],
              ["Owner", instance.owner_email || "—"],
              ["Onboarded By", instance.onboarded_by],
              [
                "Onboarded At",
                <span key="onboarded" className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(instance.onboarded_at).toLocaleString()}
                </span>,
              ],
              ...(instance.updated_at
                ? [
                    [
                      "Last Updated",
                      <span key="updated" className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(instance.updated_at).toLocaleString()}
                      </span>,
                    ],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between text-sm items-center">
                <dt className="text-muted">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      {/* ── Instance Databases ── */}
      {instance.db_type !== "oracle" && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              Instance Databases
              {instance.databases && (
                <span className="text-xs font-normal text-muted ml-1">
                  ({instance.databases.filter((d) => !d.isSystem).length} user / {instance.databases.filter((d) => d.isSystem).length} system)
                </span>
              )}
            </h2>
            <button
              onClick={async () => {
                setDbRefreshing(true);
                try {
                  const res = await refreshDatabases(id);
                  if (res.success) {
                    // Refetch instance to get updated databases list
                    await fetchInstance();
                    showToast(`Discovered ${res.databases.length} database(s)`, "success");
                  }
                } catch (err) {
                  showToast(err instanceof Error ? err.message : "Refresh failed", "error");
                } finally {
                  setDbRefreshing(false);
                }
              }}
              className="p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
              title="Refresh database list"
            >
              <RefreshCw className={`w-4 h-4 ${dbRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>

          {instance.databases && instance.databases.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 text-muted font-medium">Database</th>
                    <th className="pb-2 text-muted font-medium text-right">Size</th>
                    <th className="pb-2 text-muted font-medium text-right">Type</th>
                    <th className="pb-2 text-muted font-medium text-right">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {instance.databases.map((db) => (
                    <tr key={db.name} className={db.isSystem ? "opacity-50" : ""}>
                      <td className="py-2 font-mono text-foreground flex items-center gap-2">
                        <Database className="w-3.5 h-3.5 text-info" />
                        {db.name}
                        {db.name === instance.database_name && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                            connection
                          </span>
                        )}
                      </td>
                      <td className="py-2 font-mono text-foreground text-right">
                        {db.sizeBytes !== null ? formatBytes(db.sizeBytes) : "—"}
                      </td>
                      <td className="py-2 text-right">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          db.isSystem
                            ? "bg-muted/15 text-muted"
                            : "bg-info/15 text-info"
                        }`}>
                          {db.isSystem ? "system" : "user"}
                        </span>
                      </td>
                      <td className="py-2 text-muted text-right text-xs">
                        {new Date(db.lastSeenAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">
              No databases discovered yet. Click refresh to scan the instance.
            </p>
          )}
        </Card>
      )}

      {/* ── Database Health Summary ── */}
      <Card>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Database Health Summary</h2>
          <div className="flex items-center gap-2">
            {healthReport && (
              <span className="text-xs text-muted">
                {healthReport.checkDurationMs}ms
              </span>
            )}
            <button
              onClick={() => { fetchHealth(); fetchHealthReport(); }}
              className="p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${healthLoading || reportLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Overall Status Banner */}
        {healthReport ? (
          <>
          <div className={`rounded-lg px-4 py-3 ${healthReport.issues.length > 0 ? 'rounded-b-none' : 'mb-6'} flex items-center justify-between ${
            healthReport.overallStatus === "CRITICAL"
              ? "bg-danger/10 border border-danger/30"
              : healthReport.overallStatus === "WARNING"
                ? "bg-warning/10 border border-warning/30"
                : "bg-success/10 border border-success/30"
          }`}>
            <div className="flex items-center gap-3">
              {healthReport.overallStatus === "CRITICAL" ? (
                <XCircle className="w-6 h-6 text-danger" />
              ) : healthReport.overallStatus === "WARNING" ? (
                <AlertTriangle className="w-6 h-6 text-warning" />
              ) : (
                <CheckCircle className="w-6 h-6 text-success" />
              )}
              <div>
                <p className={`text-sm font-semibold ${
                  healthReport.overallStatus === "CRITICAL"
                    ? "text-danger"
                    : healthReport.overallStatus === "WARNING"
                      ? "text-warning"
                      : "text-success"
                }`}>
                  {healthReport.overallStatus}
                </p>
                <p className="text-xs text-muted">
                  {healthReport.issues.length === 0
                    ? "All checks passed"
                    : `${healthReport.issues.length} issue${healthReport.issues.length > 1 ? "s" : ""} detected`}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">Engine</p>
              <p className="text-sm font-medium text-foreground">{dbTypeLabels[healthReport.dbType] || healthReport.dbType}</p>
            </div>
          </div>
          {/* Issue details under the banner */}
          {healthReport.issues.length > 0 && (
            <div className={`mb-6 rounded-b-lg px-4 py-3 space-y-1.5 border-x border-b ${
              healthReport.overallStatus === "CRITICAL"
                ? "border-danger/30 bg-danger/5"
                : "border-warning/30 bg-warning/5"
            }`}>
              {healthReport.issues.slice(0, 5).map((issue, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  {issue.severity === "CRITICAL" ? (
                    <XCircle className="w-3.5 h-3.5 text-danger mt-0.5 flex-shrink-0" />
                  ) : issue.severity === "WARNING" ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-warning mt-0.5 flex-shrink-0" />
                  ) : (
                    <Activity className="w-3.5 h-3.5 text-info mt-0.5 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span className="text-foreground">{issue.message}</span>
                    <span className="text-muted ml-2">{issue.category}</span>
                  </div>
                </div>
              ))}
              {healthReport.issues.length > 5 && (
                <p className="text-xs text-muted pl-5">+ {healthReport.issues.length - 5} more issue{healthReport.issues.length - 5 > 1 ? "s" : ""}</p>
              )}
            </div>
          )}
          </>
        ) : (
          <div className={`rounded-lg px-4 py-3 mb-6 ${
            reportError ? "bg-danger/10 border border-danger/30" : "bg-surface-hover/50"
          }`}>
            <p className={`text-sm ${reportError ? "text-danger" : "text-muted"}`}>
              {reportLoading
                ? "Running health checks..."
                : reportError
                  ? reportError
                  : "Loading health report..."}
            </p>
          </div>
        )}

        {/* Connection Quick-Status Row */}
        {health && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
              {health.health.status === "up" ? (
                <CheckCircle className="w-6 h-6 text-success" />
              ) : (
                <XCircle className="w-6 h-6 text-danger" />
              )}
              <div>
                <p className="text-xs text-muted">Connection</p>
                <StatusBadge status={health.health.status} />
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <Zap className="w-6 h-6 text-primary" />
              <div>
                <p className="text-xs text-muted">Latency</p>
                <p className="text-xl font-bold text-foreground">
                  {health.health.latencyMs}<span className="text-xs text-muted ml-1">ms</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <Server className="w-6 h-6 text-info" />
              <div>
                <p className="text-xs text-muted">Failures</p>
                <p className="text-xl font-bold text-foreground">
                  {instance.consecutive_failures}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Sections Grid */}
        {healthReport && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">

            {/* ── Performance ── */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Cpu className="w-4 h-4 text-primary" />
                Performance
              </h3>
              {healthReport.metrics.performance ? (
                <dl className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted flex items-center gap-1"><Users className="w-3 h-3" /> Active Sessions</dt>
                    <dd className="font-mono text-foreground">{healthReport.metrics.performance.activeSessions}</dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted flex items-center gap-1"><Cpu className="w-3 h-3" /> {instance.engine === 'postgres' ? 'Conn %' : 'CPU'}</dt>
                    <dd className={`font-mono ${
                      healthReport.metrics.performance.cpuPercent !== null && healthReport.metrics.performance.cpuPercent > 90
                        ? "text-danger font-bold" : "text-foreground"
                    }`}>
                      {healthReport.metrics.performance.cpuPercent !== null
                        ? `${healthReport.metrics.performance.cpuPercent.toFixed(1)}%`
                        : "N/A"}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted flex items-center gap-1"><HardDrive className="w-3 h-3" /> {instance.engine === 'mssql' ? 'SQL Memory' : instance.engine === 'mysql' ? 'Buffer Pool' : 'Memory'}</dt>
                    <dd className="font-mono text-foreground">
                      {healthReport.metrics.performance.memoryPercent !== null
                        ? `${healthReport.metrics.performance.memoryPercent.toFixed(1)}%`
                        : "N/A"}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted flex items-center gap-1"><Timer className="w-3 h-3" /> Slow Queries</dt>
                    <dd className={`font-mono ${
                      healthReport.metrics.performance.slowQueries > 10
                        ? "text-warning font-bold" : "text-foreground"
                    }`}>
                      {healthReport.metrics.performance.slowQueries}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-muted">No data</p>
              )}
            </div>

            {/* ── Storage ── */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Database className="w-4 h-4 text-info" />
                Storage
              </h3>
              {healthReport.metrics.tablespaces && healthReport.metrics.tablespaces.length > 0 ? (
                <dl className="space-y-2">
                  {/* Highest usage tablespace */}
                  {(() => {
                    const sorted = [...healthReport.metrics.tablespaces].sort(
                      (a, b) => (Number(b.usedPercent) || 0) - (Number(a.usedPercent) || 0)
                    );
                    const top = sorted[0]!;
                    const pct = Number(top.usedPercent) || 0;
                    return (
                      <div className="flex justify-between text-sm">
                        <dt className="text-muted truncate max-w-[140px]" title={top.name}>
                          {instance.engine === 'postgres' ? 'Largest DB' : 'Max Tablespace'}
                        </dt>
                        <dd className={`font-mono ${
                          pct >= 90 ? "text-danger font-bold"
                            : pct >= 85 ? "text-warning font-bold"
                              : "text-foreground"
                        }`}>
                          {pct.toFixed(1)}%
                          <span className="text-xs text-muted ml-1">({top.name})</span>
                        </dd>
                      </div>
                    );
                  })()}
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">{instance.engine === 'postgres' ? 'Databases' : instance.engine === 'mysql' ? 'Schemas' : 'Data Files'}</dt>
                    <dd className="font-mono text-foreground">{healthReport.metrics.tablespaces.length}</dd>
                  </div>
                  {healthReport.metrics.fra && (
                    <>
                      <div className="flex justify-between text-sm">
                        <dt className="text-muted">FRA Usage</dt>
                        <dd className={`font-mono ${
                          (Number(healthReport.metrics.fra.usedPercent) || 0) >= 85 ? "text-danger font-bold"
                            : (Number(healthReport.metrics.fra.usedPercent) || 0) >= 80 ? "text-warning font-bold"
                              : "text-foreground"
                        }`}>
                          {(Number(healthReport.metrics.fra.usedPercent) || 0).toFixed(1)}%
                        </dd>
                      </div>
                      <div className="flex justify-between text-sm">
                        <dt className="text-muted">Reclaimable</dt>
                        <dd className="font-mono text-foreground">
                          {formatBytes(Number(healthReport.metrics.fra.reclaimableBytes) || 0)}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              ) : (
                <p className="text-xs text-muted">{instance.engine === 'postgres' ? 'No database size data' : instance.engine === 'mysql' ? 'No schema data' : 'No tablespace data'}</p>
              )}
            </div>

            {/* ── Availability ── */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-success" />
                Availability
              </h3>
              {healthReport.metrics.availability ? (
                <dl className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">Instance</dt>
                    <dd className="font-mono text-foreground">{healthReport.metrics.availability.instanceStatus}</dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">{instance.engine === 'oracle' ? 'Listener' : 'Connectivity'}</dt>
                    <dd className={`font-mono ${
                      healthReport.metrics.availability.listenerStatus === "UP" ? "text-success" : "text-danger"
                    }`}>
                      {healthReport.metrics.availability.listenerStatus}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">Uptime</dt>
                    <dd className="font-mono text-foreground">
                      {healthReport.metrics.availability.uptimeHours !== null
                        ? formatUptime(healthReport.metrics.availability.uptimeHours)
                        : "N/A"}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">Blocked Sessions</dt>
                    <dd className={`font-mono ${
                      healthReport.metrics.availability.blockedSessions > 5
                        ? "text-warning font-bold" : "text-foreground"
                    }`}>
                      {healthReport.metrics.availability.blockedSessions}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-muted">No data</p>
              )}
            </div>

            {/* ── Backup ── */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Layers className="w-4 h-4 text-warning" />
                Backup
              </h3>
              {healthReport.metrics.backups ? (
                <dl className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">Last Backup</dt>
                    <dd className="font-mono text-foreground text-right">
                      {healthReport.metrics.backups.lastSuccessfulBackup
                        ? new Date(healthReport.metrics.backups.lastSuccessfulBackup).toLocaleString()
                        : "None"}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">Status</dt>
                    <dd className={`font-mono font-bold ${
                      healthReport.metrics.backups.lastBackupStatus === "SUCCESS"
                        ? "text-success"
                        : healthReport.metrics.backups.lastBackupStatus === "FAILED"
                          ? "text-danger"
                          : "text-muted"
                    }`}>
                      {healthReport.metrics.backups.lastBackupStatus}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">Type</dt>
                    <dd className="font-mono text-foreground">
                      {healthReport.metrics.backups.lastBackupType || "N/A"}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">Hours Since</dt>
                    <dd className={`font-mono ${
                      healthReport.metrics.backups.hoursSinceLastBackup !== undefined &&
                      healthReport.metrics.backups.hoursSinceLastBackup > 48
                        ? "text-danger font-bold"
                        : healthReport.metrics.backups.hoursSinceLastBackup !== undefined &&
                          healthReport.metrics.backups.hoursSinceLastBackup > 24
                          ? "text-warning font-bold"
                          : "text-foreground"
                    }`}>
                      {healthReport.metrics.backups.hoursSinceLastBackup !== undefined
                        ? `${healthReport.metrics.backups.hoursSinceLastBackup.toFixed(1)}h`
                        : "N/A"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-muted">No backup data</p>
              )}
            </div>

            {/* ── Replication ── */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-purple-400" />
                Replication
              </h3>
              {healthReport.metrics.replication ? (
                <dl className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">Role</dt>
                    <dd className="font-mono text-foreground">{healthReport.metrics.replication.role}</dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">Status</dt>
                    <dd className={`font-mono ${
                      healthReport.metrics.replication.replicaStatus === "ACTIVE"
                        ? "text-success"
                        : healthReport.metrics.replication.replicaStatus === "N/A"
                          ? "text-muted"
                          : "text-warning"
                    }`}>
                      {healthReport.metrics.replication.replicaStatus}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">{instance.engine === 'oracle' ? 'Apply Lag' : 'Replication Lag'}</dt>
                    <dd className="font-mono text-foreground">
                      {healthReport.metrics.replication.lagSeconds !== null
                        ? `${healthReport.metrics.replication.lagSeconds.toFixed(0)}s`
                        : "N/A"}
                    </dd>
                  </div>
                  <div className="flex justify-between text-sm">
                    <dt className="text-muted">{instance.engine === 'oracle' ? 'Transport Lag' : 'Transport Delay'}</dt>
                    <dd className="font-mono text-foreground">
                      {healthReport.metrics.replication.transportLagSeconds !== null
                        ? `${healthReport.metrics.replication.transportLagSeconds.toFixed(0)}s`
                        : "N/A"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-muted">No replication data</p>
              )}
            </div>

            {/* ── Alert Summary ── */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-danger" />
                Alert Summary
              </h3>
              {(() => {
                const critical = healthReport.issues.filter((i) => i.severity === "CRITICAL").length;
                const warning = healthReport.issues.filter((i) => i.severity === "WARNING").length;
                const info = healthReport.issues.filter((i) => i.severity === "INFO").length;
                return (
                  <dl className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <dt className="text-muted">Critical</dt>
                      <dd className={`font-mono font-bold ${critical > 0 ? "text-danger" : "text-foreground"}`}>
                        {critical}
                      </dd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <dt className="text-muted">Warning</dt>
                      <dd className={`font-mono font-bold ${warning > 0 ? "text-warning" : "text-foreground"}`}>
                        {warning}
                      </dd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <dt className="text-muted">Info</dt>
                      <dd className="font-mono text-foreground">{info}</dd>
                    </div>
                    <div className="flex justify-between text-sm border-t border-border pt-2">
                      <dt className="text-muted">Total Issues</dt>
                      <dd className="font-mono font-bold text-foreground">{healthReport.issues.length}</dd>
                    </div>
                  </dl>
                );
              })()}
            </div>
          </div>
        )}

        {/* Issues & Recommendations */}
        {healthReport && healthReport.issues.length > 0 && (
          <div className="mt-6 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Issues</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {healthReport.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                    issue.severity === "CRITICAL"
                      ? "border-danger/30 bg-danger/5"
                      : issue.severity === "WARNING"
                        ? "border-warning/30 bg-warning/5"
                        : "border-border bg-surface-hover/30"
                  }`}
                >
                  {issue.severity === "CRITICAL" ? (
                    <XCircle className="w-4 h-4 text-danger mt-0.5 flex-shrink-0" />
                  ) : issue.severity === "WARNING" ? (
                    <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                  ) : (
                    <Activity className="w-4 h-4 text-info mt-0.5 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-foreground">{issue.message}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {issue.category} &middot; {issue.code}
                      {issue.affectedObject && ` · ${issue.affectedObject}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {healthReport && healthReport.recommendations.length > 0 && (
          <div className="mt-4 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Recommendations</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {healthReport.recommendations.map((rec, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg border border-border bg-surface-hover/20 text-sm"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      rec.priority === "HIGH"
                        ? "bg-danger/15 text-danger"
                        : rec.priority === "MEDIUM"
                          ? "bg-warning/15 text-warning"
                          : "bg-info/15 text-info"
                    }`}>
                      {rec.priority}
                    </span>
                    <span className="font-medium text-foreground">{rec.title}</span>
                  </div>
                  <p className="text-muted">{rec.description}</p>
                  <p className="text-xs text-primary mt-1">{rec.action}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>



      {/* Tags */}
      {Object.keys(instance.tags).length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-foreground mb-4">Tags</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(instance.tags).map(([key, val]) => (
              <span
                key={key}
                className="px-3 py-1 rounded-full bg-surface-hover text-sm text-foreground"
              >
                <span className="text-muted">{key}:</span> {val}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* ── Edit Modal ── */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Instance">
        <div className="space-y-4">
          {[
            { label: "Display Name", key: "displayName" as const, type: "text" },
            { label: "Application", key: "application" as const, type: "text" },
            { label: "Team", key: "team" as const, type: "text" },
            { label: "Owner Email", key: "ownerEmail" as const, type: "email" },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-sm text-muted mb-1">{label}</label>
              <input
                type={type}
                value={editForm[key]}
                onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>
          ))}
          <div>
            <label className="block text-sm text-muted mb-1">Environment</label>
            <select
              value={editForm.environment}
              onChange={(e) =>
                setEditForm({ ...editForm, environment: e.target.value as Environment })
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
              <option value="dr">DR</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              <X className="w-4 h-4" /> Cancel
            </Button>
            <Button onClick={handleUpdate}>
              <Save className="w-4 h-4" /> Save
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Credentials Modal ── */}
      <Modal open={credsOpen} onClose={() => setCredsOpen(false)} title="Update Credentials">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1">Username</label>
            <input
              type="text"
              value={credsForm.username}
              onChange={(e) => setCredsForm({ ...credsForm, username: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Password</label>
            <input
              type="password"
              value={credsForm.password}
              onChange={(e) => setCredsForm({ ...credsForm, password: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>
          {/* Oracle-specific role selector */}
          {instance.db_type === "oracle" && (
            <div>
              <label className="block text-sm text-muted mb-1">Connection Role</label>
              <select
                value={credsForm.role}
                onChange={(e) => setCredsForm({ ...credsForm, role: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
              >
                <option value="default">Default</option>
                <option value="sysdba">SYSDBA</option>
                <option value="sysoper">SYSOPER</option>
                <option value="sysasm">SYSASM</option>
                <option value="sysbackup">SYSBACKUP</option>
                <option value="sysdg">SYSDG</option>
                <option value="syskm">SYSKM</option>
                <option value="sysrac">SYSRAC</option>
              </select>
              <p className="text-xs text-muted mt-1">
                Use SYSDBA for SYS user connections.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCredsOpen(false)}>
              <X className="w-4 h-4" /> Cancel
            </Button>
            <Button
              onClick={handleCredsUpdate}
              disabled={!credsForm.username || !credsForm.password}
            >
              <Key className="w-4 h-4" /> Update
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirmation ── */}
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Instance">
        <p className="text-sm text-muted mb-6">
          Are you sure you want to permanently delete{" "}
          <strong className="text-foreground">{instance.name}</strong>? This action
          cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" /> Delete Permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}
