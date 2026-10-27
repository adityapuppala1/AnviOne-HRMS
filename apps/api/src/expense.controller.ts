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
  expenseApproveSchema,
  expenseCancelSchema,
  expenseCategoryCreateSchema,
  expenseCategoryUpdateSchema,
  expensePaySchema,
  expenseQuerySchema,
  expenseRejectSchema,
  expenseSubmitSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { ExpenseStore } from "./expense.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// Expenses: employees claim and may cancel while undecided; the manager or HR decides; HR pays.
@Controller()
export class ExpenseController {
  private readonly expenses;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.expenses = new ExpenseStore(store);
  }
  @Get("api/v1/expenses/mine") mine(@Req() req: AppRequest) {
    return this.expenses.mine(req.actor);
  }
  @Post("api/v1/expenses/mine") submit(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.expenses.submit(
      req.actor,
      parse(expenseSubmitSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/expenses/mine/:id/cancel") cancelMine(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.expenses.cancelMine(
      req.actor,
      parse(z.uuid(), id),
      parse(expenseCancelSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/expenses/categories") categories(@Req() req: AppRequest) {
    return this.expenses.categories(req.actor);
  }
  @Post("api/v1/expenses/categories") createCategory(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.expenses.createCategory(
      req.actor,
      parse(expenseCategoryCreateSchema, body),
      req.requestId,
    );
  }
  @Put("api/v1/expenses/categories/:id") updateCategory(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.expenses.updateCategory(
      req.actor,
      parse(z.uuid(), id),
      parse(expenseCategoryUpdateSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/expenses") list(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.expenses.list(req.actor, parse(expenseQuerySchema, query));
  }
  @Get("api/v1/expenses/:id") detail(
    @Req() req: AppRequest,
    @Param("id") id: string,
  ) {
    return this.expenses.detail(req.actor, parse(z.uuid(), id));
  }
  @Post("api/v1/expenses/:id/approve") approve(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.expenses.approve(
      req.actor,
      parse(z.uuid(), id),
      parse(expenseApproveSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/expenses/:id/reject") reject(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.expenses.reject(
      req.actor,
      parse(z.uuid(), id),
      parse(expenseRejectSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/expenses/:id/pay") pay(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.expenses.pay(
      req.actor,
      parse(z.uuid(), id),
      parse(expensePaySchema, body),
      req.requestId,
    );
  }
}
