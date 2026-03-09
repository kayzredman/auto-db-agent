"use client";
// Helper constants and components
const riskIcons: Record<FRARisk, typeof Shield> = {
  CRITICAL: AlertTriangle,
  HIGH: AlertTriangle,
  WARNING: AlertTriangle,
  OK: CheckCircle,
};

const riskColors: Record<FRARisk, string> = {
  CRITICAL: "border-danger text-danger bg-danger/10",
  HIGH: "border-warning text-warning bg-warning/10",
  WARNING: "border-yellow-400 text-yellow-700 bg-yellow-100",
  OK: "border-success text-success bg-success/10",
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


export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val < 10 ? 2 : 1)} ${units[i]}`;
}

function RiskBadge({ risk }: { risk: FRARisk }) {
  if (!risk) return null;
  const Icon = riskIcons[risk as FRARisk];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${riskColors[risk as FRARisk]}`}
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
import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  HardDrive,
  Activity,
  Zap,
  Shield,
  XCircle,
  CheckCircle,
  Camera
} from "lucide-react";
import { Card, Button, Spinner } from "@/components/ui";
import { listDatabases, getFRARisk } from "@/lib/api";
import {
  DatabaseInstance,
  FRARiskReport,
  FRARisk,
  FRARiskIssue,
  FRARiskRecommendation
} from "@/lib/types";
// --- Main FRAAnalysisPage ---
export default function FRAAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [instances, setInstances] = useState<DatabaseInstance[]>([]);
  const [prodInstance, setProdInstance] = useState<DatabaseInstance | null>(null);
  const [drInstance, setDrInstance] = useState<DatabaseInstance | null>(null);
  const [prodReport, setProdReport] = useState<FRARiskReport | null>(null);
  const [drReport, setDrReport] = useState<FRARiskReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Find the prod/dr pair for this id
  const findProdDrPair = useCallback((all: DatabaseInstance[], currentId: string) => {
    const current = all.find((db) => db.id === currentId);
    if (!current) return { prod: null, dr: null };
    if (current.environment === "production") {
      const dr = all.find((db) => db.environment === "dr" && db.name === current.name);
      return { prod: current, dr };
    } else if (current.environment === "dr") {
      const prod = all.find((db) => db.environment === "production" && db.name === current.name);
      return { prod, dr: current };
    }
    return { prod: null, dr: null };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dbsResp = await listDatabases();
      const dbs = Array.isArray(dbsResp) ? dbsResp : dbsResp.instances || [];
      setInstances(dbs);
      const { prod, dr } = findProdDrPair(dbs, id);
      setProdInstance(prod ?? null);
      setDrInstance(dr ?? null);
      if (prod) setProdReport(await getFRARisk(prod.id));
      if (dr) setDrReport(await getFRARisk(dr.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load FRA risk data");
    } finally {
      setLoading(false);
    }
  }, [id, findProdDrPair]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner />
      </div>
    );
  }

  if (error || (!prodInstance && !drInstance)) {
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

  // Helper to render a full FRA section for a given instance/report
  function renderFRASection(label: string, instance: DatabaseInstance | null, report: FRARiskReport | null) {
    return (
      <div className="space-y-6 border-b border-border pb-10 mb-10">
        {/* Section Header */}
        <div className="flex items-center gap-4 mb-2">
          <Shield className="w-5 h-5 text-info" />
          <h1 className="text-xl font-bold text-primary">
            {label} FRA Risk Analysis
          </h1>
          <RiskBadge risk={report?.overallRisk as FRARisk} />
        </div>
        <p className="text-sm text-muted mt-0.5 mb-2">
          {instance?.display_name ?? instance?.name} &middot; {dbTypeLabels[instance?.db_type ?? ""] ?? instance?.db_type}
        </p>
        {/* Risk Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["CRITICAL", "HIGH", "WARNING", "OK"] as const).map((level: FRARisk, idx: number) => {
            const Icon = riskIcons[level];
            return (
              <Card key={level + idx} className={`p-4 border ${riskColors[level]}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase">{level}</span>
                </div>
                <p className="text-2xl font-bold">{report?.issues?.filter((i) => i.severity === level).length ?? 0}</p>
              </Card>
            );
          })}
        </div>
        {/* Recovery Area (always show) */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="w-4 h-4 text-info" />
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
              Recovery Area — {report?.recoveryArea?.name ?? "N/A"}
            </h2>
          </div>
          {report?.recoveryArea ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <UsageBar
                    used={report.recoveryArea?.usedBytes ?? 0}
                    total={report.recoveryArea?.totalBytes ?? 0}
                    label="Used Space"
                  />
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-muted">
                    <div>
                      <p>Used</p>
                      <p className="text-primary font-medium">{formatBytes(report.recoveryArea?.usedBytes ?? 0)}</p>
                    </div>
                    <div>
                      <p>Total</p>
                      <p className="text-primary font-medium">{formatBytes(report.recoveryArea?.totalBytes ?? 0)}</p>
                    </div>
                  </div>
                </div>
                <div className="text-xs space-y-2">
                  <div>
                    <p className="text-muted">Reclaimable</p>
                    <p className="text-primary font-medium text-lg">
                      {formatBytes(report.recoveryArea?.reclaimableBytes ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted">Effective Free</p>
                    <p className="text-primary font-medium text-lg">
                      {formatBytes(report.recoveryArea?.effectiveFreeBytes ?? 0)}
                    </p>
                  </div>
                </div>
                <div className="text-xs space-y-2">
                  <div>
                    <p className="text-muted">Usage</p>
                    <p
                      className={`font-bold text-2xl ${
                        (report.recoveryArea?.usedPercent ?? 0) >= 90
                          ? "text-danger"
                          : (report.recoveryArea?.usedPercent ?? 0) >= 80
                          ? "text-warning"
                          : "text-success"
                      }`}
                    >
                      {(report.recoveryArea?.usedPercent ?? 0).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center text-muted text-sm">No recovery area data available.</div>
          )}
        </Card>
        {/* Archive Generation (always show) */}
        <Card className="p-5">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-info" />
              <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
                Archive / Log Generation
              </h2>
            </div>
            {report?.archiveGeneration ? (
              <div>
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
                {report.archiveGeneration.dailyBreakdown && report.archiveGeneration.dailyBreakdown.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs text-muted mb-2">Daily Generation</p>
                    <div className="flex items-end gap-1 h-20">
                      {(() => {
                        const maxGen = Math.max(...report.archiveGeneration.dailyBreakdown.map((d) => d.generationBytes));
                        return report.archiveGeneration.dailyBreakdown.map((day, i) => {
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
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-muted text-sm">No archive/log generation data available.</div>
            )}
          </div>
        </Card>
        {/* Flashback (always show) */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-info" />
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
              Flashback
            </h2>
          </div>
          {report?.flashback ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs text-muted mb-1">Enabled</p>
                  <p className="text-lg font-bold text-primary">
                    {report.flashback.enabled ? "Yes" : "No"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">Retention</p>
                  <p className="text-lg font-bold text-primary">
                    {report.flashback.retentionMinutes} min
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">Oldest Time</p>
                  <p className="text-lg font-bold text-primary">
                    {report.flashback.oldestFlashbackTime ?? "N/A"}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-xs text-muted mb-1">Estimated Space</p>
                <p className="text-lg font-bold text-primary">
                  {formatBytes(report.flashback.estimatedSpaceBytes)}
                </p>
              </div>
            </>
          ) : (
            <div className="text-center text-muted text-sm">No flashback data available.</div>
          )}
        </Card>
        {/* Issues (always show) */}
        <div>
          <h3 className="text-base font-semibold text-primary mb-2 mt-6 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" /> Issues
          </h3>
          {report?.issues && report.issues.length > 0 ? (
            <div className="grid gap-3">
              {report.issues.map((issue, idx) => (
                <IssueCard key={issue.code + idx} issue={issue} />
              ))}
            </div>
          ) : (
            <div className="text-muted text-sm">No issues detected.</div>
          )}
        </div>
        {/* Recommendations (always show) */}
        <div>
          <h3 className="text-base font-semibold text-primary mb-2 mt-6 flex items-center gap-2">
            <Camera className="w-4 h-4 text-info" /> Recommendations
          </h3>
          {report?.recommendations && report.recommendations.length > 0 ? (
            <div className="grid gap-3">
              {report.recommendations.map((rec, idx) => (
                <RecommendationCard key={rec.title + idx} rec={rec} />
              ))}
            </div>
          ) : (
            <div className="text-muted text-sm">No recommendations.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8">
      {/* Always show PROD first, then DR if available */}
      {renderFRASection("PROD", prodInstance, prodReport)}
      {drInstance && drReport && renderFRASection("DR", drInstance, drReport)}
    </div>
  );
}
