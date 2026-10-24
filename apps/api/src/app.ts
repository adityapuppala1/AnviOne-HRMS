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
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
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
  constructor(@Inject(PlatformStore) private readonly store: PlatformStore) {
    this.oidc = new OidcService(store);
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
