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
import type { Config } from "./config";

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
    ],
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
