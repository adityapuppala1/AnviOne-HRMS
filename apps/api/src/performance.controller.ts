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
  perfAlignableQuerySchema,
  perfCycleActionSchema,
  perfCycleCreateSchema,
  perfCycleQuerySchema,
  perfCycleUpdateSchema,
  perfKeyResultCreateSchema,
  perfKeyResultUpdateSchema,
  perfObjectiveActionSchema,
  perfObjectiveCancelSchema,
  perfObjectiveCreateSchema,
  perfObjectiveQuerySchema,
  perfObjectiveUpdateSchema,
  perfProgressCreateSchema,
  perfProgressQuerySchema,
  perfReviewFinaliseSchema,
  perfReviewQuerySchema,
  perfReviewSubmitSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { PerformanceStore } from "./performance.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

const id = (value: string) => parse(z.uuid(), value);
const objectiveStep = z.enum(["activate", "complete", "cancel"]);
const cycleStep = z.enum(["open", "close", "cancel"]);
const reviewKind = z.enum(["self", "manager"]);

// Performance basics (PERF-01): goals with key results and review cycles. The owner, their
// manager and HR see and change goals; HR runs cycles and finalises reviews. The database
// guards decide every write. Ratings are human inputs only.
@Controller("api/v1/performance")
export class PerformanceController {
  private readonly performance;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.performance = new PerformanceStore(store);
  }

  @Get("objectives") objectives(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.performance.listObjectives(
      req.actor,
      parse(perfObjectiveQuerySchema, query),
    );
  }
  @Post("objectives") createObjective(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.performance.createObjective(
      req.actor,
      parse(perfObjectiveCreateSchema, body),
      req.requestId,
    );
  }
  @Get("objectives/alignable") alignable(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.performance.alignable(
      req.actor,
      parse(perfAlignableQuerySchema, query),
    );
  }
  @Get("objectives/:id") objective(
    @Req() req: AppRequest,
    @Param("id") objectiveId: string,
  ) {
    return this.performance.objectiveDetail(req.actor, id(objectiveId));
  }
  @Put("objectives/:id") updateObjective(
    @Req() req: AppRequest,
    @Param("id") objectiveId: string,
    @Body() body: unknown,
  ) {
    return this.performance.updateObjective(
      req.actor,
      id(objectiveId),
      parse(perfObjectiveUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("objectives/:id/key-results") addKeyResult(
    @Req() req: AppRequest,
    @Param("id") objectiveId: string,
    @Body() body: unknown,
  ) {
    return this.performance.addKeyResult(
      req.actor,
      id(objectiveId),
      parse(perfKeyResultCreateSchema, body),
      req.requestId,
    );
  }
  @Post("objectives/:id/:step") objectiveStep(
    @Req() req: AppRequest,
    @Param("id") objectiveId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    const chosen = parse(objectiveStep, step);
    const input =
      chosen === "cancel"
        ? parse(perfObjectiveCancelSchema, body)
        : parse(perfObjectiveActionSchema, body);
    return this.performance.objectiveStep(
      req.actor,
      id(objectiveId),
      chosen,
      input,
      req.requestId,
    );
  }

  @Put("key-results/:id") updateKeyResult(
    @Req() req: AppRequest,
    @Param("id") keyResultId: string,
    @Body() body: unknown,
  ) {
    return this.performance.updateKeyResult(
      req.actor,
      id(keyResultId),
      parse(perfKeyResultUpdateSchema, body),
      req.requestId,
    );
  }
  @Get("key-results/:id/progress") progress(
    @Req() req: AppRequest,
    @Param("id") keyResultId: string,
    @Query() query: unknown,
  ) {
    return this.performance.progressHistory(
      req.actor,
      id(keyResultId),
      parse(perfProgressQuerySchema, query),
    );
  }
  @Post("key-results/:id/progress") recordProgress(
    @Req() req: AppRequest,
    @Param("id") keyResultId: string,
    @Body() body: unknown,
  ) {
    return this.performance.recordProgress(
      req.actor,
      id(keyResultId),
      parse(perfProgressCreateSchema, body),
      req.requestId,
    );
  }

  @Get("cycles") cycles(@Req() req: AppRequest, @Query() query: unknown) {
    return this.performance.listCycles(
      req.actor,
      parse(perfCycleQuerySchema, query),
    );
  }
  @Post("cycles") createCycle(@Req() req: AppRequest, @Body() body: unknown) {
    return this.performance.createCycle(
      req.actor,
      parse(perfCycleCreateSchema, body),
      req.requestId,
    );
  }
  @Get("cycles/:id") cycle(
    @Req() req: AppRequest,
    @Param("id") cycleId: string,
  ) {
    return this.performance.cycleDetail(req.actor, id(cycleId));
  }
  @Put("cycles/:id") updateCycle(
    @Req() req: AppRequest,
    @Param("id") cycleId: string,
    @Body() body: unknown,
  ) {
    return this.performance.updateCycle(
      req.actor,
      id(cycleId),
      parse(perfCycleUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("cycles/:id/:step") cycleStep(
    @Req() req: AppRequest,
    @Param("id") cycleId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    const chosen = parse(cycleStep, step);
    const input = parse(perfCycleActionSchema, body);
    return chosen === "open"
      ? this.performance.openCycle(req.actor, id(cycleId), input, req.requestId)
      : this.performance.cycleStep(
          req.actor,
          id(cycleId),
          chosen,
          input,
          req.requestId,
        );
  }

  @Get("reviews") reviews(@Req() req: AppRequest, @Query() query: unknown) {
    return this.performance.listReviews(
      req.actor,
      parse(perfReviewQuerySchema, query),
    );
  }
  @Get("reviews/:id") review(
    @Req() req: AppRequest,
    @Param("id") reviewId: string,
  ) {
    return this.performance.reviewDetail(req.actor, id(reviewId));
  }
  @Post("reviews/:id/finalise") finalise(
    @Req() req: AppRequest,
    @Param("id") reviewId: string,
    @Body() body: unknown,
  ) {
    return this.performance.finaliseReview(
      req.actor,
      id(reviewId),
      parse(perfReviewFinaliseSchema, body),
      req.requestId,
    );
  }
  @Post("reviews/:id/:kind") submit(
    @Req() req: AppRequest,
    @Param("id") reviewId: string,
    @Param("kind") kind: string,
    @Body() body: unknown,
  ) {
    return this.performance.submitReview(
      req.actor,
      id(reviewId),
      parse(reviewKind, kind),
      parse(perfReviewSubmitSchema, body),
      req.requestId,
    );
  }
}
