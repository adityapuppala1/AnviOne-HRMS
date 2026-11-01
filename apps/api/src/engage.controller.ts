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
  engColleagueQuerySchema,
  engKudosCreateSchema,
  engKudosQuerySchema,
  engModerateSchema,
  engReactionSetSchema,
  engResponseCreateSchema,
  engSurveyActionSchema,
  engSurveyCreateSchema,
  engSurveyQuerySchema,
  engSurveyUpdateSchema,
  engValueCreateSchema,
  engValueUpdateSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { EngageStore } from "./engage.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

const id = (value: string) => parse(z.uuid(), value);
const surveyStep = z.enum(["publish", "close"]);
const moderation = z.enum(["hide", "restore"]);

// Recognition and engagement (ENG-01): peer recognition tagged with company values, reactions,
// HR moderation, and anonymous pulse surveys with aggregate-only results (at least 5 answers,
// after close). The database guards, policies and functions decide every write and read.
@Controller("api/v1/engage")
export class EngageController {
  private readonly engage;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.engage = new EngageStore(store);
  }

  @Get("values") values(@Req() req: AppRequest) {
    return this.engage.values(req.actor);
  }
  @Post("values") createValue(@Req() req: AppRequest, @Body() body: unknown) {
    return this.engage.createValue(
      req.actor,
      parse(engValueCreateSchema, body),
      req.requestId,
    );
  }
  @Put("values/:id") updateValue(
    @Req() req: AppRequest,
    @Param("id") valueId: string,
    @Body() body: unknown,
  ) {
    return this.engage.updateValue(
      req.actor,
      id(valueId),
      parse(engValueUpdateSchema, body),
      req.requestId,
    );
  }

  @Get("colleagues") colleagues(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.engage.colleagues(
      req.actor,
      parse(engColleagueQuerySchema, query),
    );
  }

  @Get("kudos") kudos(@Req() req: AppRequest, @Query() query: unknown) {
    return this.engage.listKudos(req.actor, parse(engKudosQuerySchema, query));
  }
  @Post("kudos") give(@Req() req: AppRequest, @Body() body: unknown) {
    return this.engage.giveKudos(
      req.actor,
      parse(engKudosCreateSchema, body),
      req.requestId,
    );
  }
  @Get("kudos/:id") kudosDetail(
    @Req() req: AppRequest,
    @Param("id") kudosId: string,
  ) {
    return this.engage.kudosDetail(req.actor, id(kudosId));
  }
  @Post("kudos/:id/reactions") react(
    @Req() req: AppRequest,
    @Param("id") kudosId: string,
    @Body() body: unknown,
  ) {
    return this.engage.react(
      req.actor,
      id(kudosId),
      parse(engReactionSetSchema, body),
      req.requestId,
    );
  }
  @Post("kudos/:id/reactions/remove") unreact(
    @Req() req: AppRequest,
    @Param("id") kudosId: string,
  ) {
    return this.engage.unreact(req.actor, id(kudosId), req.requestId);
  }
  @Post("kudos/:id/:action") moderate(
    @Req() req: AppRequest,
    @Param("id") kudosId: string,
    @Param("action") action: string,
    @Body() body: unknown,
  ) {
    return this.engage.moderate(
      req.actor,
      id(kudosId),
      parse(moderation, action),
      parse(engModerateSchema, body),
      req.requestId,
    );
  }

  @Get("surveys") surveys(@Req() req: AppRequest, @Query() query: unknown) {
    return this.engage.listSurveys(
      req.actor,
      parse(engSurveyQuerySchema, query),
    );
  }
  @Post("surveys") createSurvey(@Req() req: AppRequest, @Body() body: unknown) {
    return this.engage.createSurvey(
      req.actor,
      parse(engSurveyCreateSchema, body),
      req.requestId,
    );
  }
  @Get("surveys/:id") survey(
    @Req() req: AppRequest,
    @Param("id") surveyId: string,
  ) {
    return this.engage.surveyDetail(req.actor, id(surveyId));
  }
  @Put("surveys/:id") updateSurvey(
    @Req() req: AppRequest,
    @Param("id") surveyId: string,
    @Body() body: unknown,
  ) {
    return this.engage.updateSurvey(
      req.actor,
      id(surveyId),
      parse(engSurveyUpdateSchema, body),
      req.requestId,
    );
  }
  @Get("surveys/:id/results") results(
    @Req() req: AppRequest,
    @Param("id") surveyId: string,
  ) {
    return this.engage.results(req.actor, id(surveyId));
  }
  @Post("surveys/:id/responses") respond(
    @Req() req: AppRequest,
    @Param("id") surveyId: string,
    @Body() body: unknown,
  ) {
    return this.engage.respond(
      req.actor,
      id(surveyId),
      parse(engResponseCreateSchema, body),
      req.requestId,
    );
  }
  @Post("surveys/:id/:step") step(
    @Req() req: AppRequest,
    @Param("id") surveyId: string,
    @Param("step") step: string,
    @Body() body: unknown,
  ) {
    return this.engage.surveyStep(
      req.actor,
      id(surveyId),
      parse(surveyStep, step),
      parse(engSurveyActionSchema, body),
      req.requestId,
    );
  }
}
