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
  exitAcceptSchema,
  exitClearanceUpdateSchema,
  exitCompleteSchema,
  exitQuerySchema,
  exitRejectSchema,
  exitStartSchema,
  exitSubmitSchema,
  exitWithdrawSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { ExitStore } from "./exit.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Exits: employees resign and may withdraw while it is undecided; HR runs the rest.
@Controller()
export class ExitController {
  private readonly exits;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.exits = new ExitStore(store);
  }
  @Get("api/v1/exits/mine") mine(@Req() req: AppRequest) {
    return this.exits.mine(req.actor);
  }
  @Post("api/v1/exits/mine") submit(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.exits.submit(
      req.actor,
      parse(exitSubmitSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/exits/mine/:id/withdraw") withdrawMine(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exits.withdrawMine(
      req.actor,
      parse(z.uuid(), id),
      parse(exitWithdrawSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/exits") list(@Req() req: AppRequest, @Query() query: unknown) {
    return this.exits.list(req.actor, parse(exitQuerySchema, query));
  }
  @Post("api/v1/exits") start(@Req() req: AppRequest, @Body() body: unknown) {
    return this.exits.start(
      req.actor,
      parse(exitStartSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/exits/:id") detail(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.exits.detail(req.actor, parse(z.uuid(), id));
  }
  @Post("api/v1/exits/:id/accept") accept(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exits.accept(
      req.actor,
      parse(z.uuid(), id),
      parse(exitAcceptSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/exits/:id/reject") reject(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exits.reject(
      req.actor,
      parse(z.uuid(), id),
      parse(exitRejectSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/exits/:id/withdraw") withdraw(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exits.withdraw(
      req.actor,
      parse(z.uuid(), id),
      parse(exitWithdrawSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/exits/:id/complete") complete(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exits.complete(
      req.actor,
      parse(z.uuid(), id),
      parse(exitCompleteSchema, body),
      req.requestId,
    );
  }
  @Put("api/v1/exits/:id/clearances/:clearanceId") updateClearance(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Param("clearanceId") clearanceId: string,
    @Body() body: unknown,
  ) {
    return this.exits.updateClearance(
      req.actor,
      parse(z.uuid(), id),
      parse(z.uuid(), clearanceId),
      parse(exitClearanceUpdateSchema, body),
      req.requestId,
    );
  }
}
