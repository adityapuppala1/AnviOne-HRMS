import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { isIdle, markTouched } from "./activity";
import {
  brandingSchema,
  meSchema,
  dashboardSchema,
  directorySchema,
  employeeDetailSchema,
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
  assetDetailSchema,
  assetListSchema,
  myAssetsSchema,
  myPoliciesSchema,
  exitDetailSchema,
  expenseCategoryListSchema,
  expenseClaimSchema,
  expenseListSchema,
  myExpensesSchema,
  brandingHistorySchema,
  integrationReadinessSchema,
  myTimeSchema,
  organizationChartSchema,
  projectListSchema,
  projectMemberListSchema,
  projectSchema,
  projectTaskListSchema,
  timeReviewSchema,
  permissionMatrixSchema,
  orgChartNeighborhoodSchema,
  orgChartSearchSchema,
  reportCatalogSchema,
  savedReportListSchema,
  organizationDetailSchema,
  myProfileSchema,
  profileEmployeeSchema,
  profileRequestListSchema,
  profileChangeRequestSchema,
  exitListSchema,
  myExitSchema,
  policyDetailSchema,
  policyListSchema,
  insightsSchema,
  updatesSchema,
  documentListSchema,
  documentReviewSchema,
  recruitRequisitionListSchema,
  recruitCandidateListSchema,
  recruitCandidateSchema,
  recruitApplicationListSchema,
  recruitApplicationDetailSchema,
  recruitInterviewListSchema,
  recruitScorecardListSchema,
  recruitOfferListSchema,
  recruitFunnelSchema,
  recruitLookupsSchema,
  perfObjectiveListSchema,
  perfObjectiveDetailSchema,
  perfAlignableSchema,
  perfProgressListSchema,
  perfCycleListSchema,
  perfReviewListSchema,
  perfReviewDetailSchema,
  hdCaseListSchema,
  hdCaseDetailSchema,
  hdCategoryListSchema,
  hdSlaListSchema,
  hdAgentListSchema,
  hdArticleListSchema,
  hdSuggestionListSchema,
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
      api(`/employees/${encodeURIComponent(id)}`, employeeDetailSchema, {
        signal,
      }),
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
export const useMyPolicies = (enabled: boolean) =>
  useQuery({
    queryKey: ["policies", "mine"],
    enabled,
    queryFn: ({ signal }) =>
      api("/policies/mine", myPoliciesSchema, { signal }),
  });
export const usePolicies = (enabled: boolean) =>
  useQuery({
    queryKey: ["policies", "list"],
    enabled,
    queryFn: ({ signal }) => api("/policies", policyListSchema, { signal }),
  });
export const usePolicy = (id: string | null) =>
  useQuery({
    queryKey: ["policies", "detail", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api(`/policies/${id}`, policyDetailSchema, { signal }),
  });
export const useMyAssets = (enabled: boolean) =>
  useQuery({
    queryKey: ["assets", "mine"],
    enabled,
    queryFn: ({ signal }) => api("/assets/mine", myAssetsSchema, { signal }),
  });
export const useAssets = (query: string, enabled: boolean) =>
  useQuery({
    queryKey: ["assets", "list", query],
    enabled,
    queryFn: ({ signal }) =>
      api(`/assets?${query}`, assetListSchema, { signal }),
  });
export const useAsset = (id: string | null) =>
  useQuery({
    queryKey: ["assets", "detail", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api(`/assets/${id}`, assetDetailSchema, { signal }),
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

export const useMyExit = (enabled: boolean) =>
  useQuery({
    queryKey: ["exits", "mine"],
    enabled,
    queryFn: ({ signal }) => api("/exits/mine", myExitSchema, { signal }),
  });
export const useExits = (enabled: boolean, query = "") =>
  useQuery({
    queryKey: ["exits", "list", query],
    enabled,
    queryFn: ({ signal }) =>
      api(`/exits${query ? `?${query}` : ""}`, exitListSchema, { signal }),
  });
export const useExit = (id: string | null) =>
  useQuery({
    queryKey: ["exits", "detail", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) => api(`/exits/${id}`, exitDetailSchema, { signal }),
  });

export const useMyExpenses = (enabled: boolean) =>
  useQuery({
    queryKey: ["expenses", "mine"],
    enabled,
    queryFn: ({ signal }) =>
      api("/expenses/mine", myExpensesSchema, { signal }),
  });
export const useExpenseCategories = (enabled: boolean) =>
  useQuery({
    queryKey: ["expenses", "categories"],
    enabled,
    queryFn: ({ signal }) =>
      api("/expenses/categories", expenseCategoryListSchema, { signal }),
  });
export const useExpenses = (enabled: boolean) =>
  useQuery({
    queryKey: ["expenses", "list"],
    enabled,
    queryFn: ({ signal }) => api("/expenses", expenseListSchema, { signal }),
  });
export const useExpense = (id: string | null) =>
  useQuery({
    queryKey: ["expenses", "detail", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api(`/expenses/${id}`, expenseClaimSchema, { signal }),
  });

export const useMyProfile = (enabled: boolean) =>
  useQuery({
    queryKey: ["profile", "mine"],
    enabled,
    queryFn: ({ signal }) => api("/profile/mine", myProfileSchema, { signal }),
  });
export const useProfileRequests = (enabled: boolean) =>
  useQuery({
    queryKey: ["profile", "requests"],
    enabled,
    queryFn: ({ signal }) =>
      api("/profile/requests", profileRequestListSchema, { signal }),
  });
export const useProfileRequest = (id: string | null) =>
  useQuery({
    queryKey: ["profile", "request", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api(`/profile/requests/${id}`, profileChangeRequestSchema, { signal }),
  });
export const useProfileEmployee = (id: string | null) =>
  useQuery({
    queryKey: ["profile", "employee", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api(`/profile/employees/${id}`, profileEmployeeSchema, { signal }),
  });

export const useOrgChart = (rootId: string | null = null, depth = 20) =>
  useQuery({
    queryKey: ["organization", "chart", rootId, depth],
    queryFn: ({ signal }) =>
      api(
        `/organization/chart?depth=${depth}${rootId ? `&rootId=${rootId}` : ""}`,
        organizationChartSchema,
        { signal },
      ),
  });
// Debounced people search for the chart. The text is only ever sent to the
// search endpoint; it is never logged or written into the address bar.
export const useOrgSearch = (text: string) => {
  const trimmed = text.trim().slice(0, 60);
  const [settled, setSettled] = useState(trimmed);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(trimmed), 250);
    return () => clearTimeout(timer);
  }, [trimmed]);
  const enabled = settled.length >= 2;
  const query = useQuery({
    queryKey: ["organization", "chart", "search", settled],
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api(
        `/organization/chart/search?q=${encodeURIComponent(settled)}&limit=10`,
        orgChartSearchSchema,
        { signal },
      ),
  });
  return {
    ...query,
    // True between typing and the answer for what was typed.
    waiting: trimmed.length >= 2 && (settled !== trimmed || query.isFetching),
    active: trimmed.length >= 2,
  };
};
export const useOrgNeighborhood = (id: string | null) =>
  useQuery({
    queryKey: ["organization", "chart", "neighborhood", id],
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: ({ signal }) =>
      api(
        `/organization/chart/neighborhood/${id}`,
        orgChartNeighborhoodSchema,
        { signal },
      ),
  });
export const useOrganizationDetail = (id: string | null) =>
  useQuery({
    queryKey: ["organization", "detail", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api(`/organization/${id}`, organizationDetailSchema, { signal }),
  });

export const useReportCatalog = (enabled: boolean) =>
  useQuery({
    queryKey: ["reports", "datasets"],
    enabled,
    queryFn: ({ signal }) =>
      api("/reports/datasets", reportCatalogSchema, { signal }),
  });
export const useSavedReports = (enabled: boolean) =>
  useQuery({
    queryKey: ["reports", "saved"],
    enabled,
    queryFn: ({ signal }) =>
      api("/reports/saved", savedReportListSchema, { signal }),
  });

export const useBrandingHistory = (enabled: boolean, before?: number) =>
  useQuery({
    queryKey: ["branding", "history", before ?? null],
    enabled,
    queryFn: ({ signal }) =>
      api(
        `/branding/history?limit=20${before ? `&beforeVersion=${before}` : ""}`,
        brandingHistorySchema,
        { signal },
      ),
  });
export const usePermissionMatrix = (enabled: boolean) =>
  useQuery({
    queryKey: ["admin", "permissions"],
    enabled,
    queryFn: ({ signal }) =>
      api("/admin/permissions", permissionMatrixSchema, { signal }),
  });
export const useIntegrations = (enabled: boolean) =>
  useQuery({
    queryKey: ["admin", "integrations"],
    enabled,
    queryFn: ({ signal }) =>
      api("/admin/integrations", integrationReadinessSchema, { signal }),
  });

export const useProjects = (enabled: boolean, query = "") =>
  useQuery({
    queryKey: ["projects", "list", query],
    enabled,
    queryFn: ({ signal }) =>
      api(`/projects${query ? `?${query}` : ""}`, projectListSchema, {
        signal,
      }),
  });
export const useProject = (id: string | null) =>
  useQuery({
    queryKey: ["projects", "detail", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) => api(`/projects/${id}`, projectSchema, { signal }),
  });
export const useProjectMembers = (id: string | null) =>
  useQuery({
    queryKey: ["projects", "members", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api(`/projects/${id}/members`, projectMemberListSchema, { signal }),
  });
export const useProjectTasks = (id: string | null) =>
  useQuery({
    queryKey: ["projects", "tasks", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api(`/projects/${id}/tasks`, projectTaskListSchema, { signal }),
  });
export const useMyTime = (enabled: boolean, weekOf?: string) =>
  useQuery({
    queryKey: ["time", "mine", weekOf ?? null],
    enabled,
    queryFn: ({ signal }) =>
      api(`/time/mine${weekOf ? `?weekOf=${weekOf}` : ""}`, myTimeSchema, {
        signal,
      }),
  });
export const useTimeReview = (enabled: boolean) =>
  useQuery({
    queryKey: ["time", "review"],
    enabled,
    queryFn: ({ signal }) => api("/time/review", timeReviewSchema, { signal }),
  });

// Recruitment (REC-01). Every key starts with "recruit" so one invalidation refreshes all tabs.
const recruitGet = <T>(
  path: string,
  query: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
) => api(`/recruit/${path}${query ? `?${query}` : ""}`, schema, { signal });
export const useRecruitRequisitions = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["recruit", "requisitions", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      recruitGet("requisitions", query, recruitRequisitionListSchema, signal),
  });
export const useRecruitCandidates = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["recruit", "candidates", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      recruitGet("candidates", query, recruitCandidateListSchema, signal),
  });
// Reading one candidate in full is audited, so this runs only when asked for.
export const useRecruitCandidateReveal = (id: string | null) =>
  useQuery({
    queryKey: ["recruit", "candidate-reveal", id],
    enabled: Boolean(id),
    staleTime: 0,
    gcTime: 0,
    // Each full read is audited, so never repeat one in the background.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      recruitGet(`candidates/${id}`, "", recruitCandidateSchema, signal),
  });
export const useRecruitApplications = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["recruit", "applications", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      recruitGet("applications", query, recruitApplicationListSchema, signal),
  });
export const useRecruitApplication = (id: string | null) =>
  useQuery({
    queryKey: ["recruit", "application", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      recruitGet(
        `applications/${id}`,
        "",
        recruitApplicationDetailSchema,
        signal,
      ),
  });
export const useRecruitInterviews = (
  enabled: boolean,
  mine: boolean,
  query: string,
) =>
  useQuery({
    queryKey: ["recruit", "interviews", mine, query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      recruitGet(
        mine ? "interviews/mine" : "interviews",
        query,
        recruitInterviewListSchema,
        signal,
      ),
  });
export const useRecruitScorecards = (id: string | null) =>
  useQuery({
    queryKey: ["recruit", "scorecards", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      recruitGet(
        `interviews/${id}/scorecards`,
        "",
        recruitScorecardListSchema,
        signal,
      ),
  });
export const useRecruitOffers = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["recruit", "offers", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      recruitGet("offers", query, recruitOfferListSchema, signal),
  });
export const useRecruitFunnel = (enabled: boolean, requisitionId: string) =>
  useQuery({
    queryKey: ["recruit", "funnel", requisitionId],
    enabled,
    queryFn: ({ signal }) =>
      recruitGet(
        "funnel",
        requisitionId ? `requisitionId=${requisitionId}` : "",
        recruitFunnelSchema,
        signal,
      ),
  });
// Departments, locations and designations in effect today, for the requisition form. Served
// by recruitment (id, code, name only) so hiring managers can raise without organization.read.
export const useRecruitLookups = (enabled: boolean) =>
  useQuery({
    queryKey: ["recruit", "lookups"],
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      recruitGet("lookups", "", recruitLookupsSchema, signal),
  });
// Performance (PERF-01). Every key starts with "perf" so one invalidation refreshes all tabs.
const perfGet = <T>(
  path: string,
  query: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
) => api(`/performance/${path}${query ? `?${query}` : ""}`, schema, { signal });
export const usePerfObjectives = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["perf", "objectives", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      perfGet("objectives", query, perfObjectiveListSchema, signal),
  });
export const usePerfObjective = (id: string | null) =>
  useQuery({
    queryKey: ["perf", "objective", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      perfGet(`objectives/${id}`, "", perfObjectiveDetailSchema, signal),
  });
export const usePerfAlignable = (enabled: boolean, ownerId: string) =>
  useQuery({
    queryKey: ["perf", "alignable", ownerId],
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      perfGet(
        "objectives/alignable",
        ownerId ? `ownerId=${ownerId}` : "",
        perfAlignableSchema,
        signal,
      ),
  });
export const usePerfProgress = (keyResultId: string | null) =>
  useQuery({
    queryKey: ["perf", "progress", keyResultId],
    enabled: Boolean(keyResultId),
    queryFn: ({ signal }) =>
      perfGet(
        `key-results/${keyResultId}/progress`,
        "limit=20",
        perfProgressListSchema,
        signal,
      ),
  });
export const usePerfCycles = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["perf", "cycles", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      perfGet("cycles", query, perfCycleListSchema, signal),
  });
export const usePerfReviews = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["perf", "reviews", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      perfGet("reviews", query, perfReviewListSchema, signal),
  });
export const usePerfReview = (id: string | null) =>
  useQuery({
    queryKey: ["perf", "review", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      perfGet(`reviews/${id}`, "", perfReviewDetailSchema, signal),
  });
// Helpdesk (HLP-01). Every key starts with "hd" so one invalidation refreshes all tabs.
const hdGet = <T>(
  path: string,
  query: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
) => api(`/helpdesk/${path}${query ? `?${query}` : ""}`, schema, { signal });
export const useHdCases = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["hd", "cases", query],
    staleTime: 0,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => hdGet("cases", query, hdCaseListSchema, signal),
  });
export const useHdCase = (id: string | null) =>
  useQuery({
    queryKey: ["hd", "case", id],
    // Other people reply while this is closed, so always look again on opening.
    staleTime: 0,
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      hdGet(`cases/${id}`, "", hdCaseDetailSchema, signal),
  });
export const useHdCategories = (enabled: boolean) =>
  useQuery({
    queryKey: ["hd", "categories"],
    enabled,
    queryFn: ({ signal }) =>
      hdGet("categories", "", hdCategoryListSchema, signal),
  });
export const useHdSla = (enabled: boolean) =>
  useQuery({
    queryKey: ["hd", "sla"],
    enabled,
    queryFn: ({ signal }) => hdGet("sla", "", hdSlaListSchema, signal),
  });
export const useHdAgents = (enabled: boolean) =>
  useQuery({
    queryKey: ["hd", "agents"],
    enabled,
    retry: false,
    queryFn: ({ signal }) => hdGet("agents", "", hdAgentListSchema, signal),
  });
export const useHdArticles = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["hd", "articles", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      hdGet("articles", query, hdArticleListSchema, signal),
  });
export const useHdSuggestions = (
  enabled: boolean,
  categoryId: string,
  text: string,
) =>
  useQuery({
    queryKey: ["hd", "suggest", categoryId, text],
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      hdGet(
        "articles/suggest",
        new URLSearchParams({
          q: text,
          ...(categoryId ? { categoryId } : {}),
        }).toString(),
        hdSuggestionListSchema,
        signal,
      ),
  });
export const usePeopleSearch = (term: string) =>
  useQuery({
    queryKey: ["directory", "search", term],
    enabled: term.trim().length > 0,
    queryFn: ({ signal }) =>
      api(
        `/employees?q=${encodeURIComponent(term.trim())}&limit=6`,
        directorySchema,
        { signal },
      ),
  });
