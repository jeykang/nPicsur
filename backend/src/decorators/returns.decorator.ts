import { SetMetadata } from '@nestjs/common';
import { Newable } from 'picsur-shared/dist/types/newable';

// Not yet used, but can be used for outgoing data validation

type ReturnsMethodDecorator<ReturnType> = <
  T extends (...args: any) => ReturnType | Promise<ReturnType>,
>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<T>,
) => TypedPropertyDescriptor<T> | void;

export function Returns<N extends object>(
  newable: Newable<N>,
): ReturnsMethodDecorator<N> {
  return SetMetadata('returns', newable);
}

export function ReturnsAnything(): ReturnsMethodDecorator<any> {
  return SetMetadata('noreturns', true);
}

// Sends an image instead of JSON, for the api documentation
export function ReturnsImage(): ReturnsMethodDecorator<any> {
  return SetMetadata('returns-image', true);
}
