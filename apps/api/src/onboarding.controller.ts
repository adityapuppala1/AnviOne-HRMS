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
  candidateCreateSchema,
  candidateActionSchema,
  candidateReviewSchema,
  candidateTaskCreateSchema,
  candidateTaskUpdateSchema,
  localReviewProposalSchema,
  localReviewDecisionSchema,
  candidateTaskAssignmentSchema,
  assignedTaskUpdateSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { OnboardingStore } from "./onboarding.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Candidate intake, checklist, assigned tasks and readiness review.
@Controller()
export class OnboardingController {
  private readonly onboarding;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.onboarding = new OnboardingStore(store);
  }
  @Get("api/v1/candidates/options") candidateOptions(@Req() req: AppRequest) {
    return this.onboarding.options(req.actor);
  }
  @Get("api/v1/candidates") candidates(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    const q = parse(
      z.object({ q: z.string().trim().max(80).default("") }).strict(),
      query,
    );
    return this.onboarding.list(req.actor, q.q);
  }
  @Post("api/v1/candidates") createCandidate(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.onboarding.create(
      req.actor,
      parse(candidateCreateSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/candidates/:id") candidateDetail(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.onboarding.detail(req.actor, parse(z.uuid(), id));
  }
  @Post("api/v1/candidates/:id/checklist") startChecklist(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.onboarding.startChecklist(
      req.actor,
      parse(z.uuid(), id),
      parse(candidateActionSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/candidates/:id/tasks") createTask(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.onboarding.createTask(
      req.actor,
      parse(z.uuid(), id),
      parse(candidateTaskCreateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/candidates/:id/tasks/:taskId") updateTask(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.onboarding.updateTask(
      req.actor,
      parse(z.uuid(), id),
      parse(z.uuid(), taskId),
      parse(candidateTaskUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/candidates/:id/tasks/:taskId/assignment") assignTask(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.onboarding.assignTask(
      req.actor,
      parse(z.uuid(), id),
      parse(z.uuid(), taskId),
      parse(candidateTaskAssignmentSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/onboarding/tasks") assignedTasks(@Req() req: AppRequest) {
    return this.onboarding.assignedTasks(req.actor);
  }
  @Post("api/v1/onboarding/tasks/:taskId") updateAssignedTask(
    @Req() req: AppRequest,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.onboarding.updateAssignedTask(
      req.actor,
      parse(z.uuid(), taskId),
      parse(assignedTaskUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/candidates/:id/local-reviews") proposeLocalReview(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.onboarding.proposeLocalReview(
      req.actor,
      parse(z.uuid(), id),
      parse(localReviewProposalSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/candidates/:id/local-reviews/:reviewId") decideLocalReview(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Param("reviewId") reviewId: string,
    @Body() body: unknown,
  ) {
    return this.onboarding.decideLocalReview(
      req.actor,
      parse(z.uuid(), id),
      parse(z.uuid(), reviewId),
      parse(localReviewDecisionSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/candidates/:id/delivery-preview") candidateDelivery(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.onboarding.delivery(
      req.actor,
      parse(z.uuid(), id),
      req.requestId,
    );
  }
  @Post("api/v1/candidates/:id/invitation") candidateInvite(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.onboarding.action(
      req.actor,
      parse(z.uuid(), id),
      parse(candidateActionSchema, body),
      req.requestId,
      "invite",
    );
  }
  @Post("api/v1/candidates/:id/revoke") candidateRevoke(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.onboarding.action(
      req.actor,
      parse(z.uuid(), id),
      parse(candidateActionSchema, body),
      req.requestId,
      "revoke",
    );
  }
  @Post("api/v1/candidates/:id/review") candidateReview(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parse(candidateReviewSchema, body);
    return this.onboarding.action(
      req.actor,
      parse(z.uuid(), id),
      input,
      req.requestId,
      "review",
      input.decision,
    );
  }
}
