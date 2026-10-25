import {
  Controller,
  Inject,
  Get,
  Put,
  Body,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { brandingUpdateSchema, directoryQuerySchema } from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Directory, dashboard, branding and audit reads.
@Controller()
export class PeopleController {
  constructor(@Inject(PlatformStore) private readonly store: PlatformStore) {}
  @Get("api/v1/employees") directory(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.store.directory(req.actor, parse(directoryQuerySchema, query));
  }
  @Get("api/v1/employees/:id") employee(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.store.employee(req.actor, parse(z.uuid(), id));
  }
  @Get("api/v1/dashboard") dashboard(@Req() req: AppRequest) {
    return this.store.dashboard(req.actor);
  }
  @Get("api/v1/branding/active") branding(@Req() req: AppRequest) {
    return this.store.branding(req.actor);
  }
  @Put("api/v1/branding/active") publish(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.store.updateBranding(
      req.actor,
      parse(brandingUpdateSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/audit-events") audit(@Req() req: AppRequest) {
    return this.store.auditEvents(req.actor);
  }
}
