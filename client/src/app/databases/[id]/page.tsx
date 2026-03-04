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
} from "lucide-react";
import {
  getDatabase,
  getInstanceHealth,
  updateDatabase,
  updateCredentials,
  deactivateDatabase,
  reactivateDatabase,
  deleteDatabase,
} from "@/lib/api";
import type { DatabaseInstance, InstanceHealth, Environment } from "@/lib/types";
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

export default function DatabaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [instance, setInstance] = useState<DatabaseInstance | null>(null);
  const [health, setHealth] = useState<InstanceHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
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

  useEffect(() => {
    fetchInstance();
    fetchHealth();
  }, [fetchInstance, fetchHealth]);

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

      {/* Health card */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Health Check</h2>
          <button
            onClick={fetchHealth}
            className="p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${healthLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {health ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-4 rounded-lg border border-border">
              {health.health.status === "up" ? (
                <CheckCircle className="w-8 h-8 text-success" />
              ) : (
                <XCircle className="w-8 h-8 text-danger" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">Connection</p>
                <StatusBadge status={health.health.status} />
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg border border-border">
              <Activity className="w-8 h-8 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">Latency</p>
                <p className="text-2xl font-bold text-foreground">
                  {health.health.latencyMs}
                  <span className="text-sm text-muted ml-1">ms</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg border border-border">
              <Server className="w-8 h-8 text-info" />
              <div>
                <p className="text-sm font-medium text-foreground">Consecutive Failures</p>
                <p className="text-2xl font-bold text-foreground">
                  {instance.consecutive_failures}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Running health check...</p>
        )}
      </Card>

      {/* Details grid */}
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
