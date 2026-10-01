type FCDecorator = MethodDecorator & ClassDecorator;

// FC = Function, Class
export function CombineFCDecorators(...decorators: FCDecorator[]) {
  return (target: any, key: string, descriptor: PropertyDescriptor) => {
    decorators.forEach((decorator) => {
      decorator(target, key, descriptor as any);
    });
  };
}
