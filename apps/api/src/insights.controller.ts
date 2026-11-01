import { Controller, Get, Inject, Req } from "@nestjs/common";
import { PlatformStore } from "./platform.store";
import { InsightsStore } from "./insights.store";
import type { AppRequest } from "./auth";

// Read-only workforce counts for managers (team) and HR (organization).
@Controller()
export class InsightsController {
  private readonly insights;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.insights = new InsightsStore(store);
  }
  @Get("api/v1/insights") overview(@Req() req: AppRequest) {
    return this.insights.overview(req.actor);
  }
}
