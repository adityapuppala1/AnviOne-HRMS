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
  lrnAssignSchema,
  lrnAssignmentQuerySchema,
  lrnCompleteSchema,
  lrnComplianceQuerySchema,
  lrnCourseCreateSchema,
  lrnCourseQuerySchema,
  lrnCourseUpdateSchema,
  lrnReasonSchema,
  lrnVersionSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { LearnStore } from "./learn.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

const id = (value: string) => parse(z.uuid(), value);
const courseStep = z.enum(["publish", "archive"]);
const recordKind = z.enum(["complete", "waive"]);

// Learning (LRN-01): course catalogue, assignments (person or department/location snapshot),
// self-enrolment, progress and an append-only completion history; overdue and renewal derived.
// The database guards and policies decide every write and read.
@Controller("api/v1/learning")
export class LearnController {
  private readonly learn;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.learn = new LearnStore(store);
  }

  @Get("courses") courses(@Req() req: AppRequest, @Query() query: unknown) {
    return this.learn.listCourses(
      req.actor,
      parse(lrnCourseQuerySchema, query),
    );
  }
  @Post("courses") createCourse(@Req() req: AppRequest, @Body() body: unknown) {
    return this.learn.createCourse(
      req.actor,
      parse(lrnCourseCreateSchema, body),
      req.requestId,
    );
  }
  @Get("courses/:id") course(
    @Req() req: AppRequest,
    @Param("id") courseId: string,
  ) {
    return this.learn.courseDetail(req.actor, id(courseId));
  }
  @Put("courses/:id") updateCourse(
    @Req() req: AppRequest,
    @Param("id") courseId: string,
    @Body() body: unknown,
  ) {
    return this.learn.updateCourse(
      req.actor,
      id(courseId),
      parse(lrnCourseUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("courses/:id/assign") assign(
    @Req() req: AppRequest,
    @Param("id") courseId: string,
    @Body() body: unknown,
  ) {
    return this.learn.assign(
      req.actor,
      id(courseId),
      parse(lrnAssignSchema, body),
      req.requestId,
    );
  }
  @Post("courses/:id/enrol") enrol(
    @Req() req: AppRequest,
    @Param("id") courseId: string,
  ) {
    return this.learn.enrol(req.actor, id(courseId), req.requestId);
  }
  @Post("courses/:id/:step") courseStep(
    @Req() req: AppRequest,
    @Param("id") courseId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    return this.learn.courseStep(
      req.actor,
      id(courseId),
      parse(courseStep, step),
      parse(lrnVersionSchema, body),
      req.requestId,
    );
  }

  @Get("assignments") assignments(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.learn.listAssignments(
      req.actor,
      parse(lrnAssignmentQuerySchema, query),
    );
  }
  @Get("assignments/:id") assignment(
    @Req() req: AppRequest,
    @Param("id") assignmentId: string,
  ) {
    return this.learn.assignmentDetail(req.actor, id(assignmentId));
  }
  @Post("assignments/:id/start") start(
    @Req() req: AppRequest,
    @Param("id") assignmentId: string,
    @Body() body: unknown,
  ) {
    return this.learn.start(
      req.actor,
      id(assignmentId),
      parse(lrnVersionSchema, body),
      req.requestId,
    );
  }
  @Post("assignments/:id/complete") complete(
    @Req() req: AppRequest,
    @Param("id") assignmentId: string,
    @Body() body: unknown,
  ) {
    return this.learn.complete(
      req.actor,
      id(assignmentId),
      parse(lrnCompleteSchema, body),
      req.requestId,
    );
  }
  // HR on someone else's behalf: record-complete or waive, with a reason.
  @Post("assignments/:id/hr/:kind") onBehalf(
    @Req() req: AppRequest,
    @Param("id") assignmentId: string,
    @Param("kind") kind: string,
    @Body() body: unknown,
  ) {
    return this.learn.recordOnBehalf(
      req.actor,
      id(assignmentId),
      parse(recordKind, kind),
      parse(lrnReasonSchema, body),
      req.requestId,
    );
  }

  @Get("reports/compliance") compliance(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.learn.compliance(
      req.actor,
      parse(lrnComplianceQuerySchema, query),
    );
  }
}
