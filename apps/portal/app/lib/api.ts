import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { isIdle, markTouched } from "./activity";
import {
  brandingSchema,
  meSchema,
  dashboardSchema,
  directorySchema,
  employeeSchema,
  auditSchema,
  authConfigSchema,
  organizationDirectorySchema,
  assignedTaskListSchema,
  leaveOverviewSchema,
  leaveApprovalsSchema,
  attendanceOverviewSchema,
  attendanceTeamSchema,
  calendarSchema,
  approvalInboxSchema,
  insightsSchema,
  updatesSchema,
  documentListSchema,
  documentReviewSchema,
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
  // Reads made while nobody is touching the screen are background polling.
  // The server still checks the session but does not count them as activity.
  const background =
    (options?.method ?? "GET").toUpperCase() === "GET" && isIdle();
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(background ? { "X-Anvi-Idle": "1" } : {}),
      ...options?.headers,
    },
  });
  if (response.ok && !background) markTouched();
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
// Tells the server the person is still here. False means the session has ended.
export async function heartbeat() {
  try {
    const response = await fetch("/api/v1/me", { credentials: "same-origin" });
    if (response.ok) markTouched();
    return response.ok;
  } catch {
    // Offline is not a sign-out; the next attempt will find out.
    return true;
  }
}
export const useMe = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => api("/me", meSchema, { signal }),
    staleTime: 0,
  });
export const useBranding = () =>
  useQuery({
    queryKey: ["branding"],
    queryFn: ({ signal }) =>
      api("/branding/active", brandingSchema, { signal }),
  });
export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard"],
    queryFn: ({ signal }) => api("/dashboard", dashboardSchema, { signal }),
  });
export const useDirectory = (query: string) =>
  useQuery({
    queryKey: ["directory", query],
    queryFn: ({ signal }) =>
      api(`/employees?${query}`, directorySchema, { signal }),
  });
export const useEmployee = (id: string) =>
  useQuery({
    queryKey: ["employee", id],
    queryFn: ({ signal }) =>
      api(`/employees/${encodeURIComponent(id)}`, employeeSchema, { signal }),
  });
export const useAudit = () =>
  useQuery({
    queryKey: ["audit"],
    queryFn: ({ signal }) => api("/audit-events", auditSchema, { signal }),
  });
export const useAuthConfig = () =>
  useQuery({
    queryKey: ["auth-config"],
    staleTime: 60000,
    queryFn: ({ signal }) => api("/auth/config", authConfigSchema, { signal }),
  });
export const useOrganization = (query: string) =>
  useQuery({
    queryKey: ["organization", query],
    queryFn: ({ signal }) =>
      api(`/organization?${query}`, organizationDirectorySchema, { signal }),
  });
export const useAssignedTasks = () =>
  useQuery({
    queryKey: ["assigned-onboarding-tasks"],
    queryFn: ({ signal }) =>
      api("/onboarding/tasks", assignedTaskListSchema, { signal }),
  });
export const useLeave = (enabled: boolean) =>
  useQuery({
    queryKey: ["leave", "mine"],
    enabled,
    queryFn: ({ signal }) => api("/leave", leaveOverviewSchema, { signal }),
  });
export const useLeaveApprovals = (enabled: boolean) =>
  useQuery({
    queryKey: ["leave", "approvals"],
    enabled,
    queryFn: ({ signal }) =>
      api("/leave/approvals", leaveApprovalsSchema, { signal }),
  });
export const useAttendance = (enabled: boolean) =>
  useQuery({
    queryKey: ["attendance", "mine"],
    enabled,
    refetchInterval: 60000,
    queryFn: ({ signal }) =>
      api("/attendance", attendanceOverviewSchema, { signal }),
  });
export const useAttendanceTeam = (enabled: boolean) =>
  useQuery({
    queryKey: ["attendance", "team"],
    enabled,
    refetchInterval: 60000,
    queryFn: ({ signal }) =>
      api("/attendance/team", attendanceTeamSchema, { signal }),
  });
export const useCalendar = (year: number | null) =>
  useQuery({
    queryKey: ["calendar", year],
    queryFn: ({ signal }) =>
      api(`/calendar${year ? `?year=${year}` : ""}`, calendarSchema, {
        signal,
      }),
  });
export const useUpdates = () =>
  useQuery({
    queryKey: ["updates"],
    refetchInterval: 60000,
    queryFn: ({ signal }) => api("/updates", updatesSchema, { signal }),
  });
export const useInsights = (enabled: boolean) =>
  useQuery({
    queryKey: ["insights"],
    enabled,
    staleTime: 60000,
    queryFn: ({ signal }) => api("/insights", insightsSchema, { signal }),
  });
export const useApprovals = (enabled: boolean) =>
  useQuery({
    queryKey: ["approvals"],
    enabled,
    refetchInterval: 60000,
    queryFn: ({ signal }) => api("/approvals", approvalInboxSchema, { signal }),
  });
export const useDocuments = (enabled: boolean) =>
  useQuery({
    queryKey: ["documents", "mine"],
    enabled,
    queryFn: ({ signal }) => api("/documents", documentListSchema, { signal }),
  });
export const useDocumentReview = (enabled: boolean) =>
  useQuery({
    queryKey: ["documents", "review"],
    enabled,
    queryFn: ({ signal }) =>
      api("/documents/review", documentReviewSchema, { signal }),
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
