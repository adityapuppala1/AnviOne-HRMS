import {
  Controller,
  Inject,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { RateLimitRequestHandler } from "express-rate-limit";
import { z } from "zod";
import {
  organizationChartQuerySchema,
  organizationCreateSchema,
  organizationMergeSchema,
  organizationUpdateSchema,
  organizationQuerySchema,
  orgChartSearchQuerySchema,
} from "@anvi/contracts";
import { RateLimits, personLimiter, runLimit } from "./rate-limit";
import { PlatformStore } from "./platform.store";
import { OrganizationStore } from "./organization.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

export const ORG_CHART_LIMITS = {
  searchesPerMinute: 120,
  neighborhoodsPerMinute: 120,
} as const;

// Organization masters (departments, locations, designations, grades, cost
// centres), department/location merges and the reporting chart.
@Controller()
export class OrganizationController {
  private readonly organization;
  private readonly searchLimit: RateLimitRequestHandler;
  private readonly neighborhoodLimit: RateLimitRequestHandler;
  constructor(
    @Inject(PlatformStore) store: PlatformStore,
    @Inject(RateLimits) limits: RateLimits,
  ) {
    this.organization = new OrganizationStore(store);
    this.searchLimit = personLimiter(
      limits,
      "orgchart-search",
      ORG_CHART_LIMITS.searchesPerMinute,
      "Too many searches. Wait a minute and try again.",
    );
    this.neighborhoodLimit = personLimiter(
      limits,
      "orgchart-neighborhood",
      ORG_CHART_LIMITS.neighborhoodsPerMinute,
      "Too many chart lookups. Wait a minute and try again.",
    );
  }
  @Get("api/v1/organization") organizationUnits(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.organization.list(
      req.actor,
      parse(organizationQuerySchema, query),
    );
  }
  // Declared before ":id" so "chart" is never read as an id.
  @Get("api/v1/organization/chart") organizationChart(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.organization.chart(
      req.actor,
      parse(organizationChartQuerySchema, query),
    );
  }
  // Entity-wide basic structure for anyone with directory.read. Permission first, then
  // input, then budget. Never audited; the search text is never logged.
  @Get("api/v1/organization/chart/search") async organizationChartSearch(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Query() query: unknown,
  ) {
    this.organization.requireStructure(req.actor);
    const input = parse(orgChartSearchQuerySchema, query);
    await runLimit(this.searchLimit, req, res);
    return this.organization.search(req.actor, input);
  }
  @Get("api/v1/organization/chart/neighborhood/:employeeId")
  async organizationChartNeighborhood(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("employeeId") employeeId: string,
  ) {
    this.organization.requireStructure(req.actor);
    const id = parse(z.uuid(), employeeId);
    await runLimit(this.neighborhoodLimit, req, res);
    return this.organization.neighborhood(req.actor, id);
  }
  @Get("api/v1/organization/:id") organizationUnit(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.organization.detail(req.actor, parse(z.uuid(), id));
  }
  @Post("api/v1/organization") createOrganizationUnit(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.organization.create(
      req.actor,
      parse(organizationCreateSchema, body),
      req.requestId,
    );
  }
  @Put("api/v1/organization/:id") updateOrganizationUnit(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.organization.update(
      req.actor,
      parse(z.uuid(), id),
      parse(organizationUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/organization/:id/merge") mergeOrganizationUnit(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.organization.merge(
      req.actor,
      parse(z.uuid(), id),
      parse(organizationMergeSchema, body),
      req.requestId,
    );
  }
}
