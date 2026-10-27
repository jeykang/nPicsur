import * as z from 'zod';
/**
 * This file was originally taken from:
 *   https://github.com/anatine/zod-plugins/blob/main/libs/zod-nestjs/src/lib/create-zod-dto.ts
 *
 */

export type CompatibleZodType = z.ZodType<unknown>;
export type CompatibleZodInfer<T extends CompatibleZodType> = z.output<T>;

export type ZodDtoStatic<T extends CompatibleZodType = CompatibleZodType> = {
  new (): CompatibleZodInfer<T>;
  zodSchema: T;
  create(input: unknown): CompatibleZodInfer<T>;
};

export const createZodDto = <T extends CompatibleZodType>(
  zodSchema: T,
): ZodDtoStatic<T> => {
  class SchemaHolderClass {
    public static zodSchema = zodSchema;

    public static create(input: unknown): CompatibleZodInfer<T> {
      return this.zodSchema.parse(input);
    }
  }

  // The class only carries the schema, and stands for what it parses to as a
  // type. Zod's output type is conditional, which TypeScript can not match
  // the class against while the schema is generic.
  return SchemaHolderClass as unknown as ZodDtoStatic<T>;
};
