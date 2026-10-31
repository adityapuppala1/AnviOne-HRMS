import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

// Every request body, query and path parameter passes a strict contract schema.
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException("Check your input and try again.");
  return result.data;
}
