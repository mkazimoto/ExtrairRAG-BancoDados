import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock do docs-reader
vi.mock('../src/services/docs-reader.js', () => ({
  getDbIndexMarkdown: vi.fn(() => '# Índice do Banco'),
  getTableRawMarkdown: vi.fn((name: string) => `# ${name}\n\n## Descrição\nMock`),
  getTableRules: vi.fn((name: string) => {
    if (name === 'PFUNC') return '# Regras PFUNC\n## SEXO\nM/F';
    return null;
  }),
  hasTableRules: vi.fn((name: string) => name === 'PFUNC'),
  listTablesByModule: vi.fn((_module: string, limit = 50, offset = 0) => ({
    total: 2,
    items: [
      { name: 'PFUNC', description: 'Funcionários', module: 'TOTVS Folha de Pagamento' },
      { name: 'PCPAL', description: 'Cargos', module: 'TOTVS Folha de Pagamento' },
    ].slice(offset, offset + limit),
  })),
  searchTables: vi.fn((query: string, limit = 20, offset = 0) => ({
    total: 1,
    items: [
      { name: 'PFUNC', description: 'Funcionários', module: 'TOTVS Folha de Pagamento', score: 15 },
    ].slice(offset, offset + limit),
  })),
}));

// Mock do McpServer
class MockMcpServer {
  tools = new Map<string, { handler: Function }>();

  registerTool(name: string, _schema: unknown, handler: Function) {
    this.tools.set(name, { handler });
  }
}

describe('registerDocTools', () => {
  let registerDocTools: typeof import('../src/tools/doc-tools.js').registerDocTools;
  let server: MockMcpServer;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/tools/doc-tools.js');
    registerDocTools = mod.registerDocTools;
    server = new MockMcpServer();
    registerDocTools(server as any);
  });

  it('deve registrar totvs_search_tables', () => {
    expect(server.tools.has('totvs_search_tables')).toBe(true);
  });

  it('deve registrar totvs_get_table_schema', () => {
    expect(server.tools.has('totvs_get_table_schema')).toBe(true);
  });

  it('deve registrar totvs_list_modules', () => {
    expect(server.tools.has('totvs_list_modules')).toBe(true);
  });

  it('deve registrar totvs_get_table_rules', () => {
    expect(server.tools.has('totvs_get_table_rules')).toBe(true);
  });
});

describe('totvs_search_tables', () => {
  let registerDocTools: typeof import('../src/tools/doc-tools.js').registerDocTools;
  let server: MockMcpServer;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/tools/doc-tools.js');
    registerDocTools = mod.registerDocTools;
    server = new MockMcpServer();
    registerDocTools(server as any);
  });

  it('deve retornar resultados formatados em markdown', async () => {
    const handler = server.tools.get('totvs_search_tables')!.handler;
    const result = await handler({ query: 'funcionario', limit: 20, offset: 0 });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('PFUNC');
    expect(result.content[0].text).toContain('15'); // score
    expect(result.content[0].text).toContain('Tabelas TOTVS RM');
  });

  it('deve retornar mensagem quando nenhuma tabela encontrada', async () => {
    const { searchTables } = await import('../src/services/docs-reader.js');
    (searchTables as ReturnType<typeof vi.fn>).mockReturnValueOnce({ total: 0, items: [] });

    const handler = server.tools.get('totvs_search_tables')!.handler;
    const result = await handler({ query: 'xyzzy', limit: 20, offset: 0 });

    expect(result.content[0].text).toContain('Nenhuma tabela encontrada');
  });

  it('deve incluir hint de paginação quando há mais resultados', async () => {
    const { searchTables } = await import('../src/services/docs-reader.js');
    (searchTables as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      total: 50,
      items: Array.from({ length: 20 }, (_, i) => ({
        name: `T${i}`,
        description: `Tabela ${i}`,
        module: 'Módulo',
        score: 1,
      })),
    });

    const handler = server.tools.get('totvs_search_tables')!.handler;
    const result = await handler({ query: 'teste', limit: 20, offset: 0 });

    expect(result.content[0].text).toContain('offset=20');
  });

  it('deve marcar coluna com rules', async () => {
    const { searchTables } = await import('../src/services/docs-reader.js');
    (searchTables as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      total: 1,
      items: [{ name: 'PFUNC', description: 'Funcionários', module: 'TOTVS Folha de Pagamento', score: 15 }],
    });

    const handler = server.tools.get('totvs_search_tables')!.handler;
    const result = await handler({ query: 'PFUNC', limit: 20, offset: 0 });

    expect(result.content[0].text).toContain('✓'); // hasTableRules = true
  });
});

describe('totvs_get_table_schema', () => {
  let server: MockMcpServer;
  let handler: Function;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/tools/doc-tools.js');
    const registerDocTools = mod.registerDocTools;
    server = new MockMcpServer();
    registerDocTools(server as any);
    handler = server.tools.get('totvs_get_table_schema')!.handler;
  });

  it('deve retornar markdown da tabela', async () => {
    const result = await handler({ table_name: 'PFUNC' });
    expect(result.content[0].text).toContain('# PFUNC');
    expect(result.content[0].text).toContain('Mock');
  });

  it('deve capturar erro quando tabela não existe', async () => {
    const { getTableRawMarkdown } = await import('../src/services/docs-reader.js');
    (getTableRawMarkdown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Documentação não encontrada para a tabela: INEXISTENTE');
    });

    const result = await handler({ table_name: 'INEXISTENTE' });
    expect(result.content[0].text).toContain('Documentação não encontrada');
  });
});

describe('totvs_get_table_rules', () => {
  let server: MockMcpServer;
  let handler: Function;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/tools/doc-tools.js');
    const registerDocTools = mod.registerDocTools;
    server = new MockMcpServer();
    registerDocTools(server as any);
    handler = server.tools.get('totvs_get_table_rules')!.handler;
  });

  it('deve retornar regras quando existem', async () => {
    const result = await handler({ table_name: 'PFUNC' });
    expect(result.content[0].text).toContain('Regras PFUNC');
  });

  it('deve retornar mensagem quando não há regras', async () => {
    const result = await handler({ table_name: 'FCFO' });
    expect(result.content[0].text).toContain('Nenhum arquivo de regras');
  });
});

describe('totvs_list_modules', () => {
  let server: MockMcpServer;
  let handler: Function;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/tools/doc-tools.js');
    const registerDocTools = mod.registerDocTools;
    server = new MockMcpServer();
    registerDocTools(server as any);
    handler = server.tools.get('totvs_list_modules')!.handler;
  });

  it('deve listar todos os módulos', async () => {
    const result = await handler({});
    expect(result.content[0].text).toContain('Módulos ERP TOTVS RM');
    expect(result.content[0].text).toContain('TOTVS Folha de Pagamento');
    expect(result.content[0].text).toContain('TOTVS Gestão Financeira');
    expect(result.content[0].text).toContain('TOTVS Automação de Ponto');
  });
});
