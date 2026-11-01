import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import {
  shfAssignmentDetailSchema,
  shfClaimListSchema,
  shfHoursSchema,
  shfOpenListSchema,
  shfOpenShiftDetailSchema,
  shfRosterSchema,
  shfSettingsSchema,
  shfSwapListSchema,
  shfTemplateListSchema,
  shfWeekSchema,
} from "@anvi/contracts";
import { api } from "./api";

// Shifts and rosters (SHF-01). Every key starts with "shf" so one invalidation refreshes all tabs.
const shfGet = <T>(
  path: string,
  query: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
) => api(`/shifts/${path}${query ? `?${query}` : ""}`, schema, { signal });

export const useShfSettings = (enabled: boolean) =>
  useQuery({
    queryKey: ["shf", "settings"],
    enabled,
    staleTime: 0,
    queryFn: ({ signal }) => shfGet("settings", "", shfSettingsSchema, signal),
  });
export const useShfTemplates = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["shf", "templates", query],
    enabled,
    staleTime: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      shfGet("templates", query, shfTemplateListSchema, signal),
  });
export const useShfRoster = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["shf", "roster", query],
    enabled,
    staleTime: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => shfGet("roster", query, shfRosterSchema, signal),
  });
export const useShfAssignment = (id: string | null) =>
  useQuery({
    queryKey: ["shf", "assignment", id],
    enabled: Boolean(id),
    staleTime: 0,
    queryFn: ({ signal }) =>
      shfGet(`roster/${id}`, "", shfAssignmentDetailSchema, signal),
  });
export const useShfWeek = (enabled: boolean, weekStart: string) =>
  useQuery({
    queryKey: ["shf", "week", weekStart],
    enabled,
    staleTime: 0,
    queryFn: ({ signal }) =>
      shfGet(`weeks/${weekStart}`, "", shfWeekSchema, signal),
  });
export const useShfHours = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["shf", "hours", query],
    enabled,
    staleTime: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => shfGet("hours", query, shfHoursSchema, signal),
  });
export const useShfSwaps = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["shf", "swaps", query],
    enabled,
    staleTime: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => shfGet("swaps", query, shfSwapListSchema, signal),
  });
export const useShfOpen = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["shf", "open", query],
    enabled,
    staleTime: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => shfGet("open", query, shfOpenListSchema, signal),
  });
export const useShfOpenDetail = (id: string | null) =>
  useQuery({
    queryKey: ["shf", "open-detail", id],
    enabled: Boolean(id),
    staleTime: 0,
    queryFn: ({ signal }) =>
      shfGet(`open/${id}`, "", shfOpenShiftDetailSchema, signal),
  });
export const useShfClaims = (enabled: boolean, query: string) =>
  useQuery({
    queryKey: ["shf", "claims", query],
    enabled,
    staleTime: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      shfGet("claims", query, shfClaimListSchema, signal),
  });
