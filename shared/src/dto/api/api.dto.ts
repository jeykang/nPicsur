import * as z from 'zod';

const ApiResponseBase = z.object({
  statusCode: z.number().min(0).max(600).int(),
  timestamp: z.string(),
  timeMs: z.number().min(0).int(),
});

const ApiSuccessResponse = <T extends z.ZodObject>(data: T) =>
  ApiResponseBase.extend({
    success: z.literal(true),
    data,
  });

export const ApiErrorResponseSchema = ApiResponseBase.extend({
  success: z.literal(false),
  data: z.object({
    type: z.string(),
    message: z.string(),
  }),
});

export const ApiResponseSchema = <T extends z.ZodObject>(data: T) =>
  ApiErrorResponseSchema.or(ApiSuccessResponse(data));

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export type ApiAnySuccessResponse = z.infer<typeof ApiResponseBase> & {
  success: true;
  data?: any;
};
