import { writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { z } from 'zod';
import { compositionSchema } from '../src/geometry/schema.ts';
import { resolvedCompositionSchema } from '../src/geometry/result.ts';

function jsonSchema(schema: z.ZodType) {
  const { $schema: _dialect, ...value } = z.toJSONSchema(schema, { target: 'draft-2020-12', reused: 'inline' });
  if ('$defs' in value) throw new Error('OpenAPI component contains an unresolved local reference');
  return value;
}

const error = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string', enum: ['invalid_json', 'request_too_large', 'expected_json', 'invalid_composition'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'message'],
        properties: {
          path: { type: 'array', items: { type: ['string', 'integer'] } },
          message: { type: 'string' },
        },
      },
    },
  },
};

function response(description: string, schema: object) {
  return { description, content: { 'application/json': { schema } } };
}

const specification = {
  openapi: '3.1.0',
  info: { title: 'LIGHT FORGE Geometry API', version: '1.0.0' },
  paths: {
    '/api/geometry/resolve': {
      post: {
        operationId: 'resolveComposition',
        description: 'Resolve a composition in millimetres. See API_CONTRACTS.md for cross-field validation and datum rules.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Composition' } } },
        },
        responses: {
          200: response('Calculated geometry and outstanding inputs', { $ref: '#/components/schemas/ResolvedComposition' }),
          400: response('Malformed JSON', error),
          413: response('Request exceeds 1 MiB', error),
          415: response('Content-Type must be application/json', error),
          422: response('Composition failed validation', error),
        },
      },
    },
    '/api/health': {
      get: {
        operationId: 'health',
        responses: {
          200: response('Service is ready', {
            type: 'object', required: ['status', 'geometryVersion'],
            properties: { status: { const: 'ok' }, geometryVersion: { const: 1 } },
          }),
        },
      },
    },
  },
  components: {
    schemas: { Composition: jsonSchema(compositionSchema), ResolvedComposition: jsonSchema(resolvedCompositionSchema) },
  },
};
writeFileSync(new URL('../openapi.yaml', import.meta.url), stringify(specification));
