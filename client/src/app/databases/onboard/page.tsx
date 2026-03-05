"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Database,
  Server,
  Key,
  Settings,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { onboardDatabase } from "@/lib/api";
import type { DbType, Environment, OracleRole } from "@/lib/types";
import { Card, Button } from "@/components/ui";

interface FormState {
  name: string;
  dbType: DbType;
  environment: Environment;
  host: string;
  port: string;
  databaseName: string;
  username: string;
  password: string;
  role: OracleRole;
  displayName: string;
  application: string;
  team: string;
  ownerEmail: string;
  poolMin: string;
  poolMax: string;
}

const initialForm: FormState = {
  name: "",
  dbType: "postgres",
  environment: "development",
  host: "",
  port: "5432",
  databaseName: "",
  username: "",
  password: "",
  role: "default",
  displayName: "",
  application: "",
  team: "",
  ownerEmail: "",
  poolMin: "1",
  poolMax: "10",
};

const defaultPorts: Record<DbType, string> = {
  postgres: "5432",
  mysql: "3306",
  mssql: "1433",
  oracle: "1521",
};

export default function OnboardPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    instanceId?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  const update = (key: keyof FormState, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "dbType") {
        next.port = defaultPorts[value as DbType];
      }
      // Auto-select SYSDBA when Oracle SYS user is entered
      if (key === "username" && next.dbType === "oracle") {
        if (value.toUpperCase() === "SYS" && next.role === "default") {
          next.role = "sysdba";
        }
      }
      if (key === "dbType" && value === "oracle" && next.username.toUpperCase() === "SYS" && next.role === "default") {
        next.role = "sysdba";
      }
      return next;
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        dbType: form.dbType,
        environment: form.environment,
        host: form.host,
        port: parseInt(form.port, 10),
        databaseName: form.databaseName,
        username: form.username,
        password: form.password,
      };
      if (form.displayName) payload.displayName = form.displayName;
      if (form.application) payload.application = form.application;
      if (form.team) payload.team = form.team;
      if (form.ownerEmail) payload.ownerEmail = form.ownerEmail;
      if (form.poolMin) payload.poolMin = parseInt(form.poolMin, 10);
      if (form.poolMax) payload.poolMax = parseInt(form.poolMax, 10);

      // Pass Oracle role via additionalOptions
      if (form.dbType === "oracle" && form.role && form.role !== "default") {
        payload.additionalOptions = { role: form.role };
      }

      const res = await onboardDatabase(payload as unknown as Parameters<typeof onboardDatabase>[0]);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onboarding failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Step validation
  const step1Valid = form.name && form.host && form.port && form.databaseName;
  const step2Valid = form.username && form.password;

  if (result?.success) {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <Card className="text-center">
          <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">
            Database Onboarded!
          </h2>
          <p className="text-sm text-muted mb-6">{result.message}</p>
          <div className="flex justify-center gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setResult(null);
                setForm(initialForm);
                setStep(1);
              }}
            >
              Onboard Another
            </Button>
            <Button onClick={() => router.push(`/databases/${result.instanceId}`)}>
              <Database className="w-4 h-4" /> View Instance
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push("/databases")}
          className="p-2 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Onboard Database
          </h1>
          <p className="text-sm text-muted mt-1">
            Register a new database instance for monitoring
          </p>
        </div>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[
          { num: 1, label: "Connection", icon: Server },
          { num: 2, label: "Credentials", icon: Key },
          { num: 3, label: "Options", icon: Settings },
        ].map(({ num, label, icon: Icon }) => (
          <button
            key={num}
            onClick={() => {
              if (num < step) setStep(num);
              if (num === 2 && step1Valid) setStep(2);
              if (num === 3 && step1Valid && step2Valid) setStep(3);
            }}
            className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
              step === num
                ? "border-primary bg-primary/10 text-primary"
                : step > num
                ? "border-success/30 bg-success/5 text-success"
                : "border-border text-muted"
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="text-sm font-medium hidden sm:inline">
              {label}
            </span>
            <span className="text-xs sm:hidden">{num}</span>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Step 1: Connection */}
        {step === 1 && (
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              Connection Details
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted mb-1">
                  Instance Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="e.g. prod-orders-db"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:border-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">
                  Database Type *
                </label>
                <select
                  value={form.dbType}
                  onChange={(e) => update("dbType", e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mssql">SQL Server</option>
                  <option value="oracle">Oracle</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm text-muted mb-1">Host *</label>
                <input
                  type="text"
                  value={form.host}
                  onChange={(e) => update("host", e.target.value)}
                  placeholder="hostname or IP"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:border-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">Port *</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => update("port", e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted mb-1">
                  Database Name *
                </label>
                <input
                  type="text"
                  value={form.databaseName}
                  onChange={(e) => update("databaseName", e.target.value)}
                  placeholder="e.g. orders"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:border-primary"
                  required
                />
                {form.engine !== "oracle" && (
                  <p className="text-xs text-muted mt-1">
                    Used for the initial connection. All databases on this instance will be discovered automatically.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">
                  Environment *
                </label>
                <select
                  value={form.environment}
                  onChange={(e) => update("environment", e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="development">Development</option>
                  <option value="dr">DR</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={() => setStep(2)}
                disabled={!step1Valid}
                type="button"
              >
                Next: Credentials
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Credentials */}
        {step === 2 && (
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              Authentication
            </h2>
            <p className="text-sm text-muted">
              Credentials are encrypted with AES-256-GCM before storage.
            </p>

            <div>
              <label className="block text-sm text-muted mb-1">
                Username *
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => update("username", e.target.value)}
                placeholder="Database username"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:border-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">
                Password *
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                placeholder="Database password"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:border-primary"
                required
              />
            </div>

            {/* Oracle-specific role selector */}
            {form.dbType === "oracle" && (
              <div>
                <label className="block text-sm text-muted mb-1">
                  Connection Role
                </label>
                <select
                  value={form.role}
                  onChange={(e) => update("role", e.target.value)}
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
                  Use SYSDBA for SYS user connections. Leave as Default for regular users.
                </p>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)} type="button">
                Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!step2Valid}
                type="button"
              >
                Next: Options
              </Button>
            </div>
          </Card>
        )}

        {/* Step 3: Optional settings */}
        {step === 3 && (
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              Optional Settings
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => update("displayName", e.target.value)}
                  placeholder="Human-friendly name"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">
                  Application
                </label>
                <input
                  type="text"
                  value={form.application}
                  onChange={(e) => update("application", e.target.value)}
                  placeholder="e.g. OrderService"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted mb-1">Team</label>
                <input
                  type="text"
                  value={form.team}
                  onChange={(e) => update("team", e.target.value)}
                  placeholder="e.g. Platform"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">
                  Owner Email
                </label>
                <input
                  type="email"
                  value={form.ownerEmail}
                  onChange={(e) => update("ownerEmail", e.target.value)}
                  placeholder="owner@company.com"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted mb-1">
                  Pool Min
                </label>
                <input
                  type="number"
                  value={form.poolMin}
                  onChange={(e) => update("poolMin", e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">
                  Pool Max
                </label>
                <input
                  type="number"
                  value={form.poolMax}
                  onChange={(e) => update("poolMax", e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(2)} type="button">
                Back
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Connecting...
                  </>
                ) : (
                  <>
                    <Database className="w-4 h-4" /> Onboard Database
                  </>
                )}
              </Button>
            </div>
          </Card>
        )}
      </form>
    </div>
  );
}
