import {
  Controller,
  Inject,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  profileApplyDueSchema,
  profileApproveSchema,
  profileCancelSchema,
  profileRejectSchema,
  profileRequestQuerySchema,
  profileSubmitSchema,
  profileWithdrawSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { ProfileStore } from "./profile.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Profile edits: employees ask for contact-detail changes; HR decides; approved changes
// apply on their effective date (on approval, on read, or through apply-due).
@Controller()
export class ProfileController {
  private readonly profiles;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.profiles = new ProfileStore(store);
  }
  @Get("api/v1/profile/mine") mine(@Req() req: AppRequest) {
    return this.profiles.mine(req.actor, req.requestId);
  }
  @Get("api/v1/profile/mine/history") history(@Req() req: AppRequest) {
    return this.profiles.history(req.actor);
  }
  @Post("api/v1/profile/mine/requests") submit(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.profiles.submit(
      req.actor,
      parse(profileSubmitSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/profile/mine/requests/:id/withdraw") withdraw(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.profiles.withdraw(
      req.actor,
      parse(z.uuid(), id),
      parse(profileWithdrawSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/profile/requests") list(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.profiles.list(
      req.actor,
      parse(profileRequestQuerySchema, query),
    );
  }
  @Get("api/v1/profile/requests/:id") detail(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.profiles.detail(req.actor, parse(z.uuid(), id), req.requestId);
  }
  @Post("api/v1/profile/requests/:id/approve") approve(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.profiles.approve(
      req.actor,
      parse(z.uuid(), id),
      parse(profileApproveSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/profile/requests/:id/reject") reject(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.profiles.reject(
      req.actor,
      parse(z.uuid(), id),
      parse(profileRejectSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/profile/requests/:id/cancel") cancel(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.profiles.cancel(
      req.actor,
      parse(z.uuid(), id),
      parse(profileCancelSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/profile/apply-due") applyDue(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    parse(profileApplyDueSchema, body ?? {});
    return this.profiles.applyDueAll(req.actor, req.requestId);
  }
  @Get("api/v1/profile/employees/:id") employee(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.profiles.employee(
      req.actor,
      parse(z.uuid(), id),
      req.requestId,
    );
  }
}
