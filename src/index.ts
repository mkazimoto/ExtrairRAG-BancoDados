import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDocTools } from './tools/doc-tools.js';
import { registerSqlValidator } from './tools/sql-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const API_KEY = process.env.MCP_API_KEY ?? '';
const TRANSPORT = (process.env.MCP_TRANSPORT ?? 'http').toLowerCase();

/** Cria o servidor MCP com todas as ferramentas e recursos registrados */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'totvs-rm-database-mcp-server',
    version: '1.0.0',
  });
  registerDocTools(server);
  registerSqlValidator(server);

  // ── Skills (resources/) ───────────────────────────────────────────────────
  const resourcesDir = join(__dirname, 'resources');
  if (existsSync(resourcesDir)) {
    const skillDirs = readdirSync(resourcesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();

    for (const skillName of skillDirs) {
      const skillPath = join(resourcesDir, skillName, 'SKILL.md');
      if (!existsSync(skillPath)) continue;

      const raw = readFileSync(skillPath, 'utf-8');
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      let title = skillName;
      let description = '';
      if (fmMatch) {
        const fm = fmMatch[1];
        const nameMatch = fm.match(/^name:\s*(.+)$/m);
        const descMatch = fm.match(/^description:\s*['"]?([\s\S]*?)['"]?$/m);
        if (nameMatch) title = nameMatch[1].trim();
        if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
      }

      const uri = `totvs://skills/${skillName}`;
      server.registerResource(
        `totvs-skill-${skillName}`,
        uri,
        { title, description, mimeType: 'text/markdown' },
        async () => ({
          contents: [{ uri, mimeType: 'text/markdown', text: readFileSync(skillPath, 'utf-8') }],
        }),
      );
    }
  }

  return server;
}

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

/** Inicia o servidor no modo stdio (comunicação via stdin/stdout) */
async function startStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('TOTVS RM MCP Server iniciado (stdio)\n');
}

/** Inicia o servidor no modo HTTP (StreamableHTTP via Express) */
async function startHttp(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Página de teste do MCP (sem auth — apenas UI local)
  app.get('/', (_req, res) => {
    const html = readFileSync(join(__dirname, 'mcp-test.html'), 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // Mapa de transports ativos por sessionId
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Endpoint único MCP — suporta GET (SSE), POST (mensagens) e DELETE (encerrar sessão)
  app.all('/mcp', requireApiKey, async (req, res) => {
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
    const sessionServer = createMcpServer();
    await sessionServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // ── SSL / HTTPS ─────────────────────────────────────────────────────────
  const sslCertPath = process.env.SSL_CERT_PATH ?? '';
  const sslKeyPath = process.env.SSL_KEY_PATH ?? '';
  const useHttps = !!(sslCertPath && sslKeyPath);

  const protocol = useHttps ? 'https' : 'http';

  let httpServer: ReturnType<typeof app.listen>;

  if (useHttps) {
    const sslOptions = {
      cert: readFileSync(sslCertPath),
      key: readFileSync(sslKeyPath),
    };
    httpServer = createHttpsServer(sslOptions, app).listen(PORT, () => {
      process.stderr.write(`TOTVS RM MCP Server iniciado (StreamableHTTP) em https://localhost:${PORT}/mcp\n`);
    });
  } else {
    httpServer = app.listen(PORT, () => {
      process.stderr.write(`TOTVS RM MCP Server iniciado (StreamableHTTP) em http://localhost:${PORT}/mcp\n`);
    });
  }

  // Encerramento limpo
  const shutdown = async () => {
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  if (TRANSPORT === 'stdio') {
    await startStdio();
  } else {
    await startHttp();
  }
}

main().catch(err => {
  process.stderr.write(`Erro fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
