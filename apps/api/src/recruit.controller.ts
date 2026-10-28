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
  recruitApplicationCreateSchema,
  recruitApplicationQuerySchema,
  recruitCandidateCreateSchema,
  recruitCandidateQuerySchema,
  recruitCandidateRetentionSchema,
  recruitCandidateWithdrawConsentSchema,
  recruitCandidateAnonymiseSchema,
  recruitFunnelQuerySchema,
  recruitInterviewCreateSchema,
  recruitInterviewQuerySchema,
  recruitInterviewRescheduleSchema,
  recruitInterviewStatusChangeSchema,
  recruitOfferAcceptSchema,
  recruitOfferActionSchema,
  recruitOfferCreateSchema,
  recruitOfferDeclineSchema,
  recruitOfferQuerySchema,
  recruitOfferWithdrawSchema,
  recruitRequisitionActionSchema,
  recruitRequisitionCreateSchema,
  recruitRequisitionQuerySchema,
  recruitRequisitionReasonSchema,
  recruitRequisitionUpdateSchema,
  recruitScorecardCreateSchema,
  recruitStageChangeSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { RecruitStore } from "./recruit.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

const id = (value: string) => parse(z.uuid(), value);
const requisitionStep = z.enum([
  "submit",
  "approve",
  "reject",
  "open",
  "hold",
  "close",
  "cancel",
]);
const offerStep = z.enum(["submit", "approve", "send", "withdraw"]);
const offerTarget = {
  submit: "pending_approval",
  approve: "approved",
  send: "sent",
  withdraw: "withdrawn",
} as const;

// Recruitment (REC-01): HR runs it, hiring managers follow their requisitions, interviewers
// see their interviews and submit scorecards. The database guards decide every write.
@Controller("api/v1/recruit")
export class RecruitController {
  private readonly recruit;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.recruit = new RecruitStore(store);
  }

  @Get("requisitions") requisitions(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.recruit.listRequisitions(
      req.actor,
      parse(recruitRequisitionQuerySchema, query),
    );
  }
  @Post("requisitions") createRequisition(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.recruit.createRequisition(
      req.actor,
      parse(recruitRequisitionCreateSchema, body),
      req.requestId,
    );
  }
  @Get("requisitions/:id") requisition(
    @Req() req: AppRequest,
    @Param("id") requisitionId: string,
  ) {
    return this.recruit.requisitionDetail(req.actor, id(requisitionId));
  }
  @Put("requisitions/:id") updateRequisition(
    @Req() req: AppRequest,
    @Param("id") requisitionId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.updateRequisition(
      req.actor,
      id(requisitionId),
      parse(recruitRequisitionUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("requisitions/:id/:step") requisitionStep(
    @Req() req: AppRequest,
    @Param("id") requisitionId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    const chosen = parse(requisitionStep, step);
    const input =
      chosen === "reject" || chosen === "close"
        ? parse(recruitRequisitionReasonSchema, body)
        : parse(recruitRequisitionActionSchema, body);
    return this.recruit.requisitionStep(
      req.actor,
      id(requisitionId),
      chosen,
      input,
      req.requestId,
    );
  }

  @Get("candidates") candidates(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.recruit.listCandidates(
      req.actor,
      parse(recruitCandidateQuerySchema, query),
    );
  }
  @Post("candidates") createCandidate(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.recruit.createCandidate(
      req.actor,
      parse(recruitCandidateCreateSchema, body),
      req.requestId,
    );
  }
  @Get("candidates/:id") candidate(
    @Req() req: AppRequest,
    @Param("id") candidateId: string,
  ) {
    return this.recruit.candidateDetail(
      req.actor,
      id(candidateId),
      req.requestId,
    );
  }
  @Post("candidates/:id/extend-retention") extendRetention(
    @Req() req: AppRequest,
    @Param("id") candidateId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.extendRetention(
      req.actor,
      id(candidateId),
      parse(recruitCandidateRetentionSchema, body),
      req.requestId,
    );
  }

  @Post("candidates/:id/withdraw-consent") withdrawConsent(
    @Req() req: AppRequest,
    @Param("id") candidateId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.withdrawConsent(
      req.actor,
      id(candidateId),
      parse(recruitCandidateWithdrawConsentSchema, body),
      req.requestId,
    );
  }
  @Post("candidates/:id/anonymise") anonymise(
    @Req() req: AppRequest,
    @Param("id") candidateId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.anonymise(
      req.actor,
      id(candidateId),
      parse(recruitCandidateAnonymiseSchema, body),
      req.requestId,
    );
  }

  @Get("applications") applications(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.recruit.listApplications(
      req.actor,
      parse(recruitApplicationQuerySchema, query),
    );
  }
  @Post("applications") createApplication(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.recruit.createApplication(
      req.actor,
      parse(recruitApplicationCreateSchema, body),
      req.requestId,
    );
  }
  @Get("applications/:id") application(
    @Req() req: AppRequest,
    @Param("id") applicationId: string,
  ) {
    return this.recruit.applicationDetail(req.actor, id(applicationId));
  }
  @Post("applications/:id/stage") stage(
    @Req() req: AppRequest,
    @Param("id") applicationId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.changeStage(
      req.actor,
      id(applicationId),
      parse(recruitStageChangeSchema, body),
      req.requestId,
    );
  }

  @Get("interviews/mine") myInterviews(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.recruit.listInterviews(
      req.actor,
      parse(recruitInterviewQuerySchema, query),
      true,
    );
  }
  @Get("interviews") interviews(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.recruit.listInterviews(
      req.actor,
      parse(recruitInterviewQuerySchema, query),
    );
  }
  @Post("interviews") createInterview(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.recruit.createInterview(
      req.actor,
      parse(recruitInterviewCreateSchema, body),
      req.requestId,
    );
  }
  @Get("interviews/:id") interview(
    @Req() req: AppRequest,
    @Param("id") interviewId: string,
  ) {
    return this.recruit.interviewDetail(req.actor, id(interviewId));
  }
  @Put("interviews/:id") reschedule(
    @Req() req: AppRequest,
    @Param("id") interviewId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.rescheduleInterview(
      req.actor,
      id(interviewId),
      parse(recruitInterviewRescheduleSchema, body),
      req.requestId,
    );
  }
  @Post("interviews/:id/status") interviewStatus(
    @Req() req: AppRequest,
    @Param("id") interviewId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.interviewStatus(
      req.actor,
      id(interviewId),
      parse(recruitInterviewStatusChangeSchema, body),
      req.requestId,
    );
  }
  @Get("interviews/:id/scorecards") scorecards(
    @Req() req: AppRequest,
    @Param("id") interviewId: string,
  ) {
    return this.recruit.scorecards(req.actor, id(interviewId));
  }
  @Post("interviews/:id/scorecard") submitScorecard(
    @Req() req: AppRequest,
    @Param("id") interviewId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.submitScorecard(
      req.actor,
      id(interviewId),
      parse(recruitScorecardCreateSchema, body),
      req.requestId,
    );
  }

  @Get("offers") offers(@Req() req: AppRequest, @Query() query: unknown) {
    return this.recruit.listOffers(
      req.actor,
      parse(recruitOfferQuerySchema, query),
    );
  }
  @Post("offers") createOffer(@Req() req: AppRequest, @Body() body: unknown) {
    return this.recruit.createOffer(
      req.actor,
      parse(recruitOfferCreateSchema, body),
      req.requestId,
    );
  }
  @Post("offers/:id/accept") accept(
    @Req() req: AppRequest,
    @Param("id") offerId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.acceptOffer(
      req.actor,
      id(offerId),
      parse(recruitOfferAcceptSchema, body),
      req.requestId,
    );
  }
  @Post("offers/:id/decline") decline(
    @Req() req: AppRequest,
    @Param("id") offerId: string,
    @Body() body: unknown,
  ) {
    return this.recruit.declineOffer(
      req.actor,
      id(offerId),
      parse(recruitOfferDeclineSchema, body),
      req.requestId,
    );
  }
  @Post("offers/:id/:step") offerStep(
    @Req() req: AppRequest,
    @Param("id") offerId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    const chosen = parse(offerStep, step);
    return this.recruit.offerStep(
      req.actor,
      id(offerId),
      offerTarget[chosen],
      chosen === "withdraw"
        ? parse(recruitOfferWithdrawSchema, body)
        : parse(recruitOfferActionSchema, body),
      req.requestId,
    );
  }

  @Get("funnel") funnel(@Req() req: AppRequest, @Query() query: unknown) {
    return this.recruit.funnel(
      req.actor,
      parse(recruitFunnelQuerySchema, query),
    );
  }
}
