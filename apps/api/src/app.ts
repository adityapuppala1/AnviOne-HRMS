import "reflect-metadata";
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Req,
  Res,
  Inject,
  Module,
  Catch,
  HttpException,
  BadRequestException,
  ForbiddenException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Response, Request, NextFunction } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  brandingUpdateSchema,
  directoryQuerySchema,
  roleSchema,
  organizationCreateSchema,
  organizationUpdateSchema,
  organizationQuerySchema,
  candidateCreateSchema,
  candidateActionSchema,
  candidateReviewSchema,
  candidateTaskCreateSchema,
  candidateTaskUpdateSchema,
  localReviewProposalSchema,
  localReviewDecisionSchema,
  candidateTaskAssignmentSchema,
  assignedTaskUpdateSchema,
  leaveRequestCreateSchema,
  leaveCancelSchema,
  leaveDecisionSchema,
  attendanceCheckInSchema,
  attendanceCheckOutSchema,
  attendanceCorrectionCreateSchema,
  attendanceCancelSchema,
  attendanceDecisionSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { OrganizationStore } from "./organization.store";
import { OnboardingStore } from "./onboarding.store";
import { LeaveStore } from "./leave.store";
import { AttendanceStore } from "./attendance.store";
import {
  SessionGuard,
  OidcService,
  cookieName,
  setSessionCookie,
  assertOrigin,
  type AppRequest,
} from "./auth";
import type { Config } from "./config";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException("Check your input and try again.");
  return result.data;
}
@Catch()
class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<AppRequest>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    if (status === 500)
      console.error(
        JSON.stringify({ event: "request.failed", requestId: req.requestId }),
      );
    res
      .status(status)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        status,
        title:
          status === 500
            ? "The service is unavailable. Try again shortly."
            : (error as HttpException).message,
        code: `HTTP_${status}`,
        requestId: req.requestId,
      });
  }
}
@Controller()
class PlatformController {
  private readonly oidc;
  private readonly organization;
  private readonly onboarding;
  private readonly leave;
  private readonly attendance;
  constructor(@Inject(PlatformStore) private readonly store: PlatformStore) {
    this.oidc = new OidcService(store);
    this.organization = new OrganizationStore(store);
    this.onboarding = new OnboardingStore(store);
    this.leave = new LeaveStore(store);
    this.attendance = new AttendanceStore(store);
  }
  @Get("healthz") health() {
    return { status: "ok" };
  }
  @Get("readyz") async ready() {
    await this.store.pool.query("SELECT 1");
    return { status: "ready" };
  }
  @Get("api/v1/auth/config") authConfig() {
    return {
      mode: this.store.config.AUTH_MODE,
      demo: this.store.config.AUTH_MODE === "demo",
    };
  }
  @Post("api/v1/auth/demo") async demo(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertOrigin(this.store, req);
    if (
      this.store.config.AUTH_MODE !== "demo" ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress ?? "",
      )
    )
      throw new ForbiddenException("Demo sign-in is unavailable.");
    const actor = await this.store.resolveIdentity(
      "urn:anvione:local-demo",
      "maya-demo",
    );
    setSessionCookie(
      this.store,
      res,
      await this.store.createSession(
        actor,
        req.requestId,
        req.cookies?.[cookieName(this.store)],
      ),
    );
    return { signedIn: true };
  }
  @Get("api/v1/auth/login") login(@Res() res: Response) {
    return this.oidc.start(res);
  }
  @Get("api/v1/auth/callback") async callback(
    @Req() req: AppRequest,
    @Res() res: Response,
  ) {
    try {
      await this.oidc.callback(req, res);
    } catch {
      console.warn(
        JSON.stringify({ event: "oidc.denied", requestId: req.requestId }),
      );
      res.redirect("/login?error=access");
    }
  }
  @Post("api/v1/auth/logout") async logout(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.store.logout(
      req.actor,
      req.cookies[cookieName(this.store)],
      req.requestId,
    );
    res.clearCookie(cookieName(this.store), { path: "/" });
    return { signedOut: true };
  }
  @Get("api/v1/me") me(@Req() req: AppRequest) {
    return this.store.me(req.actor);
  }
  @Post("api/v1/session/role-context") async role(
    @Req() req: AppRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { role } = parse(z.object({ role: roleSchema }).strict(), body);
    const token = await this.store.switchRole(
      req.actor,
      role,
      req.cookies[cookieName(this.store)],
      req.requestId,
    );
    setSessionCookie(this.store, res, token);
    return { changed: true };
  }
  @Get("api/v1/employees") directory(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.store.directory(req.actor, parse(directoryQuerySchema, query));
  }
  @Get("api/v1/employees/:id") employee(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.store.employee(req.actor, parse(z.uuid(), id));
  }
  @Get("api/v1/dashboard") dashboard(@Req() req: AppRequest) {
    return this.store.dashboard(req.actor);
  }
  @Get("api/v1/branding/active") branding(@Req() req: AppRequest) {
    return this.store.branding(req.actor);
  }
  @Put("api/v1/branding/active") publish(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.store.updateBranding(
      req.actor,
      parse(brandingUpdateSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/audit-events") audit(@Req() req: AppRequest) {
    return this.store.auditEvents(req.actor);
  }
  @Get("api/v1/organization") organizationUnits(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.organization.list(
      req.actor,
      parse(organizationQuerySchema, query),
    );
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
  @Get("api/v1/leave") leaveOverview(@Req() req: AppRequest) {
    return this.leave.overview(req.actor);
  }
  @Get("api/v1/leave/approvals") leaveApprovals(@Req() req: AppRequest) {
    return this.leave.approvals(req.actor);
  }
  @Post("api/v1/leave/requests") requestLeave(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.leave.create(
      req.actor,
      parse(leaveRequestCreateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/leave/requests/:id/cancel") cancelLeave(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.leave.cancel(
      req.actor,
      parse(z.uuid(), id),
      parse(leaveCancelSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/leave/requests/:id/decision") decideLeave(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.leave.decide(
      req.actor,
      parse(z.uuid(), id),
      parse(leaveDecisionSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/attendance") attendanceOverview(@Req() req: AppRequest) {
    return this.attendance.overview(req.actor);
  }
  @Get("api/v1/attendance/team") attendanceTeam(@Req() req: AppRequest) {
    return this.attendance.team(req.actor);
  }
  @Post("api/v1/attendance/check-in") checkIn(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    parse(attendanceCheckInSchema, body ?? {});
    return this.attendance.checkIn(req.actor, req.requestId);
  }
  @Post("api/v1/attendance/check-out") checkOut(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.attendance.checkOut(
      req.actor,
      parse(attendanceCheckOutSchema, body).version,
      req.requestId,
    );
  }
  @Post("api/v1/attendance/corrections") requestCorrection(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.attendance.requestCorrection(
      req.actor,
      parse(attendanceCorrectionCreateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/attendance/corrections/:id/cancel") cancelCorrection(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.attendance.cancelCorrection(
      req.actor,
      parse(z.uuid(), id),
      parse(attendanceCancelSchema, body).version,
      req.requestId,
    );
  }
  @Post("api/v1/attendance/corrections/:id/decision") decideCorrection(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.attendance.decideCorrection(
      req.actor,
      parse(z.uuid(), id),
      parse(attendanceDecisionSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/organization") createOrganizationUnit(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.organization.create(
      req.actor,
      parse(organizationCreateSchema, body),
      req.requestId,
    );
  }
  @Put("api/v1/organization/:id") updateOrganizationUnit(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.organization.update(
      req.actor,
      parse(z.uuid(), id),
      parse(organizationUpdateSchema, body),
      req.requestId,
    );
  }
}
export async function createApp(config: Config) {
  const store = new PlatformStore(config);
  await store.verifyRuntimeRole();
  @Module({
    controllers: [PlatformController],
    providers: [{ provide: PlatformStore, useValue: store }],
  })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });
  app.useBodyParser("json", { limit: "16kb" });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );
  app.use(cookieParser());
  app.use((req: AppRequest, res: Response, next: NextFunction) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    const allowedHosts = new Set([
      new URL(config.APP_ORIGIN).host,
      `${config.API_HOST}:${config.API_PORT}`,
    ]);
    if (!allowedHosts.has(req.headers.host ?? ""))
      return res.status(403).json({ title: "Host is not allowed." });
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req: Request, res: Response) =>
        res.status(429).type("application/problem+json").json({
          status: 429,
          title: "Too many requests. Wait a minute and retry.",
        }),
    }),
  );
  app.use(
    "/api/v1/auth",
    rateLimit({
      windowMs: 60000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.useGlobalGuards(new SessionGuard(store));
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  await app.init();
  return { app, store };
}
