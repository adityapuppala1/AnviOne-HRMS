import { Controller, Inject, Get, Req } from "@nestjs/common";
import { PlatformStore } from "./platform.store";
import { ApprovalsStore } from "./approvals.store";
import { type AppRequest } from "./auth";

// Cross-module approvals inbox; decisions use each module's own endpoint.
@Controller()
export class ApprovalsController {
  private readonly approvals;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.approvals = new ApprovalsStore(store);
  }
  @Get("api/v1/approvals") inbox(@Req() req: AppRequest) {
    return this.approvals.inbox(req.actor);
  }
}
