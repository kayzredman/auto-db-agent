import { type ReactNode } from "react";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const colorMap: Record<string, string> = {
  up: "bg-success/15 text-success",
  active: "bg-success/15 text-success",
  down: "bg-danger/15 text-danger",
  inactive: "bg-warning/15 text-warning",
  decommissioned: "bg-muted/15 text-muted",
  degraded: "bg-warning/15 text-warning",
  healthy: "bg-success/15 text-success",
};

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const colors = colorMap[status.toLowerCase()] ?? "bg-muted/15 text-muted";
  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${colors} ${sizeClasses}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`bg-surface rounded-xl border border-border p-6 ${className}`}>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  color?: string;
}

export function StatCard({ label, value, icon, color = "text-primary" }: StatCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-lg bg-surface-hover ${color}`}>{icon}</div>
      </div>
    </Card>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "danger" | "ghost" | "success" | "warning";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}

const variantClasses: Record<string, string> = {
  primary: "bg-primary hover:bg-primary-hover text-white",
  danger: "bg-danger/15 hover:bg-danger/25 text-danger",
  success: "bg-success/15 hover:bg-success/25 text-success",
  warning: "bg-warning/15 hover:bg-warning/25 text-warning",
  ghost: "bg-transparent hover:bg-surface-hover text-muted hover:text-foreground",
};

const sizeClasses: Record<string, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled = false,
  type = "button",
  className = "",
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </button>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-xl p-6 w-full max-w-md shadow-xl">
        <h3 className="text-lg font-semibold text-foreground mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function EmptyState({
  message,
  icon,
}: {
  message: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted">
      <div className="p-4 bg-surface-hover rounded-full mb-4">{icon}</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}
