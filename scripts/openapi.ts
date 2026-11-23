import { writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { z } from 'zod';
import { compositionSchema } from '../src/geometry/schema.ts';
import { resolvedCompositionSchema } from '../src/geometry/result.ts';
import { quickRfqRequestSchema, quickRfqTextSchema } from '../src/rfq/quick.ts';

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
    '/api/rfq/quick': {
      post: {
        operationId: 'quickRfq',
        description: 'Render one Quick RFQ snapshot as text or a printable PDF. Send all photo originals for a photo-bearing PDF.',
        parameters: [
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['text', 'pdf'], default: 'text' } },
          { name: 'lang', in: 'query', schema: { type: 'string', enum: ['en', 'zh', 'en-zh'], default: 'en' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/QuickRfqRequest' } },
            'multipart/form-data': {
              schema: {
                type: 'object', required: ['input'], additionalProperties: false,
                properties: { input: { type: 'string', description: 'JSON-encoded QuickRfqRequest' } },
                patternProperties: { '^photo:[A-Za-z0-9_-]{1,64}$': { type: 'string', format: 'binary' } },
              },
              encoding: { input: { contentType: 'text/plain' } },
            },
          },
        },
        responses: {
          200: {
            description: 'Text response or PDF bytes available for inline display and download',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/QuickRfqText' } },
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
            },
          },
          400: response('Invalid options, UTF-8, JSON or multipart body', { $ref: '#/components/schemas/RfqError' }),
          403: response('Cross-site request rejected', { $ref: '#/components/schemas/RfqError' }),
          413: response('Request exceeds size limit', { $ref: '#/components/schemas/RfqError' }),
          415: response('Unsupported media type', { $ref: '#/components/schemas/RfqError' }),
          422: response('Invalid snapshot, photo or project/geometry conflict', { $ref: '#/components/schemas/RfqError' }),
          503: response('PDF renderer is busy, unavailable or timed out', { $ref: '#/components/schemas/RfqError' }),
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
    schemas: {
      Composition: jsonSchema(compositionSchema),
      ResolvedComposition: jsonSchema(resolvedCompositionSchema),
      QuickRfqRequest: jsonSchema(quickRfqRequestSchema),
      QuickRfqText: jsonSchema(quickRfqTextSchema),
      RfqError: {
        ...error,
        properties: { ...error.properties, error: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
};
writeFileSync(new URL('../openapi.yaml', import.meta.url), stringify(specification));
