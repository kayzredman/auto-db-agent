import type {
  DatabaseInstance,
  HealthSummary,
  InstanceHealth,
  OnboardPayload,
  UpdatePayload,
  CredentialsPayload,
  ListFilters,
} from "./types";

const BASE = "";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": "ui-admin",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as Record<string, string>).error ??
        (body as Record<string, string>).message ??
        `Request failed: ${res.status}`
    );
  }
  return res.json() as Promise<T>;
}

// ── Health ──

export async function getAppHealth(): Promise<{ status: string; checkedAt: string }> {
  return request("/health");
}

export async function getDatabaseHealth(): Promise<HealthSummary> {
  return request("/health/databases");
}

export async function getInstanceHealth(
  id: string
): Promise<InstanceHealth> {
  return request(`/api/databases/${id}/health`);
}

// ── Databases CRUD ──

export async function listDatabases(
  filters?: ListFilters
): Promise<{ instances: DatabaseInstance[]; count: number }> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
  }
  const qs = params.toString();
  return request(`/api/databases${qs ? `?${qs}` : ""}`);
}

export async function getDatabase(id: string): Promise<DatabaseInstance> {
  return request(`/api/databases/${id}`);
}

export async function onboardDatabase(
  payload: OnboardPayload
): Promise<{ success: boolean; instanceId: string; message: string }> {
  return request("/api/databases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateDatabase(
  id: string,
  payload: UpdatePayload
): Promise<{ success: boolean; message: string }> {
  return request(`/api/databases/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function updateCredentials(
  id: string,
  payload: CredentialsPayload
): Promise<{ success: boolean; message: string }> {
  return request(`/api/databases/${id}/credentials`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deactivateDatabase(
  id: string
): Promise<{ success: boolean; message: string }> {
  return request(`/api/databases/${id}/deactivate`, { method: "POST" });
}

export async function reactivateDatabase(
  id: string
): Promise<{ success: boolean; message: string }> {
  return request(`/api/databases/${id}/reactivate`, { method: "POST" });
}

export async function deleteDatabase(
  id: string
): Promise<{ success: boolean; message: string }> {
  return request(`/api/databases/${id}`, { method: "DELETE" });
}
