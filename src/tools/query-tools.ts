import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeQuery } from '../services/db-client.js';
import { getTableDetail } from '../services/docs-reader.js';
import { ResponseFormat } from '../types.js';

/** Registra as ferramentas de execução de queries SQL */
export function registerQueryTools(server: McpServer): void {
  // ── totvs_execute_query ───────────────────────────────────────────────────
  server.registerTool(
    'totvs_execute_query',
    {
      title: 'Executar Query SQL no TOTVS RM',
      description: `Executa uma query T-SQL de LEITURA (SELECT) no banco de dados ERP TOTVS RM.

SEGURANÇA: Apenas instruções SELECT são permitidas. INSERT, UPDATE, DELETE, DROP, EXEC e outros
comandos de escrita/DDL são explicitamente bloqueados.

Boas práticas obrigatórias:
  - SEMPRE inclua (NOLOCK) após cada tabela para evitar bloqueios
  - SEMPRE filtre por CODCOLIGADA quando a tabela possuir esta coluna
  - SEMPRE qualifique colunas com o alias da tabela para evitar ambiguidade
  - NUNCA use SELECT * — liste as colunas explicitamente
  - Limite resultados com TOP N quando necessário

Args:
  - sql (string): Query T-SQL SELECT válida
  - params (object): Parâmetros nomeados para a query (ex: {"codColigada": 1})
  - max_rows (number): Limite máximo de linhas retornadas (padrão: 100, máx: 1000)
  - response_format ('markdown' | 'json'): Formato de saída (padrão: 'markdown')

Returns:
  Resultado da query com colunas e linhas.

Exemplo de query correta:
  SELECT TOP 10
    F.CODCOLIGADA,
    F.CHAPA,
    F.NOME,
    F.CODSITUACAO
  FROM PFUNC F (NOLOCK)
  WHERE F.CODCOLIGADA = @codColigada
    AND F.CODSITUACAO = 'A'`,
      inputSchema: {
        sql: z
          .string()
          .min(10)
          .max(8000)
          .describe('Query T-SQL SELECT. Use (NOLOCK), filtre por CODCOLIGADA e não use SELECT *.'),
        params: z
          .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional()
          .default({})
          .describe('Parâmetros nomeados da query (ex: {"codColigada": 1, "chapa": "000001"})'),
        max_rows: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe('Limite máximo de linhas no resultado (padrão: 100)'),
        response_format: z
          .nativeEnum(ResponseFormat)
          .default(ResponseFormat.MARKDOWN)
          .describe("Formato de saída: 'markdown' ou 'json'"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sql: tsql, params, max_rows, response_format }) => {
      // Injeta TOP N se o usuário não declarou explicitamente
      const limitedSql = injectTopN(tsql, max_rows);

      let result: { columns: string[]; rows: Record<string, unknown>[]; rowCount: number };
      try {
        result = await executeQuery(limitedSql, params as Record<string, string | number | boolean | Date | null>);
      } catch (err) {
        return { content: [{ type: 'text', text: `Erro ao executar query: ${(err as Error).message}` }] };
      }

      if (result.rowCount === 0) {
        return { content: [{ type: 'text', text: 'A query não retornou nenhum resultado.' }] };
      }

      if (response_format === ResponseFormat.JSON) {
        const out = { columns: result.columns, rows: result.rows, rowCount: result.rowCount };
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
      }

      // Formata como tabela markdown
      const header = `| ${result.columns.join(' | ')} |`;
      const separator = `| ${result.columns.map(() => '---').join(' | ')} |`;
      const dataRows = result.rows.map(row =>
        `| ${result.columns.map(c => formatCell(row[c])).join(' | ')} |`,
      );

      const lines = [
        `# Resultado da Query`,
        '',
        `**Linhas retornadas:** ${result.rowCount}`,
        '',
        header,
        separator,
        ...dataRows,
      ];

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // ── totvs_suggest_query ───────────────────────────────────────────────────
  server.registerTool(
    'totvs_suggest_query',
    {
      title: 'Sugerir Query SQL para Tabela TOTVS RM',
      description: `Gera um modelo de query SELECT para uma tabela do TOTVS RM, seguindo as boas práticas do ERP.

Use quando precisar de um ponto de partida para escrever uma query.
A query sugerida inclui as colunas da tabela, (NOLOCK), filtro por CODCOLIGADA e aliases corretos.

Args:
  - table_name (string): Nome da tabela (ex: PFUNC, FCFO, TITMMOV)
  - include_joins (boolean): Se deve incluir JOINs básicos com tabelas relacionadas via FK (padrão: false)`,
      inputSchema: {
        table_name: z.string().min(1).max(100).describe('Nome da tabela (ex: PFUNC, TITMMOV)'),
        include_joins: z
          .boolean()
          .default(false)
          .describe('Incluir JOINs básicos com tabelas relacionadas via FK'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ table_name, include_joins }) => {
      let detail;
      try {
        detail = getTableDetail(table_name);
      } catch (err) {
        return { content: [{ type: 'text', text: (err as Error).message }] };
      }

      const alias = table_name.substring(0, 1);
      const hasCodColigada = detail.columns.some(c => c.name === 'CODCOLIGADA');

      const columnLines = detail.columns
        .slice(0, 15) // lista até 15 colunas para não ficar muito longo
        .map((c, i) => {
          const comma = i < Math.min(detail.columns.length, 15) - 1 ? ',' : '';
          return `    ${alias}.${c.name}${comma}${c.description ? ` -- ${c.description}` : ''}`;
        });

      const lines: string[] = [
        `-- Query para a tabela ${detail.name}`,
        `-- ${detail.description}`,
        '',
        'SELECT TOP 100',
        ...columnLines,
        `FROM ${detail.name} ${alias} (NOLOCK)`,
      ];

      if (hasCodColigada) {
        lines.push(`WHERE ${alias}.CODCOLIGADA = 1 -- Ajuste conforme a coligada`);
      }

      if (include_joins && detail.outboundFks.length > 0) {
        lines.push('');
        lines.push('-- JOINs com tabelas relacionadas:');
        for (const fk of detail.outboundFks.slice(0, 3)) {
          const fkAlias = fk.referencedTable.substring(0, 2).toLowerCase();
          const joinCols = fk.columns
            .map((col, i) => `${alias}.${col} = ${fkAlias}.${fk.referencedColumns[i]}`)
            .join(' AND ');
          lines.push(`-- INNER JOIN ${fk.referencedTable} ${fkAlias} (NOLOCK) ON ${joinCols}`);
        }
      }

      lines.push('', `-- Observação: Tabela possui ${detail.columns.length} colunas no total.`);
      if (detail.columns.length > 15) {
        lines.push(`-- Use totvs_get_table_schema para ver todas as ${detail.columns.length} colunas.`);
      }

      return { content: [{ type: 'text', text: '```sql\n' + lines.join('\n') + '\n```' }] };
    },
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Se a query não tiver TOP N, injeta TOP <max_rows> no primeiro SELECT.
 */
function injectTopN(tsql: string, maxRows: number): string {
  const topRe = /\bSELECT\s+(TOP\s+\d+)/i;
  if (topRe.test(tsql)) return tsql; // já tem TOP

  return tsql.replace(/\bSELECT\b/i, `SELECT TOP ${maxRows}`);
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  const str = String(value);
  // Escapa pipe do markdown
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
