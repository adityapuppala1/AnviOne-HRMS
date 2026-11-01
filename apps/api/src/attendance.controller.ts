import {
  Controller,
  Inject,
  Get,
  Post,
  Body,
  Param,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  attendanceCheckInSchema,
  attendanceCheckOutSchema,
  attendanceCorrectionCreateSchema,
  attendanceCancelSchema,
  attendanceDecisionSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { AttendanceStore } from "./attendance.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Punches, team presence and corrections.
@Controller()
export class AttendanceController {
  private readonly attendance;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.attendance = new AttendanceStore(store);
  }
  @Get("api/v1/attendance") attendanceOverview(@Req() req: AppRequest) {
    return this.attendance.overview(req.actor);
  }
  @Get("api/v1/attendance/team") attendanceTeam(@Req() req: AppRequest) {
    return this.attendance.team(req.actor);
  }
  @Post("api/v1/attendance/check-in") checkIn(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    parse(attendanceCheckInSchema, body ?? {});
    return this.attendance.checkIn(req.actor, req.requestId);
  }
  @Post("api/v1/attendance/check-out") checkOut(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.attendance.checkOut(
      req.actor,
      parse(attendanceCheckOutSchema, body).version,
      req.requestId,
    );
  }
  @Post("api/v1/attendance/corrections") requestCorrection(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.attendance.requestCorrection(
      req.actor,
      parse(attendanceCorrectionCreateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/attendance/corrections/:id/cancel") cancelCorrection(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.attendance.cancelCorrection(
      req.actor,
      parse(z.uuid(), id),
      parse(attendanceCancelSchema, body).version,
      req.requestId,
    );
  }
  @Post("api/v1/attendance/corrections/:id/decision") decideCorrection(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.attendance.decideCorrection(
      req.actor,
      parse(z.uuid(), id),
      parse(attendanceDecisionSchema, body),
      req.requestId,
    );
  }
}
