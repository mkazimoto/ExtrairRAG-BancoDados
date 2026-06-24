import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * NOTA: O módulo src/index.ts executa main() no top-level, o que dificulta
 * testes unitários tradicionais com mocks. Testamos aqui componentes
 * internos exportáveis e comportamento via integração reduzida.
 *
 * Para mockar McpServer usamos uma classe real (não factory arrow) porque
 * new McpServer() requer um constructor válido.
 */

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  function MockMcpServer(this: Record<string, ReturnType<typeof vi.fn>>) {
    this.registerResource = vi.fn();
    this.connect = vi.fn().mockResolvedValue(undefined);
  }
  return { McpServer: MockMcpServer };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  function MockTransport() {}
  return { StdioServerTransport: MockTransport };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn((opts) => {
    const sessionId = opts?.sessionIdGenerator?.() ?? 'mock-session';
    opts?.onsessioninitialized?.(sessionId);
    return {
      sessionId,
      handleRequest: vi.fn().mockResolvedValue(undefined),
      onclose: null,
    };
  }),
}));

vi.mock('../src/services/docs-reader.js', () => ({
  getDbIndexMarkdown: vi.fn(() => '# Índice'),
}));

vi.mock('../src/tools/doc-tools.js', () => ({
  registerDocTools: vi.fn(),
}));

vi.mock('../src/tools/sql-validator.js', () => ({
  registerSqlValidator: vi.fn(),
}));

vi.mock('express', async () => {
  const mockApp = {
    use: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    all: vi.fn().mockReturnThis(),
    listen: vi.fn((_port, cb) => {
      cb?.();
      return { close: vi.fn() };
    }),
  };
  const expressFn = vi.fn(() => mockApp) as ReturnType<typeof vi.fn> & { json: ReturnType<typeof vi.fn>; static: ReturnType<typeof vi.fn> };
  expressFn.json = vi.fn(() => vi.fn());
  expressFn.static = vi.fn(() => vi.fn());
  const actual = await vi.importActual('express');
  return { ...(actual as object), default: expressFn };
});

describe('index', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MCP_TRANSPORT;
    delete process.env.MCP_API_KEY;
    delete process.env.PORT;
  });

  describe('createMcpServer (via stdio)', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.MCP_TRANSPORT = 'stdio';
      delete process.env.MCP_API_KEY;
      delete process.env.PORT;
    });

    it('deve registrar registerDocTools e registerSqlValidator', async () => {
      process.env.MCP_TRANSPORT = 'stdio';
      await import('../src/index.js');

      const { registerDocTools } = await import('../src/tools/doc-tools.js');
      const { registerSqlValidator } = await import('../src/tools/sql-validator.js');

      expect(registerDocTools).toHaveBeenCalled();
      expect(registerSqlValidator).toHaveBeenCalled();
    });
  });

  describe('modo HTTP', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.MCP_TRANSPORT = 'http';
      process.env.PORT = '0';
      delete process.env.MCP_API_KEY;
    });

    it('deve iniciar servidor HTTP sem erros', async () => {
      await expect(import('../src/index.js')).resolves.toBeDefined();
    });
  });

  describe('carregamento sem MCP_API_KEY', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.MCP_TRANSPORT = 'stdio';
      delete process.env.MCP_API_KEY;
    });

    it('deve carregar sem erros', async () => {
      await expect(import('../src/index.js')).resolves.toBeDefined();
    });
  });
});
