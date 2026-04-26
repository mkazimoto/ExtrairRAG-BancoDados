import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { registerDocTools } from './tools/doc-tools.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const API_KEY = process.env.MCP_API_KEY ?? '';

/** Middleware de autenticação via Bearer token */
function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!API_KEY) {
    // Sem chave configurada: acesso livre (apenas aviso em stderr)
    process.stderr.write('[AVISO] MCP_API_KEY não definida — servidor sem autenticação.\n');
    next();
    return;
  }

  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token || token !== API_KEY) {
    res.status(401).json({ error: 'Não autorizado. Forneça um Bearer token válido.' });
    return;
  }

  next();
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Mapa de transports ativos por sessionId
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Endpoint único MCP — suporta GET (SSE), POST (mensagens) e DELETE (encerrar sessão)
  app.all('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // ── Sessão existente: roteia ao transport correto ──────────────────────
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: 'Sessão não encontrada' });
        return;
      }
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // ── Nova sessão: apenas POST de inicialização é permitido ──────────────
    if (req.method !== 'POST') {
      res.status(400).json({ error: 'Sessão não iniciada' });
      return;
    }

    // O sessionId só fica disponível dentro do callback onsessioninitialized,
    // que é chamado durante o handleRequest ao processar a mensagem initialize.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        transports.set(newSessionId, transport);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    // Cria uma nova instância de servidor MCP por sessão
    const sessionServer = new McpServer({
      name: 'totvs-rm-mcp-server',
      version: '1.0.0',
    });
    registerDocTools(sessionServer);

    sessionServer.registerResource(
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

    await sessionServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const httpServer = app.listen(PORT, () => {
    process.stderr.write(`TOTVS RM MCP Server iniciado (StreamableHTTP) em http://localhost:${PORT}/mcp\n`);
  });

  // Encerramento limpo
  const shutdown = async () => {
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  process.stderr.write(`Erro fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
