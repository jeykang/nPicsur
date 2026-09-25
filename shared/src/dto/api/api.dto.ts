import * as z from 'zod';

const ApiResponseBase = z.object({
  statusCode: z.number().min(0).max(600).int(),
  timestamp: z.string(),
  timeMs: z.number().min(0).int(),
});

const ApiSuccessResponse = <T extends z.AnyZodObject>(data: T) =>
  ApiResponseBase.merge(
    z.object({
      success: z.literal(true),
      data,
    }),
  );

export const ApiErrorResponseSchema = ApiResponseBase.merge(
  z.object({
    success: z.literal(false),
    data: z.object({
      type: z.string(),
      message: z.string(),
    }),
  }),
);

export const ApiResponseSchema = <T extends z.AnyZodObject>(data: T) =>
  ApiErrorResponseSchema.or(ApiSuccessResponse(data));

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

const ApiAnySuccessResponseSchema = ApiSuccessResponse(z.object({}))
  .omit({ data: true })
  .merge(
    z.object({
      data: z.any(),
    }),
  );
export type ApiAnySuccessResponse = z.infer<typeof ApiAnySuccessResponseSchema>;
