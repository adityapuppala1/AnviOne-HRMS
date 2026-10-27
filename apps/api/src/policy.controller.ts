import {
  Controller,
  Inject,
  Get,
  Post,
  Put,
  Body,
  Param,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  policyAcknowledgeSchema,
  policyCreateSchema,
  policyDraftSchema,
  policyPublishSchema,
  policyWithdrawSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { PolicyStore } from "./policy.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// HR policies: HR drafts and publishes versions; employees read and acknowledge.
@Controller()
export class PolicyController {
  private readonly policies;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.policies = new PolicyStore(store);
  }
  @Get("api/v1/policies/mine") mine(@Req() req: AppRequest) {
    return this.policies.mine(req.actor);
  }
  @Get("api/v1/policies/mine/:versionId") readMine(
    @Req() req: AppRequest,
    @Param("versionId") versionId: string,
  ) {
    return this.policies.readMine(req.actor, parse(z.uuid(), versionId));
  }
  @Post("api/v1/policies/versions/:versionId/acknowledge") acknowledge(
    @Req() req: AppRequest,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
  ) {
    parse(policyAcknowledgeSchema, body ?? {});
    return this.policies.acknowledge(
      req.actor,
      parse(z.uuid(), versionId),
      req.requestId,
    );
  }
  @Get("api/v1/policies") list(@Req() req: AppRequest) {
    return this.policies.list(req.actor);
  }
  @Post("api/v1/policies") create(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.policies.create(
      req.actor,
      parse(policyCreateSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/policies/:id") detail(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.policies.detail(req.actor, parse(z.uuid(), id));
  }
  @Post("api/v1/policies/:id/drafts") newDraft(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.policies.newDraft(
      req.actor,
      parse(z.uuid(), id),
      req.requestId,
    );
  }
  @Put("api/v1/policies/versions/:versionId") updateDraft(
    @Req() req: AppRequest,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
  ) {
    return this.policies.updateDraft(
      req.actor,
      parse(z.uuid(), versionId),
      parse(policyDraftSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/policies/versions/:versionId/publish") publish(
    @Req() req: AppRequest,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
  ) {
    return this.policies.publish(
      req.actor,
      parse(z.uuid(), versionId),
      parse(policyPublishSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/policies/versions/:versionId/withdraw") withdraw(
    @Req() req: AppRequest,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
  ) {
    return this.policies.withdraw(
      req.actor,
      parse(z.uuid(), versionId),
      parse(policyWithdrawSchema, body),
      req.requestId,
    );
  }
}
