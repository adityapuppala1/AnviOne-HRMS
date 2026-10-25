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
  organizationCreateSchema,
  organizationUpdateSchema,
  organizationQuerySchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { OrganizationStore } from "./organization.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Department and location masters.
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
}
