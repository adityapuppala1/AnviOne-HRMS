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
  assetAcknowledgeSchema,
  assetCreateSchema,
  assetIssueSchema,
  assetQuerySchema,
  assetReturnSchema,
  assetStatusChangeSchema,
  assetUpdateSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { AssetStore } from "./asset.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Company assets: HR keeps the inventory; holders see and acknowledge their own.
@Controller()
export class AssetController {
  private readonly assets;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.assets = new AssetStore(store);
  }
  @Get("api/v1/assets/mine") mine(@Req() req: AppRequest) {
    return this.assets.mine(req.actor);
  }
  @Post("api/v1/assets/assignments/:id/acknowledge") acknowledge(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.assets.acknowledge(
      req.actor,
      parse(z.uuid(), id),
      parse(assetAcknowledgeSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/assets") list(@Req() req: AppRequest, @Query() query: unknown) {
    return this.assets.list(req.actor, parse(assetQuerySchema, query));
  }
  @Post("api/v1/assets") create(@Req() req: AppRequest, @Body() body: unknown) {
    return this.assets.create(
      req.actor,
      parse(assetCreateSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/assets/:id") detail(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.assets.detail(req.actor, parse(z.uuid(), id));
  }
  @Put("api/v1/assets/:id") update(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.assets.update(
      req.actor,
      parse(z.uuid(), id),
      parse(assetUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/assets/:id/issue") issue(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.assets.issue(
      req.actor,
      parse(z.uuid(), id),
      parse(assetIssueSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/assets/:id/return") receive(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.assets.receive(
      req.actor,
      parse(z.uuid(), id),
      parse(assetReturnSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/assets/:id/status") changeStatus(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.assets.changeStatus(
      req.actor,
      parse(z.uuid(), id),
      parse(assetStatusChangeSchema, body),
      req.requestId,
    );
  }
}
