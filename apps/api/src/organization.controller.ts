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
} from "@nestjs/common";
import { z } from "zod";
import {
  organizationChartQuerySchema,
  organizationCreateSchema,
  organizationMergeSchema,
  organizationUpdateSchema,
  organizationQuerySchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { OrganizationStore } from "./organization.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Organization masters (departments, locations, designations, grades, cost
// centres), department/location merges and the reporting chart.
@Controller()
export class OrganizationController {
  private readonly organization;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.organization = new OrganizationStore(store);
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
