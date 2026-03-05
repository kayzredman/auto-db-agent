"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Camera,
  Shield,
  Database,
  Activity,
  HardDrive,
  Zap,
} from "lucide-react";
import {
  getDatabase,
  getFRARisk,
  recordFRASnapshot,
} from "@/lib/api";
import type {
  DatabaseInstance,
  FRARiskReport,
  FRARisk,
  FRARiskIssue,
  FRARiskRecommendation,
} from "@/lib/types";
import { Card, Button, Spinner, StatusBadge } from "@/components/ui";

const riskColors: Record<FRARisk, string> = {
  CRITICAL: "bg-danger/15 text-danger border-danger/30",
  HIGH: "bg-warning/15 text-warning border-warning/30",
  WARNING: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  OK: "bg-success/15 text-success border-success/30",
};

const riskIcons: Record<FRARisk, typeof AlertTriangle> = {
  CRITICAL: XCircle,
  HIGH: AlertTriangle,
  WARNING: Clock,
  OK: CheckCircle,
};

const categoryIcons: Record<string, typeof Shield> = {
  "Recovery Area": HardDrive,
  "Archive Generation": Activity,
  "Flashback": Zap,
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
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val < 10 ? 2 : 1)} ${units[i]}`;
}

function RiskBadge({ risk }: { risk: FRARisk }) {
  const Icon = riskIcons[risk];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${riskColors[risk]}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {risk}
    </span>
  );
}

function UsageBar({ used, total, label }: { used: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const barColor =
    pct >= 90 ? "bg-danger" : pct >= 80 ? "bg-warning" : pct >= 60 ? "bg-yellow-400" : "bg-success";

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-xs text-muted mb-1">
          <span>{label}</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
      )}
      <div className="w-full h-2.5 bg-surface-hover rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function IssueCard({ issue }: { issue: FRARiskIssue }) {
  const CatIcon = categoryIcons[issue.category] ?? Shield;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <CatIcon className="w-4 h-4 text-muted" />
          <span className="text-xs text-muted font-medium uppercase tracking-wide">
            {issue.category}
          </span>
        </div>
        <RiskBadge risk={issue.severity} />
      </div>
      <p className="text-sm text-primary mb-3">{issue.message}</p>
      <div className="flex items-center gap-4 text-xs text-muted">
        <span>Current: <span className="text-primary font-medium">{issue.currentValue}</span></span>
        <span>Threshold: <span className="text-primary font-medium">{issue.threshold}</span></span>
        <span className="ml-auto">{issue.code}</span>
      </div>
    </Card>
  );
}

function RecommendationCard({ rec }: { rec: FRARiskRecommendation }) {
  const priorityColors: Record<string, string> = {
    HIGH: "border-l-danger",
    MEDIUM: "border-l-warning",
    LOW: "border-l-info",
  };
  return (
    <Card className={`p-4 border-l-4 ${priorityColors[rec.priority] ?? "border-l-muted"}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="text-sm font-semibold text-primary">{rec.title}</h4>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            rec.priority === "HIGH"
              ? "bg-danger/15 text-danger"
              : rec.priority === "MEDIUM"
              ? "bg-warning/15 text-warning"
              : "bg-info/15 text-info"
          }`}
        >
          {rec.priority}
        </span>
      </div>
      <p className="text-xs text-muted mb-2">{rec.description}</p>
      <div className="bg-surface-hover rounded-lg p-3 mb-2">
        <p className="text-xs text-primary font-medium mb-1">Recommended Action</p>
        <p className="text-xs text-muted">{rec.action}</p>
      </div>
      <p className="text-[11px] text-muted/70 italic">{rec.reference}</p>
    </Card>
  );
}

export default function FRARiskPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [instance, setInstance] = useState<DatabaseInstance | null>(null);
  const [report, setReport] = useState<FRARiskReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [inst, riskReport] = await Promise.all([
        getDatabase(id),
        getFRARisk(id),
      ]);
      setInstance(inst);
      setReport(riskReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load FRA risk data");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const handleSnapshot = async () => {
    try {
      setSnapshotLoading(true);
      const result = await recordFRASnapshot(id);
      if (result.success) {
        showToast("success", `FRA snapshot recorded for ${result.snapshotDate}`);
        void load();
      } else {
        showToast("error", "No recovery area data available to record");
      }
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to record snapshot");
    } finally {
      setSnapshotLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !instance || !report) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-muted hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <Card className="p-8 text-center">
          <XCircle className="w-12 h-12 text-danger mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-primary mb-2">Error</h2>
          <p className="text-muted mb-4">{error ?? "Failed to load FRA risk data"}</p>
          <Button onClick={load}>
            <RefreshCw className="w-4 h-4" /> Try Again
          </Button>
        </Card>
      </div>
    );
  }

  const issueCounts = { CRITICAL: 0, HIGH: 0, WARNING: 0, OK: 0 };
  for (const issue of report.issues) {
    issueCounts[issue.severity]++;
  }
  if (report.issues.length === 0) issueCounts.OK = 1;

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
            toast.type === "success"
              ? "bg-success/20 text-success border border-success/30"
              : "bg-danger/20 text-danger border border-danger/30"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/databases/${id}`)}
            className="flex items-center gap-2 text-muted hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-info" />
              <h1 className="text-xl font-bold text-primary">
                FRA Risk Analysis
              </h1>
              <RiskBadge risk={report.overallRisk} />
            </div>
            <p className="text-sm text-muted mt-0.5">
              {instance.display_name ?? instance.name} &middot;{" "}
              {dbTypeLabels[instance.db_type] ?? instance.db_type}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleSnapshot} disabled={snapshotLoading}>
            <Camera className="w-3.5 h-3.5" />
            {snapshotLoading ? "Recording…" : "Snapshot"}
          </Button>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Risk Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["CRITICAL", "HIGH", "WARNING", "OK"] as const).map((level) => {
          const Icon = riskIcons[level];
          return (
            <Card key={level} className={`p-4 border ${riskColors[level]}`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase">{level}</span>
              </div>
              <p className="text-2xl font-bold">{issueCounts[level]}</p>
            </Card>
          );
        })}
      </div>

      {/* Recovery Area */}
      {report.recoveryArea && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="w-4 h-4 text-info" />
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
              Recovery Area — {report.recoveryArea.name}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <UsageBar
                used={report.recoveryArea.usedBytes}
                total={report.recoveryArea.totalBytes}
                label="Used Space"
              />
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-muted">
                <div>
                  <p>Used</p>
                  <p className="text-primary font-medium">{formatBytes(report.recoveryArea.usedBytes)}</p>
                </div>
                <div>
                  <p>Total</p>
                  <p className="text-primary font-medium">{formatBytes(report.recoveryArea.totalBytes)}</p>
                </div>
              </div>
            </div>
            <div className="text-xs space-y-2">
              <div>
                <p className="text-muted">Reclaimable</p>
                <p className="text-primary font-medium text-lg">
                  {formatBytes(report.recoveryArea.reclaimableBytes)}
                </p>
              </div>
              <div>
                <p className="text-muted">Effective Free</p>
                <p className="text-primary font-medium text-lg">
                  {formatBytes(report.recoveryArea.effectiveFreeBytes)}
                </p>
              </div>
            </div>
            <div className="text-xs space-y-2">
              <div>
                <p className="text-muted">Usage</p>
                <p
                  className={`font-bold text-2xl ${
                    report.recoveryArea.usedPercent >= 90
                      ? "text-danger"
                      : report.recoveryArea.usedPercent >= 80
                      ? "text-warning"
                      : "text-success"
                  }`}
                >
                  {report.recoveryArea.usedPercent.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Archive Generation */}
      {report.archiveGeneration && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-info" />
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
              Archive / Log Generation
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-xs text-muted mb-1">Avg Daily</p>
              <p className="text-lg font-bold text-primary">
                {formatBytes(report.archiveGeneration.avgDailyGenerationBytes)}
              </p>
              <p className="text-[11px] text-muted">
                over {report.archiveGeneration.analysisDays} days
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted mb-1">Today</p>
              <p className="text-lg font-bold text-primary">
                {formatBytes(report.archiveGeneration.todayGenerationBytes)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted mb-1">Deviation</p>
              <p
                className={`text-lg font-bold ${
                  report.archiveGeneration.deviationPercent >= 60
                    ? "text-danger"
                    : report.archiveGeneration.deviationPercent >= 30
                    ? "text-warning"
                    : "text-success"
                }`}
              >
                {report.archiveGeneration.deviationPercent > 0 ? "+" : ""}
                {report.archiveGeneration.deviationPercent.toFixed(1)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted mb-1">Data Points</p>
              <p className="text-lg font-bold text-primary">
                {report.archiveGeneration.dailyBreakdown.length}
              </p>
            </div>
          </div>

          {/* Daily breakdown mini-chart (bar chart using divs) */}
          {report.archiveGeneration.dailyBreakdown.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted mb-2">Daily Generation</p>
              <div className="flex items-end gap-1 h-20">
                {report.archiveGeneration.dailyBreakdown.map((day, i) => {
                  const maxGen = Math.max(
                    ...report.archiveGeneration!.dailyBreakdown.map((d) => d.generationBytes)
                  );
                  const pct = maxGen > 0 ? (day.generationBytes / maxGen) * 100 : 0;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-info/30 hover:bg-info/50 rounded-t transition-colors relative group"
                      style={{ height: `${Math.max(pct, 4)}%` }}
                    >
                      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-surface border border-border rounded px-2 py-1 text-[10px] text-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {formatBytes(day.generationBytes)}
                        <br />
                        {new Date(day.date).toLocaleDateString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Flashback (Oracle only) */}
      {report.flashback && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-info" />
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
              Flashback Database
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-xs text-muted mb-1">Status</p>
              <p
                className={`text-lg font-bold ${
                  report.flashback.enabled ? "text-success" : "text-muted"
                }`}
              >
                {report.flashback.enabled ? "Enabled" : "Disabled"}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted mb-1">Retention Target</p>
              <p className="text-lg font-bold text-primary">
                {report.flashback.retentionMinutes > 0
                  ? `${(report.flashback.retentionMinutes / 60).toFixed(1)}h`
                  : "N/A"}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted mb-1">Oldest Flashback</p>
              <p className="text-sm font-medium text-primary">
                {report.flashback.oldestFlashbackTime
                  ? new Date(report.flashback.oldestFlashbackTime).toLocaleString()
                  : "N/A"}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted mb-1">Est. Space</p>
              <p className="text-lg font-bold text-primary">
                {formatBytes(report.flashback.estimatedSpaceBytes)}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* No recovery area data */}
      {!report.recoveryArea && !report.archiveGeneration && (
        <Card className="p-8 text-center">
          <Database className="w-12 h-12 text-muted/50 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-primary mb-2">No Recovery Area Data</h3>
          <p className="text-sm text-muted">
            Recovery area metrics are not available for this instance. This may be normal for{" "}
            {dbTypeLabels[report.dbType] ?? report.dbType} databases without FRA configured.
          </p>
        </Card>
      )}

      {/* Issues */}
      {report.issues.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            Issues Detected ({report.issues.length})
          </h2>
          <div className="space-y-3">
            {report.issues.map((issue, i) => (
              <IssueCard key={i} issue={issue} />
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-info" />
            Recommendations ({report.recommendations.length})
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {report.recommendations.map((rec, i) => (
              <RecommendationCard key={i} rec={rec} />
            ))}
          </div>
        </div>
      )}

      {/* All Clear */}
      {report.issues.length === 0 && (
        <Card className="p-8 text-center border border-success/30 bg-success/5">
          <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-primary mb-2">All Clear</h3>
          <p className="text-sm text-muted">
            No recovery area risk issues detected. Continue monitoring with daily snapshots.
          </p>
        </Card>
      )}

      {/* Analysis metadata */}
      <p className="text-xs text-muted text-center">
        Analyzed at {new Date(report.analyzedAt).toLocaleString()} &middot; OEM-aligned thresholds
      </p>
    </div>
  );
}
