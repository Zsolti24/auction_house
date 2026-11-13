import { toFieldErrors, type ApiError } from "@auction/shared";
import type { ZodError } from "zod";

/** Thrown by services; the HTTP layer turns it into `statusCode` + `body`. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

export const notFound = (what = "Auction") =>
  new HttpError(404, { error: "NOT_FOUND", message: `${what} not found` });

export const forbidden = () =>
  new HttpError(403, { error: "FORBIDDEN", message: "Invalid seller key" });

export const validationError = (error: ZodError) =>
  new HttpError(400, {
    error: "VALIDATION_ERROR",
    message: "Some fields are invalid",
    fieldErrors: toFieldErrors(error),
  });
