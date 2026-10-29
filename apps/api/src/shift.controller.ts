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
  shfAssignSchema,
  shfCancelSchema,
  shfClaimQuerySchema,
  shfDecisionSchema,
  shfHoursQuerySchema,
  shfOpenCreateSchema,
  shfOpenQuerySchema,
  shfRosterQuerySchema,
  shfSettingsUpdateSchema,
  shfSwapCreateSchema,
  shfSwapQuerySchema,
  shfTemplateCreateSchema,
  shfTemplateQuerySchema,
  shfTemplateUpdateSchema,
  shfVersionSchema,
  shfWeekQuerySchema,
  shfWeekStartSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { ShiftStore } from "./shift.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

const id = (value: string) => parse(z.uuid(), value);
const swapStep = z.enum(["accept", "decline", "cancel", "approve", "reject"]);
const claimStep = z.enum(["approve", "reject", "withdraw"]);

// Shifts and rosters (SHF-01): templates, shifts per person and date, published weeks, swaps
// (four-eyes), open shifts and claims, and derived planned hours. No payroll, overtime or automatic
// scheduling. The database guards and policies decide every write and read.
@Controller("api/v1/shifts")
export class ShiftController {
  private readonly shifts;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.shifts = new ShiftStore(store);
  }

  @Get("settings") settings(@Req() req: AppRequest) {
    return this.shifts.settings(req.actor);
  }
  @Put("settings") updateSettings(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.shifts.updateSettings(
      req.actor,
      parse(shfSettingsUpdateSchema, body),
      req.requestId,
    );
  }

  @Get("templates") templates(@Req() req: AppRequest, @Query() query: unknown) {
    return this.shifts.listTemplates(
      req.actor,
      parse(shfTemplateQuerySchema, query),
    );
  }
  @Post("templates") createTemplate(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.shifts.createTemplate(
      req.actor,
      parse(shfTemplateCreateSchema, body),
      req.requestId,
    );
  }
  @Get("templates/:id") template(
    @Req() req: AppRequest,
    @Param("id") templateId: string,
  ) {
    return this.shifts.templateDetail(req.actor, id(templateId));
  }
  @Put("templates/:id") updateTemplate(
    @Req() req: AppRequest,
    @Param("id") templateId: string,
    @Body() body: unknown,
  ) {
    return this.shifts.updateTemplate(
      req.actor,
      id(templateId),
      parse(shfTemplateUpdateSchema, body),
      req.requestId,
    );
  }

  @Get("roster") roster(@Req() req: AppRequest, @Query() query: unknown) {
    return this.shifts.roster(req.actor, parse(shfRosterQuerySchema, query));
  }
  @Post("roster") assign(@Req() req: AppRequest, @Body() body: unknown) {
    return this.shifts.assign(
      req.actor,
      parse(shfAssignSchema, body),
      req.requestId,
    );
  }
  @Get("roster/:id") assignment(
    @Req() req: AppRequest,
    @Param("id") assignmentId: string,
  ) {
    return this.shifts.assignmentDetail(req.actor, id(assignmentId));
  }
  @Post("roster/:id/cancel") cancel(
    @Req() req: AppRequest,
    @Param("id") assignmentId: string,
    @Body() body: unknown,
  ) {
    return this.shifts.cancel(
      req.actor,
      id(assignmentId),
      parse(shfCancelSchema, body),
      req.requestId,
    );
  }

  @Get("weeks") weeks(@Req() req: AppRequest, @Query() query: unknown) {
    return this.shifts.weeks(req.actor, parse(shfWeekQuerySchema, query));
  }
  @Get("weeks/:weekStart") week(
    @Req() req: AppRequest,
    @Param("weekStart") weekStart: string,
  ) {
    return this.shifts.week(req.actor, parse(shfWeekStartSchema, weekStart));
  }
  @Post("weeks/:weekStart/publish") publish(
    @Req() req: AppRequest,
    @Param("weekStart") weekStart: string,
  ) {
    return this.shifts.publish(
      req.actor,
      parse(shfWeekStartSchema, weekStart),
      req.requestId,
    );
  }
  @Get("hours") hours(@Req() req: AppRequest, @Query() query: unknown) {
    return this.shifts.hours(req.actor, parse(shfHoursQuerySchema, query));
  }

  @Get("swaps") swaps(@Req() req: AppRequest, @Query() query: unknown) {
    return this.shifts.listSwaps(req.actor, parse(shfSwapQuerySchema, query));
  }
  @Post("swaps") propose(@Req() req: AppRequest, @Body() body: unknown) {
    return this.shifts.proposeSwap(
      req.actor,
      parse(shfSwapCreateSchema, body),
      req.requestId,
    );
  }
  @Get("swaps/:id") swap(@Req() req: AppRequest, @Param("id") swapId: string) {
    return this.shifts.swapDetail(req.actor, id(swapId));
  }
  @Post("swaps/:id/:step") swapStep(
    @Req() req: AppRequest,
    @Param("id") swapId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    return this.shifts.swapStep(
      req.actor,
      id(swapId),
      parse(swapStep, step),
      parse(shfDecisionSchema, body),
      req.requestId,
    );
  }

  @Get("open") openShifts(@Req() req: AppRequest, @Query() query: unknown) {
    return this.shifts.listOpen(req.actor, parse(shfOpenQuerySchema, query));
  }
  @Post("open") postOpen(@Req() req: AppRequest, @Body() body: unknown) {
    return this.shifts.postOpen(
      req.actor,
      parse(shfOpenCreateSchema, body),
      req.requestId,
    );
  }
  @Get("open/:id") openShift(
    @Req() req: AppRequest,
    @Param("id") openId: string,
  ) {
    return this.shifts.openDetail(req.actor, id(openId));
  }
  @Post("open/:id/withdraw") withdrawOpen(
    @Req() req: AppRequest,
    @Param("id") openId: string,
    @Body() body: unknown,
  ) {
    return this.shifts.withdrawOpen(
      req.actor,
      id(openId),
      parse(shfVersionSchema, body),
      req.requestId,
    );
  }
  @Post("open/:id/claim") claim(
    @Req() req: AppRequest,
    @Param("id") openId: string,
  ) {
    return this.shifts.claim(req.actor, id(openId), req.requestId);
  }

  @Get("claims") claims(@Req() req: AppRequest, @Query() query: unknown) {
    return this.shifts.listClaims(req.actor, parse(shfClaimQuerySchema, query));
  }
  @Post("claims/:id/:step") claimStep(
    @Req() req: AppRequest,
    @Param("id") claimId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    return this.shifts.claimStep(
      req.actor,
      id(claimId),
      parse(claimStep, step),
      parse(shfDecisionSchema, body),
      req.requestId,
    );
  }
}
