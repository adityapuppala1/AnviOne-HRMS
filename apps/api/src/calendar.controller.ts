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
  calendarQuerySchema,
  holidayCreateSchema,
  holidayUpdateSchema,
  workWeekUpdateSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { CalendarStore } from "./calendar.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Working week and holidays.
@Controller()
export class CalendarController {
  private readonly calendar;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.calendar = new CalendarStore(store);
  }
  @Get("api/v1/calendar") calendarView(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.calendar.view(
      req.actor,
      parse(calendarQuerySchema, query).year,
    );
  }
  @Post("api/v1/calendar/holidays") createHoliday(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.calendar.createHoliday(
      req.actor,
      parse(holidayCreateSchema, body),
      req.requestId,
    );
  }
  @Put("api/v1/calendar/holidays/:id") updateHoliday(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.calendar.updateHoliday(
      req.actor,
      parse(z.uuid(), id),
      parse(holidayUpdateSchema, body),
      req.requestId,
    );
  }
  @Put("api/v1/calendar/work-week") updateWorkWeek(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.calendar.updateWorkWeek(
      req.actor,
      parse(workWeekUpdateSchema, body),
      req.requestId,
    );
  }
}
