import { Controller, Get, Inject, Req } from "@nestjs/common";
import { PlatformStore } from "./platform.store";
import { UpdatesStore } from "./updates.store";
import type { AppRequest } from "./auth";

// Decisions on the signed-in person's own requests. Read-only.
@Controller()
export class UpdatesController {
  private readonly updates;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.updates = new UpdatesStore(store);
  }
  @Get("api/v1/updates") feed(@Req() req: AppRequest) {
    return this.updates.feed(req.actor);
  }
}
