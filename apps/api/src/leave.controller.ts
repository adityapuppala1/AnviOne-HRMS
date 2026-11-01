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
  leaveRequestCreateSchema,
  leaveCancelSchema,
  leaveDecisionSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { LeaveStore } from "./leave.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Leave balances, requests and decisions.
@Controller()
export class LeaveController {
  private readonly leave;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.leave = new LeaveStore(store);
  }
  @Get("api/v1/leave") leaveOverview(@Req() req: AppRequest) {
    return this.leave.overview(req.actor);
  }
  @Get("api/v1/leave/approvals") leaveApprovals(@Req() req: AppRequest) {
    return this.leave.approvals(req.actor);
  }
  @Post("api/v1/leave/requests") requestLeave(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.leave.create(
      req.actor,
      parse(leaveRequestCreateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/leave/requests/:id/cancel") cancelLeave(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.leave.cancel(
      req.actor,
      parse(z.uuid(), id),
      parse(leaveCancelSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/leave/requests/:id/decision") decideLeave(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.leave.decide(
      req.actor,
      parse(z.uuid(), id),
      parse(leaveDecisionSchema, body),
      req.requestId,
    );
  }
}
