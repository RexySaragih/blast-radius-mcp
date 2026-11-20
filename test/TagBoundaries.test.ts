import { describe, expect, it } from 'vitest';
import { TagBoundaries } from '../src/application/use-cases/TagBoundaries.js';
import { createSymbol } from '../src/domain/Symbol.js';

function functionSymbol(name: string, filePath = 'src/app.ts') {
  return createSymbol({
    name,
    kind: 'function',
    filePath,
    startLine: 1,
    startColumn: 0,
    endLine: 20,
    endColumn: 1,
    hash: name,
    signatureHash: name,
    bodyHash: name,
    isBoundary: false,
    language: 'typescript',
  });
}

describe('Tag Boundaries', () => {
  const tagger = new TagBoundaries();

  describe('when Express registers a put route with a handler', () => {
    it('should mark the handler as a boundary route', () => {
      const handler = functionSymbol('handler');
      const result = tagger.execute({
        filePath: 'src/app.ts',
        source: `app.put('/api/v1/users/profile', handler);\n`,
        symbols: [handler],
        edges: [],
      });
      const tagged = result.symbols.find((symbol) => symbol.name === 'handler');

      expect(tagged?.kind).toBe('route');
      expect(tagged?.isBoundary).toBe(true);
      expect(tagged?.name).toBe('handler');
      expect(tagged?.routeLabel).toBe('PUT /api/v1/users/profile');
    });
  });

  describe('when Express registers a route behind middleware', () => {
    it('should bind the last handler and keep its name', () => {
      const auth = functionSymbol('auth');
      const handler = functionSymbol('handler');
      const result = tagger.execute({
        filePath: 'src/app.ts',
        source: `app.get('/x', auth, handler);\n`,
        symbols: [auth, handler],
        edges: [],
      });

      expect(result.symbols.find((symbol) => symbol.name === 'auth')?.kind).toBe('function');
      expect(result.symbols.find((symbol) => symbol.name === 'handler')?.routeLabel).toBe('GET /x');
    });
  });

  describe('when Express registers an inline handler', () => {
    it('should create a boundary whose name is the route label', () => {
      const result = tagger.execute({
        filePath: 'src/app.ts',
        source: `app.get('/x', (req, res) => res.send('ok'));\n`,
        symbols: [],
        edges: [],
      });
      const tagged = result.symbols.find((symbol) => symbol.kind === 'route');

      expect(tagged?.name).toBe('GET /x');
      expect(tagged?.routeLabel).toBe('GET /x');
      expect(tagged?.isBoundary).toBe(true);
    });
  });

  describe('when Fastify registers a route object', () => {
    it('should label the named handler with method and url', () => {
      const save = functionSymbol('save');
      const result = tagger.execute({
        filePath: 'src/app.ts',
        source: `app.route({ method: 'PUT', url: '/x', handler: save });\n`,
        symbols: [save],
        edges: [],
      });

      expect(result.symbols.find((symbol) => symbol.name === 'save')?.routeLabel).toBe('PUT /x');
    });
  });

  describe('when a Prisma model defines an email field', () => {
    it('should store a db_column symbol named email', () => {
      const result = tagger.execute({
        filePath: 'prisma/schema.prisma',
        source: `
model User {
  id    Int    @id
  email String
}
`,
        symbols: [],
        edges: [],
      });

      expect(result.symbols.some((symbol) => symbol.kind === 'db_column' && symbol.name === 'email')).toBe(
        true,
      );
    });
  });

  describe('when producer.send is called', () => {
    it('should store a publishes edge or event_handler symbol', () => {
      const worker = functionSymbol('SessionWorker');
      const result = tagger.execute({
        filePath: 'src/worker.ts',
        source: `
function SessionWorker() {
  producer.send(payload);
}
`,
        symbols: [worker],
        edges: [],
      });

      const hasPublishEdge = result.edges.some((edge) => edge.type === 'publishes');
      const hasEventHandler = result.symbols.some((symbol) => symbol.kind === 'event_handler');
      expect(hasPublishEdge || hasEventHandler).toBe(true);
    });
  });
});
