import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ConnectionPool as MssqlPool } from 'mssql';

/** Configuração da conexão SQL Server — lida de variáveis de ambiente */
function getDbConfig() {
  return {
    server: process.env.DB_SERVER ?? 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
    database: process.env.DB_DATABASE ?? 'EXEMPLO1212606',
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
    requestTimeout: process.env.DB_REQUEST_TIMEOUT ? parseInt(process.env.DB_REQUEST_TIMEOUT, 10) : 30000,
  };
}

/**
 * Valida a sintaxe de uma consulta T-SQL usando SET PARSEONLY ON.
 *
 * O SQL Server apenas analisa sintaticamente o comando sem compilá-lo ou executá-lo.
 * Se houver erro de sintaxe, o SQL Server lança uma exceção detalhada.
 */
async function validateSqlSyntax(sqlQuery: string): Promise<{
  isValid: boolean;
  message: string;
  errorDetails?: string;
  errorLine?: number;
  errorColumn?: number;
}> {
  const cfg = getDbConfig();

  if (!sqlQuery || sqlQuery.trim().length === 0) {
    return { isValid: false, message: 'A consulta SQL está vazia.' };
  }

  // Import dinâmico para não travar o startup caso mssql não esteja disponível
  const { default: sql } = await import('mssql');

  let pool: MssqlPool | null = null;

  try {
    pool = await sql.connect({
      server: cfg.server,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user || undefined,
      password: cfg.password || undefined,
      options: {
        trustServerCertificate: cfg.trustServerCertificate,
      },
      requestTimeout: cfg.requestTimeout,
    });

    // SET PARSEONLY ON: apenas analisa sintaxe, não executa
    await pool.request().query(`SET PARSEONLY ON; ${sqlQuery}; SET PARSEONLY OFF;`);

    return { isValid: true, message: 'Sintaxe SQL válida.' };
  } catch (err: any) {
    // Extrai detalhes do erro do SQL Server
    const originalError = err?.originalError ?? err;
    const message = originalError?.message ?? String(err);
    const number = originalError?.number ?? null;
    const lineNumber = originalError?.lineNumber ?? null;
    const state = originalError?.state ?? null;

    // Tenta extrair número da linha da mensagem de erro
    const lineMatch = message.match(/line\s+(\d+)/i);
    const errorLine = lineNumber ?? (lineMatch ? parseInt(lineMatch[1], 10) : undefined);

    // Tenta extrair posição da coluna
    const colMatch = message.match(/(?:position|column)\s+(\d+)/i);
    const errorColumn = colMatch ? parseInt(colMatch[1], 10) : undefined;

    return {
      isValid: false,
      message: 'Erro de sintaxe SQL encontrado.',
      errorDetails: `[${number ?? '??? '}] ${message}`,
      errorLine: errorLine ?? undefined,
      errorColumn: errorColumn ?? undefined,
    };
  } finally {
    if (pool) {
      try { await pool.close(); } catch { /* ignora erro no fechamento */ }
    }
  }
}

/** Registra a ferramenta de validação SQL no servidor MCP */
export function registerSqlValidator(server: McpServer): void {
  server.registerTool(
    'totvs_validate_sql',
    {
      title: 'Validar Sintaxe SQL T-SQL',
      description: `Valida a sintaxe de uma consulta T-SQL sem executá-la.

Conecta-se ao SQL Server e utiliza SET PARSEONLY ON para verificar se a sintaxe SQL está correta.
Conexão usa as variáveis de ambiente DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD.

Args:
  - sql (string): Consulta T-SQL a ser validada. Pode conter múltiplas statements.

Returns:
  - isValid (boolean): true se a sintaxe está correta
  - message (string): Mensagem descritiva do resultado
  - errorDetails (string | null): Detalhes do erro de sintaxe (se houver)
  - errorLine (number | null): Número da linha com erro (se disponível)
  - errorColumn (number | null): Posição da coluna com erro (se disponível)

Exemplos:
  - "SELECT * FROM PFUNC WHERE CODFUNC = 1" → válido
  - "SELECTR * FROM PFUNC" → inválido (SELECTR não reconhecido)
  - "SELECT * FROM TABELA NAOEXISTENTE" → válido sintaticamente (PARSEONLY não valida objetos)

Nota: SET PARSEONLY valida apenas sintaxe, NÃO verifica se tabelas/colunas existem.`,
      inputSchema: {
        sql: z.string().min(1).max(100000).describe('Consulta T-SQL a ser validada'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sql }) => {
      const result = await validateSqlSyntax(sql);

      const lines = [
        `# Validação de Sintaxe SQL`,
        '',
        `**Status:** ${result.isValid ? '✅ Válido' : '❌ Inválido'}`,
        `**Mensagem:** ${result.message}`,
      ];

      if (!result.isValid && result.errorDetails) {
        lines.push('', '## Detalhes do Erro', '');
        lines.push('```', result.errorDetails, '```');

        if (result.errorLine != null) {
          lines.push('', `**Linha:** ${result.errorLine}`);
        }
        if (result.errorColumn != null) {
          lines.push(`**Coluna:** ${result.errorColumn}`);
        }
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    },
  );
}
