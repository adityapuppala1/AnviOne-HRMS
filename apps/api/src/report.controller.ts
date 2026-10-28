import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import { z } from "zod";
import {
  reportExportSchema,
  reportRunSchema,
  savedReportArchiveSchema,
  savedReportCreateSchema,
  savedReportUpdateSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { REPORT_LIMITS, ReportStore } from "./report.store";
import { csvFileName } from "./report.csv";
import { RateLimits, StoreUnavailable } from "./rate-limit";
import { parse } from "./http";
import type { AppRequest } from "./auth";

// Reports: a catalog of fixed datasets, on-screen runs, HR-only CSV export and
// per-person saved definitions.
@Controller()
export class ReportController {
  private readonly reports;
  private readonly exportLimit: RateLimitRequestHandler;
  private readonly runLimit: RateLimitRequestHandler;
  constructor(
    @Inject(PlatformStore) store: PlatformStore,
    @Inject(RateLimits) limits: RateLimits,
  ) {
    this.reports = new ReportStore(store);
    // Keyed on the person (tenant and employee), not the session, address or role, so
    // switching roles or signing in again never resets the budget. Fails closed if
    // the counter store is down.
    const limiter = (name: string, limit: number, title: string) =>
      rateLimit({
        windowMs: 60000,
        limit,
        store: limits.store(name),
        keyGenerator: (req: Request) => {
          const actor = (req as AppRequest).actor;
          return `${actor.tenantId}:${actor.employeeId}`;
        },
        standardHeaders: "draft-8",
        legacyHeaders: false,
        validate: { keyGeneratorIpFallback: false },
        handler: (_req: Request, _res: Response, next: NextFunction) =>
          next(new HttpException(title, 429)),
      });
    this.exportLimit = limiter(
      "report-export",
      REPORT_LIMITS.exportsPerMinute,
      "Too many exports. Wait a minute and try again.",
    );
    this.runLimit = limiter(
      "report-run",
      REPORT_LIMITS.runsPerMinute,
      "Too many report runs. Wait a minute and try again.",
    );
  }

  private limit(
    handler: RateLimitRequestHandler,
    req: AppRequest,
    res: Response,
  ) {
    return new Promise<void>((resolve, reject) => {
      void handler(req, res, (error?: unknown) => {
        if (error instanceof StoreUnavailable)
          reject(
            new ServiceUnavailableException(
              "The service is unavailable. Try again shortly.",
            ),
          );
        else if (error)
          reject(error instanceof Error ? error : new Error("rate limit"));
        else resolve();
      });
    });
  }

  @Get("api/v1/reports/datasets") datasets(@Req() req: AppRequest) {
    return this.reports.catalog(req.actor);
  }

  @Post("api/v1/reports/run")
  @HttpCode(200)
  async run(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    // Permission, input and catalog checks first; only a runnable report spends budget.
    const { definition } = parse(reportRunSchema, body);
    this.reports.compile(req.actor, definition);
    await this.limit(this.runLimit, req, res);
    return this.reports.run(req.actor, definition);
  }

  @Post("api/v1/reports/export")
  async export(
    @Req() req: AppRequest,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    // Permission first, so people who may not export never spend or learn the budget.
    this.reports.requireExport(req.actor);
    const input = parse(reportExportSchema, body);
    this.reports.compile(req.actor, input.definition);
    await this.limit(this.exportLimit, req, res);
    const file = await this.reports.export(
      req.actor,
      input.definition,
      req.requestId,
    );
    const name = csvFileName(
      input.fileName ?? `anvione-${file.dataset}`,
      file.today,
    );
    res
      .status(200)
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Report-Export-Id": file.exportId,
        "X-Report-Row-Count": String(file.rowCount),
        "X-Report-Truncated": String(file.truncated),
      })
      .send(Buffer.from(file.csv, "utf8"));
  }

  @Get("api/v1/reports/saved") saved(@Req() req: AppRequest) {
    return this.reports.saved(req.actor);
  }

  @Post("api/v1/reports/saved") create(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.reports.create(
      req.actor,
      parse(savedReportCreateSchema, body),
      req.requestId,
    );
  }

  @Put("api/v1/reports/saved/:id") update(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.reports.update(
      req.actor,
      parse(z.uuid(), id),
      parse(savedReportUpdateSchema, body),
      req.requestId,
    );
  }

  @Post("api/v1/reports/saved/:id/archive") archive(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.reports.archive(
      req.actor,
      parse(z.uuid(), id),
      parse(savedReportArchiveSchema, body),
      req.requestId,
    );
  }
}
