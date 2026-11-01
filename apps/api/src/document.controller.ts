import {
  Controller,
  Inject,
  Get,
  Post,
  Body,
  Param,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import {
  documentUploadFieldsSchema,
  documentWithdrawSchema,
  documentDecisionSchema,
} from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { DocumentStore, type UploadedFile as Upload } from "./document.store";
import { MAX_DOCUMENT_BYTES } from "./document.validation";
import { parse } from "./http";
import { type AppRequest } from "./auth";

// RFC 5987 forbids ' ( ) * ! unescaped in extended parameter values.
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// Employee documents: uploads, HR verification and audited downloads.
@Controller()
export class DocumentController {
  private readonly documents;
  constructor(@Inject(PlatformStore) store: PlatformStore) {
    this.documents = new DocumentStore(store);
  }
  @Get("api/v1/documents") mine(@Req() req: AppRequest) {
    return this.documents.mine(req.actor);
  }
  @Get("api/v1/documents/review") review(@Req() req: AppRequest) {
    return this.documents.review(req.actor);
  }
  @Post("api/v1/documents")
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
  upload(
    @Req() req: AppRequest,
    @Body() body: unknown,
    @UploadedFile() file: Upload | undefined,
  ) {
    return this.documents.upload(
      req.actor,
      parse(documentUploadFieldsSchema, body),
      file,
      req.requestId,
    );
  }
  @Post("api/v1/documents/:id/withdraw") withdraw(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.documents.withdraw(
      req.actor,
      parse(z.uuid(), id),
      parse(documentWithdrawSchema, body).version,
      req.requestId,
    );
  }
  @Post("api/v1/documents/:id/decision") decide(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.documents.decide(
      req.actor,
      parse(z.uuid(), id),
      parse(documentDecisionSchema, body),
      req.requestId,
    );
  }
  // Always an attachment: browsers never render stored bytes inline in the app origin.
  @Get("api/v1/documents/:id/content") async content(
    @Req() req: AppRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const file = await this.documents.content(
      req.actor,
      parse(z.uuid(), id),
      req.requestId,
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
