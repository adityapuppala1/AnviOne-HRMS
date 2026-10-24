import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  brandingSchema,
  meSchema,
  dashboardSchema,
  directorySchema,
  employeeSchema,
  auditSchema,
  authConfigSchema,
} from "@anvi/contracts";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      title?: string;
    } | null;
    throw new ApiError(
      error?.title ?? "The service could not be reached. Try again.",
      response.status,
    );
  }
  return schema.parse(await response.json());
}
export const useMe = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: () => api("/me", meSchema),
    staleTime: 0,
  });
export const useBranding = () =>
  useQuery({
    queryKey: ["branding"],
    queryFn: () => api("/branding/active", brandingSchema),
  });
export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api("/dashboard", dashboardSchema),
  });
export const useDirectory = (query: string) =>
  useQuery({
    queryKey: ["directory", query],
    queryFn: () => api(`/employees?${query}`, directorySchema),
  });
export const useEmployee = (id: string) =>
  useQuery({
    queryKey: ["employee", id],
    queryFn: () => api(`/employees/${encodeURIComponent(id)}`, employeeSchema),
  });
export const useAudit = () =>
  useQuery({
    queryKey: ["audit"],
    queryFn: () => api("/audit-events", auditSchema),
  });
export const useAuthConfig = () =>
  useQuery({
    queryKey: ["auth-config"],
    queryFn: () => api("/auth/config", authConfigSchema),
  });
export const mutate = (
  path: string,
  csrfToken: string,
  body?: unknown,
  method = "POST",
) =>
  api(path, z.unknown(), {
    method,
    headers: { "X-CSRF-Token": csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
