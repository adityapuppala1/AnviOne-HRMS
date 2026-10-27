import "reflect-metadata";
import {
  Module,
  Catch,
  HttpException,
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
import { PlatformStore } from "./platform.store";
import { SessionGuard, type AppRequest } from "./auth";
import { SessionController } from "./session.controller";
import { PeopleController } from "./people.controller";
import { OrganizationController } from "./organization.controller";
import { OnboardingController } from "./onboarding.controller";
import { LeaveController } from "./leave.controller";
import { AttendanceController } from "./attendance.controller";
import { CalendarController } from "./calendar.controller";
import { ApprovalsController } from "./approvals.controller";
import { DocumentController } from "./document.controller";
import { InsightsController } from "./insights.controller";
import { UpdatesController } from "./updates.controller";
import type { Config } from "./config";
import { RateLimits, storeUnavailableHandler } from "./rate-limit";

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
export async function createApp(config: Config) {
  const limits = await RateLimits.connect(config.RATE_LIMIT_URL);
  const store = new PlatformStore(config);
  await store.verifyRuntimeRole();
  @Module({
    controllers: [
      SessionController,
      PeopleController,
      OrganizationController,
      OnboardingController,
      LeaveController,
      AttendanceController,
      CalendarController,
      ApprovalsController,
      DocumentController,
      InsightsController,
      UpdatesController,
    ],
    providers: [
      { provide: PlatformStore, useValue: store },
      { provide: RateLimits, useValue: limits },
    ],
  })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });
  // Without a configured proxy, client addresses come from the socket only.
  app.set("trust proxy", config.TRUST_PROXY ?? false);
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
      store: limits.store("api"),
      // Availability over strictness for ordinary calls if the store is down.
      passOnStoreError: true,
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
      store: limits.store("auth"),
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (req: Request, res: Response) => {
        console.warn(
          JSON.stringify({
            event: "auth.rate_limited",
            client: req.ip,
            requestId: (req as AppRequest).requestId,
          }),
        );
        res.status(429).type("application/problem+json").json({
          status: 429,
          title: "Too many sign-in requests. Wait a minute and try again.",
        });
      },
    }),
  );
  // Uploads buffer up to 5 MB in memory, so they get a tighter budget than other calls.
  app.use(
    "/api/v1/documents",
    rateLimit({
      windowMs: 60000,
      store: limits.store("upload"),
      limit: 20,
      skip: (req) => req.method !== "POST" || req.path !== "/",
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req: Request, res: Response) =>
        res.status(429).type("application/problem+json").json({
          status: 429,
          title: "Too many uploads. Wait a minute and try again.",
        }),
    }),
  );
  app.use(storeUnavailableHandler);
  app.useGlobalGuards(new SessionGuard(store));
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  await app.init();
  return { app, store };
}
