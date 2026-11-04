import {
  Controller,
  Inject,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import {
  candidateCreateSchema,
  candidateQuerySchema,
  candidateActionSchema,
  candidateReviewSchema,
  candidateTaskCreateSchema,
  candidateTaskUpdateSchema,
  localReviewProposalSchema,
  localReviewDecisionSchema,
  candidateTaskAssignmentSchema,
  assignedTaskUpdateSchema,
  candidateDocumentReviewSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { OnboardingStore } from "./onboarding.store";

const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
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
    const q = parse(candidateQuerySchema, query);
    return this.onboarding.list(req.actor, q);
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
  @Get("api/v1/candidates/:id/documents") candidateDocuments(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.onboarding.documents(req.actor, parse(z.uuid(), id));
  }
  @Post("api/v1/candidates/:id/documents/:docId/review")
  reviewCandidateDocument(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Body() body: unknown,
  ) {
    const input = parse(candidateDocumentReviewSchema, body);
    return this.onboarding.reviewDocument(
      req.actor,
      parse(z.uuid(), id),
      parse(z.uuid(), docId),
      input,
      req.requestId,
    );
  }
  @Get("api/v1/candidates/:id/documents/:docId/content")
  async downloadCandidateDocument(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Res() res: Response,
  ) {
    const file = await this.onboarding.documentContent(
      req.actor,
      parse(z.uuid(), id),
      parse(z.uuid(), docId),
      req.requestId,
    );
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    res
      .status(200)
      .set({
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      })
      .end(file.bytes);
  }
}
