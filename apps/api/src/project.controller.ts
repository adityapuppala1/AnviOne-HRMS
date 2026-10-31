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
  myTimeQuerySchema,
  projectCreateSchema,
  projectMemberAddSchema,
  projectMemberRemoveSchema,
  projectQuerySchema,
  projectStatusChangeSchema,
  projectTaskCreateSchema,
  projectTaskStatusChangeSchema,
  projectTaskUpdateSchema,
  projectUpdateSchema,
  timeEntryApproveSchema,
  timeEntryCreateSchema,
  timeEntryRejectSchema,
  timeEntryWithdrawSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { ProjectStore } from "./project.store";
import { parse } from "./http";
import { type AppRequest } from "./auth";

const id = (value: string) => parse(z.uuid(), value);

// Projects, tasks and time: owners and HR manage projects; members log time, owners or HR approve.
@Controller()
export class ProjectController {
  private readonly projects;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.projects = new ProjectStore(store);
  }
  @Get("api/v1/projects") list(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.projects.list(req.actor, parse(projectQuerySchema, query));
  }
  @Post("api/v1/projects") create(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.projects.create(
      req.actor,
      parse(projectCreateSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/projects/:id") detail(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
  ) {
    return this.projects.detail(req.actor, id(projectId));
  }
  @Put("api/v1/projects/:id") update(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.update(
      req.actor,
      id(projectId),
      parse(projectUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/projects/:id/status") status(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.changeStatus(
      req.actor,
      id(projectId),
      parse(projectStatusChangeSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/projects/:id/members") members(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
  ) {
    return this.projects.members(req.actor, id(projectId));
  }
  @Post("api/v1/projects/:id/members") addMember(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.addMember(
      req.actor,
      id(projectId),
      parse(projectMemberAddSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/projects/:id/members/:employeeId/remove") removeMember(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
    @Param("employeeId") employeeId: string,
    @Body() body: unknown,
  ) {
    return this.projects.removeMember(
      req.actor,
      id(projectId),
      id(employeeId),
      parse(projectMemberRemoveSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/projects/:id/tasks") tasks(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
  ) {
    return this.projects.tasks(req.actor, id(projectId));
  }
  @Post("api/v1/projects/:id/tasks") createTask(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.createTask(
      req.actor,
      id(projectId),
      parse(projectTaskCreateSchema, body),
      req.requestId,
    );
  }
  @Put("api/v1/projects/:id/tasks/:taskId") updateTask(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.projects.updateTask(
      req.actor,
      id(projectId),
      id(taskId),
      parse(projectTaskUpdateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/projects/:id/tasks/:taskId/status") taskStatus(
    @Req() req: AppRequest,
    @Param("id") projectId: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.projects.changeTaskStatus(
      req.actor,
      id(projectId),
      id(taskId),
      parse(projectTaskStatusChangeSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/time/mine") myTime(
    @Req() req: AppRequest,
    @Query() query: unknown,
  ) {
    return this.projects.myTime(req.actor, parse(myTimeQuerySchema, query));
  }
  @Post("api/v1/time/mine") logTime(
    @Req() req: AppRequest,
    @Body() body: unknown,
  ) {
    return this.projects.logTime(
      req.actor,
      parse(timeEntryCreateSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/time/mine/:id/withdraw") withdraw(
    @Req() req: AppRequest,
    @Param("id") entryId: string,
    @Body() body: unknown,
  ) {
    return this.projects.withdraw(
      req.actor,
      id(entryId),
      parse(timeEntryWithdrawSchema, body),
      req.requestId,
    );
  }
  @Get("api/v1/time/review") review(@Req() req: AppRequest) {
    return this.projects.review(req.actor);
  }
  @Post("api/v1/time/:id/approve") approve(
    @Req() req: AppRequest,
    @Param("id") entryId: string,
    @Body() body: unknown,
  ) {
    return this.projects.approve(
      req.actor,
      id(entryId),
      parse(timeEntryApproveSchema, body),
      req.requestId,
    );
  }
  @Post("api/v1/time/:id/reject") reject(
    @Req() req: AppRequest,
    @Param("id") entryId: string,
    @Body() body: unknown,
  ) {
    return this.projects.reject(
      req.actor,
      id(entryId),
      parse(timeEntryRejectSchema, body),
      req.requestId,
    );
  }
}
