import { Injectable, RequestMethod } from '@nestjs/common';
import {
  CUSTOM_ROUTE_ARGS_METADATA,
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ApiErrorResponseSchema } from 'picsur-shared/dist/dto/api/api.dto';
import { UserLoginRequestSchema } from 'picsur-shared/dist/dto/api/user.dto';
import type { ZodDtoStatic } from 'picsur-shared/dist/util/create-zod-dto';
import { z, ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { HostConfigService } from '../../../config/early/host.config.service.js';
import { ImageFullIdPipe } from '../../../decorators/image-id/image-full-id.pipe.js';
import { ImageIdPipe } from '../../../decorators/image-id/image-id.pipe.js';
import { MultiPartPipe } from '../../../decorators/multipart/multipart.pipe.js';
import { LocalAuthGuard } from '../../../managers/auth/guards/local-auth.guard.js';
import type { Permissions } from '../../../models/constants/permissions.const.js';

type Schema = Record<string, any>;
// What is used of a schema of an object
interface ObjectSchema {
  properties?: Record<string, Schema>;
  required?: string[];
}

// Every answer in JSON looks like this, see the SuccessInterceptor
const Success = (data: ZodTypeAny) =>
  z.object({
    success: z.literal(true),
    statusCode: z.number().int(),
    timestamp: z.string(),
    timeMs: z.number().int(),
    data,
  });

// Path parameters that are read with these pipes
const ParamDescriptions = new Map<unknown, string>([
  [
    ImageFullIdPipe,
    'The id of the image, with an extension like .png to get it in that format, or without one for the original upload',
  ],
  [ImageIdPipe, 'The id of the image'],
]);

const Methods: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.HEAD]: 'head',
  [RequestMethod.OPTIONS]: 'options',
};

// The OpenAPI document of every route, made from the schemas the routes
// check their requests and answers with
@Injectable()
export class OpenApiService {
  private document: Buffer | null = null;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly hostConfig: HostConfigService,
  ) {}

  // Routes do not change while Picsur runs, so it is made once
  public getDocument(): Buffer {
    this.document ??= Buffer.from(JSON.stringify(this.build()));
    return this.document;
  }

  private build(): Schema {
    const paths: Record<string, Record<string, Schema>> = {};

    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype as (new () => object) | null;
      if (!controller || !wrapper.instance) continue;
      const prototype = Object.getPrototypeOf(wrapper.instance);
      const tag = controller.name.replace(/Controller$/, '');

      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        const method =
          Methods[
            Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
          ];
        if (method === undefined) continue;

        const bases = AsList(Reflect.getMetadata(PATH_METADATA, controller));
        // Wildcards, like report/*, can not be described
        const subpaths = AsList(
          Reflect.getMetadata(PATH_METADATA, handler),
        ).filter((subpath) => !subpath.includes('*'));
        const routes = bases.flatMap((base) =>
          subpaths.map((subpath) => ToOpenApiPath(base, subpath)),
        );
        routes.forEach((route, i) => {
          paths[route] ??= {};
          paths[route][method] = {
            // Unique, also when a route has several paths
            operationId: `${tag}_${name}${i === 0 ? '' : `_${i + 1}`}`,
            summary: Sentence(name),
            tags: [tag],
            ...this.operation(controller, prototype, name, route, method),
          };
        });
      }
    }

    return {
      openapi: '3.0.3',
      info: {
        title: 'Picsur',
        version: this.hostConfig.getVersion(),
        description:
          'Visitors who are not logged in have the permissions of the guest role. Answers in JSON have success, statusCode, timestamp and timeMs next to their data.',
      },
      paths: Sorted(paths),
      components: {
        securitySchemes: {
          jwt: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'The token /api/user/login gives',
          },
          apikey: {
            type: 'apiKey',
            in: 'header',
            name: 'Authorization',
            description: 'Api-Key, a space, and the key',
          },
        },
      },
      // Logging in is optional, what a route needs is in its permissions
      security: [{}, { jwt: [] }, { apikey: [] }],
    };
  }

  private operation(
    controller: object,
    prototype: object,
    name: string,
    route: string,
    method: string,
  ): Schema {
    const handler = (prototype as any)[name];
    const args: Record<
      string,
      { index: number; data?: unknown; pipes?: unknown[] }
    > = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {};
    const types: unknown[] =
      Reflect.getMetadata('design:paramtypes', prototype, name) ?? [];
    const schemaOf = (index: number) =>
      (types[index] as Partial<ZodDtoStatic> | undefined)?.zodSchema;

    const parameters: Schema[] = [];
    let pathSchema: Schema = {};
    const pathDescriptions: Record<string, string> = {};
    let requestBody: Schema | undefined;

    for (const [key, arg] of Object.entries(args)) {
      if (key.includes(CUSTOM_ROUTE_ARGS_METADATA)) {
        // Files are uploaded as multipart form data
        if (arg.pipes?.includes(MultiPartPipe)) {
          requestBody = {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { image: { type: 'string', format: 'binary' } },
                  required: ['image'],
                },
              },
            },
          };
        }
        continue;
      }

      // A single path parameter, like the id of an image
      if (typeof arg.data === 'string') {
        const pipe = arg.pipes?.find((pipe) => ParamDescriptions.has(pipe));
        if (pipe !== undefined) {
          pathDescriptions[arg.data] = ParamDescriptions.get(pipe)!;
        }
        continue;
      }

      const schema = schemaOf(arg.index);
      if (schema === undefined) continue;
      const json = ToJsonSchema(schema) as ObjectSchema;
      switch (Number(key.split(':')[0]) as RouteParamtypes) {
        case RouteParamtypes.BODY:
          requestBody = {
            required: true,
            content: { 'application/json': { schema: json } },
          };
          break;
        case RouteParamtypes.QUERY:
          for (const [param, paramSchema] of Object.entries<Schema>(
            json.properties ?? {},
          )) {
            parameters.push({
              name: param,
              in: 'query',
              required: (json.required ?? []).includes(param),
              schema: paramSchema,
            });
          }
          break;
        case RouteParamtypes.PARAM:
          pathSchema = json.properties ?? {};
          break;
      }
    }

    // Every part of the path that is a parameter, in their order
    const pathParameters = [...route.matchAll(/\{([^}]+)\}/g)].map(
      ([, param]) => ({
        name: param,
        in: 'path',
        required: true,
        ...(pathDescriptions[param] !== undefined
          ? { description: pathDescriptions[param] }
          : {}),
        schema: pathSchema[param] ?? { type: 'string' },
      }),
    );
    parameters.unshift(...pathParameters);

    // Logging in with a username and password reads them from the body
    const guards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
    if (requestBody === undefined && guards.includes(LocalAuthGuard)) {
      requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: ToJsonSchema(UserLoginRequestSchema),
          },
        },
      };
    }

    const permissions: Permissions =
      Reflect.getMetadata('permissions', handler) ??
      Reflect.getMetadata('permissions', controller) ??
      [];

    const status = this.status(handler, method);
    return {
      description:
        permissions.length === 0
          ? 'Anyone can use this.'
          : `Needs the permissions ${permissions.join(', ')}.`,
      'x-permissions': permissions,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody !== undefined ? { requestBody } : {}),
      responses: {
        [String(status)]: this.answer(handler, status),
        default: {
          description: 'Failed',
          content: {
            'application/json': {
              schema: ToJsonSchema(ApiErrorResponseSchema),
            },
          },
        },
      },
    };
  }

  // Like Nest: 201 for POST, 200 for the rest, unless the route says
  private status(handler: object, method: string): number {
    return (
      Reflect.getMetadata(HTTP_CODE_METADATA, handler) ??
      (method === 'post' ? 201 : 200)
    );
  }

  private answer(handler: object, status: number): Schema {
    if (status >= 300 && status < 400) {
      return {
        description: 'Redirects',
        headers: { Location: { schema: { type: 'string' } } },
      };
    }
    const returns: Partial<ZodDtoStatic> | undefined = Reflect.getMetadata(
      'returns',
      handler,
    );
    if (returns?.zodSchema !== undefined) {
      return {
        description: 'Done',
        content: {
          'application/json': {
            schema: ToJsonSchema(Success(returns.zodSchema as ZodTypeAny)),
          },
        },
      };
    }
    if (Reflect.getMetadata('returns-image', handler) === true) {
      return {
        description: 'The image',
        content: {
          'image/*': { schema: { type: 'string', format: 'binary' } },
        },
      };
    }
    return { description: 'Done' };
  }
}

function ToJsonSchema(schema: ZodTypeAny): Schema {
  // What is sent, so the schema before preprocessing, inlined
  const json = zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
    effectStrategy: 'input',
  }) as Schema;
  delete json['$schema'];
  return json;
}

function AsList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [value === undefined ? '' : String(value)];
}

// /api/image/delete/{id}/{key} for api/image and delete/:id/:key
function ToOpenApiPath(base: string, path: string): string {
  const joined = `/${base}/${path}`
    .replace(/\/+/g, '/')
    .replace(/(.)\/$/, '$1');
  return joined.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

// uploadImage becomes Upload image
function Sentence(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}
