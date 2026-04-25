import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getTableDetail } from '../services/docs-reader.js';

/** Registra as ferramentas de execução de queries SQL */
export function registerQueryTools(server: McpServer): void {

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

