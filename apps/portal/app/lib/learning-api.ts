import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import {
  lrnAssignmentDetailSchema,
  lrnAssignmentListSchema,
  lrnComplianceSchema,
  lrnCourseSchema,
  lrnCourseListSchema,
} from "@anvi/contracts";
import { api } from "./api";

// Learning (LRN-01). Every key starts with "lrn" so one invalidation refreshes all tabs.
const lrnGet = <T>(
  path: string,
  query: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
) => api(`/learning/${path}${query ? `?${query}` : ""}`, schema, { signal });

export const useLrnCourses = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["lrn", "courses", query],
    staleTime: 0,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      lrnGet("courses", query, lrnCourseListSchema, signal),
  });
export const useLrnAssignments = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["lrn", "assignments", query],
    staleTime: 0,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      lrnGet("assignments", query, lrnAssignmentListSchema, signal),
  });
export const useLrnAssignment = (id: string | null) =>
  useQuery({
    queryKey: ["lrn", "assignment", id],
    // HR may record a completion while this is closed, so always look again on opening.
    staleTime: 0,
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      lrnGet(`assignments/${id}`, "", lrnAssignmentDetailSchema, signal),
  });
export const useLrnCompliance = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["lrn", "compliance", query],
    staleTime: 0,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      lrnGet("reports/compliance", query, lrnComplianceSchema, signal),
  });
export const useLrnCourse = (id: string | null) =>
  useQuery({
    queryKey: ["lrn", "course", id],
    staleTime: 0,
    enabled: Boolean(id),
    retry: false,
    queryFn: ({ signal }) =>
      lrnGet(`courses/${id}`, "", lrnCourseSchema, signal),
  });
