import "reflect-metadata";
import {
  Controller,
  Get,
  Post,
  Put,
  Req,
  Res,
  Body,
  Param,
  Inject,
  Module,
  Catch,
  HttpException,
  BadRequestException,
  ForbiddenException,
  UploadedFile,
  UseInterceptors,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  candidateChallengeSchema,
  candidateExchangeSchema,
  candidateSaveSchema,
  candidateSubmitSchema,
  candidateTaskUpdateSchema,
  candidateDocumentUploadSchema,
} from "@anvi/contracts";
import { CandidateStore, type CandidateActor } from "./candidate.store";
import { csrfMatches } from "./auth";
import type { Config } from "./config";
import { RateLimits, storeUnavailableHandler } from "./rate-limit";
import { MAX_DOCUMENT_BYTES } from "./document.validation";
import type { UploadedFile as Upload } from "./document.store";

const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
type CandidateRequest = Request & {
  candidate: CandidateActor;
  requestId: string;
};
const cookie = "anvi_candidate_preview";
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException("Check your form and try again.");
  return result.data;
};
@Catch()
class CandidateProblem implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<CandidateRequest>(),
      res = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    if (status === 500)
      console.error(
        JSON.stringify({
          event: "candidate.request_failed",
          code:
            typeof error === "object" && error && "code" in error
              ? error.code
              : "internal",
          message: error instanceof Error ? error.message : String(error),
          requestId: req.requestId,
        }),
      );
    res
      .status(status)
      .type("application/problem+json")
      .json({
        status,
        title:
          status === 500
            ? "The onboarding service is unavailable. Try again."
            : (error as HttpException).message,
        requestId: req.requestId,
      });
  }
}
@Controller()
class CandidateController {
  constructor(@Inject(CandidateStore) private readonly store: CandidateStore) {}
  @Get("readyz") async ready() {
    await this.store.pool.query("SELECT 1");
    return { status: "ready" };
  }
  @Post("api/candidate/challenge") challenge(@Body() body: unknown) {
    const input = parse(candidateChallengeSchema, body);
    return this.store.challenge(input.token);
  }
  @Post("api/candidate/exchange") async exchange(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(candidateExchangeSchema, body);
    const token = await this.store.exchange(
      input.token,
      input.challengeId,
      input.code,
    );
    res.cookie(cookie, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
      maxAge: 3600000,
    });
    return { verified: true };
  }
  @Get("api/candidate/session") me(@Req() req: CandidateRequest) {
    return this.store.me(req.candidate);
  }
  @Put("api/candidate/draft") save(
    @Req() req: CandidateRequest,
    @Body() body: unknown,
  ) {
    const input = parse(candidateSaveSchema, body);
    return this.store.save(req.candidate, input.version, input.draft);
  }
  @Post("api/candidate/submit") submit(
    @Req() req: CandidateRequest,
    @Body() body: unknown,
  ) {
    const input = parse(candidateSubmitSchema, body);
    return this.store.submit(req.candidate, input.version, req.requestId);
  }
  @Post("api/candidate/logout") async logout(
    @Req() req: CandidateRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.store.logout(req.cookies[cookie]);
    res.clearCookie(cookie, { path: "/" });
    return { signedOut: true };
  }
  @Post("api/candidate/tasks/:taskId") updateTask(
    @Req() req: CandidateRequest,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.store.updateTask(
      req.candidate,
      parse(z.uuid(), taskId),
      parse(candidateTaskUpdateSchema, body),
      req.requestId,
    );
  }
  @Get("api/candidate/documents") documents(@Req() req: CandidateRequest) {
    return this.store.documents(req.candidate);
  }
  @Post("api/candidate/documents")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: MAX_DOCUMENT_BYTES,
        files: 1,
        fields: 2,
        parts: 3,
        fieldSize: 200,
      },
    }),
  )
  uploadDocument(
    @Req() req: CandidateRequest,
    @Body() body: unknown,
    @UploadedFile() file: Upload | undefined,
  ) {
    const input = parse(candidateDocumentUploadSchema, body);
    return this.store.uploadDocument(req.candidate, input, file, req.requestId);
  }
  @Get("api/candidate/documents/:id/content") async documentContent(
    @Req() req: CandidateRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const file = await this.store.documentContent(
      req.candidate,
      parse(z.uuid(), id),
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
export async function createCandidateApp(config: Config, port = 4001) {
  const limits = await RateLimits.connect(config.RATE_LIMIT_URL);
  const store = new CandidateStore(config);
  await store.verifyRole();
  @Module({
    controllers: [CandidateController],
    providers: [
      { provide: CandidateStore, useValue: store },
      { provide: RateLimits, useValue: limits },
    ],
  })
  class CandidateModule {}
  const app = await NestFactory.create<NestExpressApplication>(
    CandidateModule,
    { logger: ["error", "warn"], bodyParser: false },
  );
  app.useBodyParser("json", { limit: "12kb" });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );
  app.use(cookieParser());
  app.use((req: CandidateRequest, res: Response, next: NextFunction) => {
    req.requestId = randomUUID();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Request-Id", req.requestId);
    if (
      ![new URL(config.CANDIDATE_ORIGIN).host, `127.0.0.1:${port}`].includes(
        req.headers.host ?? "",
      )
    )
      return res.status(403).json({ title: "Host is not allowed." });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.headers.origin !== config.CANDIDATE_ORIGIN ||
        req.headers["sec-fetch-site"] === "cross-site")
    )
      return res
        .status(403)
        .json({ title: "This request origin is not allowed." });
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60000,
      store: limits.store("candidate"),
      passOnStoreError: true,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/candidate/challenge",
    rateLimit({
      windowMs: 60000,
      store: limits.store("candidate-challenge"),
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/candidate/exchange",
    rateLimit({
      windowMs: 60000,
      store: limits.store("candidate-exchange"),
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(storeUnavailableHandler);
  app.useGlobalGuards({
    async canActivate(context) {
      const req = context.switchToHttp().getRequest<CandidateRequest>();
      if (
        [
          "/readyz",
          "/api/candidate/challenge",
          "/api/candidate/exchange",
        ].includes(req.path)
      )
        return true;
      req.candidate = await store.session(req.cookies?.[cookie]);
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        !csrfMatches(req.candidate.csrfToken, req.headers["x-csrf-token"])
      )
        throw new ForbiddenException(
          "Your verification changed. Reload and try again.",
        );
      return true;
    },
  });
  app.useGlobalFilters(new CandidateProblem());
  await app.init();
  return { app, store };
}
