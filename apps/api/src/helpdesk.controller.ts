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
  hdArticleActionSchema,
  hdArticleCreateSchema,
  hdArticleLinkSchema,
  hdArticleQuerySchema,
  hdArticleUpdateSchema,
  hdAssignSchema,
  hdCaseActionSchema,
  hdCaseCloseSchema,
  hdCaseCreateSchema,
  hdCaseQuerySchema,
  hdCategoryCreateSchema,
  hdCategoryUpdateSchema,
  hdCommentCreateSchema,
  hdConfidentialSetSchema,
  hdPrioritySchema,
  hdPrioritySetSchema,
  hdSlaUpdateSchema,
  hdSuggestQuerySchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { HelpdeskStore } from "./helpdesk.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

const id = (value: string) => parse(z.uuid(), value);
const caseStep = z.enum([
  "start",
  "wait",
  "resume",
  "resolve",
  "reopen",
  "cancel",
]);
const articleStep = z.enum(["publish", "archive"]);

// HR helpdesk (HLP-01): employee cases with categories, service targets, an append-only thread
// with internal notes, and knowledge articles suggested by keyword matching (no AI). The
// database guards and policies decide every write and every read.
@Controller("api/v1/helpdesk")
export class HelpdeskController {
  private readonly helpdesk;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.helpdesk = new HelpdeskStore(store);
  }

  @Get("categories") categories(@Req() req: AppRequest) {
    return this.helpdesk.categories(req.actor);
  }
  @Post("categories") createCategory(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.helpdesk.createCategory(
      req.actor,
      parse(hdCategoryCreateSchema, body),
      req.requestId,
    );
  }
  @Put("categories/:id") updateCategory(
    @Req() req: AppRequest,
    @Param("id") categoryId: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.updateCategory(
      req.actor,
      id(categoryId),
      parse(hdCategoryUpdateSchema, body),
      req.requestId,
    );
  }

  @Get("sla") sla(@Req() req: AppRequest) {
    return this.helpdesk.sla(req.actor);
  }
  @Put("sla/:priority") updateSla(
    @Req() req: AppRequest,
    @Param("priority") priority: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.updateSla(
      req.actor,
      parse(hdPrioritySchema, priority),
      parse(hdSlaUpdateSchema, body),
      req.requestId,
    );
  }

  @Get("agents") agents(@Req() req: AppRequest) {
    return this.helpdesk.agents(req.actor);
  }

  @Get("articles") articles(@Req() req: AppRequest, @Query() query: unknown) {
    return this.helpdesk.listArticles(
      req.actor,
      parse(hdArticleQuerySchema, query),
    );
  }
  @Post("articles") createArticle(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.helpdesk.createArticle(
      req.actor,
      parse(hdArticleCreateSchema, body),
      req.requestId,
    );
  }
  @Get("articles/suggest") suggest(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.helpdesk.suggest(req.actor, parse(hdSuggestQuerySchema, query));
  }
  @Get("articles/:id") article(
    @Req() req: AppRequest,
    @Param("id") articleId: string,
  ) {
    return this.helpdesk.articleDetail(req.actor, id(articleId));
  }
  @Put("articles/:id") updateArticle(
    @Req() req: AppRequest,
    @Param("id") articleId: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.updateArticle(
      req.actor,
      id(articleId),
      parse(hdArticleUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("articles/:id/:step") articleStep(
    @Req() req: AppRequest,
    @Param("id") articleId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.articleStep(
      req.actor,
      id(articleId),
      parse(articleStep, step),
      parse(hdArticleActionSchema, body),
      req.requestId,
    );
  }

  @Get("cases") cases(@Req() req: AppRequest, @Query() query: unknown) {
    return this.helpdesk.listCases(req.actor, parse(hdCaseQuerySchema, query));
  }
  @Post("cases") createCase(@Req() req: AppRequest, @Body() body: unknown) {
    return this.helpdesk.createCase(
      req.actor,
      parse(hdCaseCreateSchema, body),
      req.requestId,
    );
  }
  @Get("cases/:id") case(@Req() req: AppRequest, @Param("id") caseId: string) {
    return this.helpdesk.caseDetail(req.actor, id(caseId));
  }
  @Post("cases/:id/comments") comment(
    @Req() req: AppRequest,
    @Param("id") caseId: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.addComment(
      req.actor,
      id(caseId),
      parse(hdCommentCreateSchema, body),
      req.requestId,
    );
  }
  @Post("cases/:id/assign") assign(
    @Req() req: AppRequest,
    @Param("id") caseId: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.assign(
      req.actor,
      id(caseId),
      parse(hdAssignSchema, body),
      req.requestId,
    );
  }
  @Post("cases/:id/priority") priority(
    @Req() req: AppRequest,
    @Param("id") caseId: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.setPriority(
      req.actor,
      id(caseId),
      parse(hdPrioritySetSchema, body),
      req.requestId,
    );
  }
  @Post("cases/:id/confidential") confidential(
    @Req() req: AppRequest,
    @Param("id") caseId: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.setConfidential(
      req.actor,
      id(caseId),
      parse(hdConfidentialSetSchema, body),
      req.requestId,
    );
  }
  @Post("cases/:id/articles") link(
    @Req() req: AppRequest,
    @Param("id") caseId: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.linkArticle(
      req.actor,
      id(caseId),
      parse(hdArticleLinkSchema, body),
      req.requestId,
    );
  }
  @Post("cases/:id/close") close(
    @Req() req: AppRequest,
    @Param("id") caseId: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.closeCase(
      req.actor,
      id(caseId),
      parse(hdCaseCloseSchema, body),
      req.requestId,
    );
  }
  @Post("cases/:id/:step") step(
    @Req() req: AppRequest,
    @Param("id") caseId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    return this.helpdesk.caseStep(
      req.actor,
      id(caseId),
      parse(caseStep, step),
      parse(hdCaseActionSchema, body),
      req.requestId,
    );
  }
}
