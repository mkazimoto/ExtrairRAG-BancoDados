import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closePool } from './services/db-client.js';
import { registerDocTools } from './tools/doc-tools.js';
import { registerQueryTools } from './tools/query-tools.js';

const server = new McpServer({
  name: 'totvs-rm-mcp-server',
  version: '1.0.0',
});

// Registra todas as ferramentas
registerDocTools(server);
registerQueryTools(server);

// ── Recursos (Resources) ──────────────────────────────────────────────────────

server.registerResource(
  'totvs-db-index',
  'totvs://db-index',
  {
    title: 'Índice do Banco de Dados TOTVS RM',
    description: 'Índice completo de todas as tabelas do ERP TOTVS RM com descrição e módulo.',
    mimeType: 'text/markdown',
  },
  async () => {
    const { getDbIndexMarkdown } = await import('./services/docs-reader.js');
    try {
      return { contents: [{ uri: 'totvs://db-index', mimeType: 'text/markdown', text: getDbIndexMarkdown() }] };
    } catch (err) {
      return { contents: [{ uri: 'totvs://db-index', mimeType: 'text/plain', text: (err as Error).message }] };
    }
  },
);

// ── Inicialização ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write('TOTVS RM MCP Server iniciado (stdio)\n');

  // Encerramento limpo
  const shutdown = async () => {
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  process.stderr.write(`Erro fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
