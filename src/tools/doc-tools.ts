import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getDbIndexMarkdown,
  getTableRawMarkdown,
  getTableRules,
  hasTableRules,
  listTablesByModule,
  searchTables
} from '../services/docs-reader.js';
import { MODULES, ResponseFormat, type TableSummary } from '../types.js';

/** Registra todas as ferramentas relacionadas à documentação de tabelas */
export function registerDocTools(server: McpServer): void {
  // ── totvs_search_tables ───────────────────────────────────────────────────
  server.registerTool(
    'totvs_search_tables',
    {
      title: 'Buscar Tabelas TOTVS RM',
      description: `Busca tabelas do banco de dados ERP TOTVS RM por nome ou descrição.

Use esta ferramenta para descobrir quais tabelas existem e qual módulo elas pertencem.
Retorna nome, descrição e módulo de cada tabela encontrada.

Args:
  - query (string): Texto para buscar no nome ou descrição da tabela (ex: "funcionario", "folha", "PFUNC")
  - limit (number): Máximo de resultados (padrão: 20, máx: 100)
  - offset (number): Deslocamento para paginação (padrão: 0)
  
Returns:
  Lista de tabelas com nome, descrição e módulo do ERP.

Exemplos:
  - "Quais tabelas armazenam dados de funcionários?" → query="funcionario"
  - "Existe alguma tabela de lançamentos financeiros?" → query="lancamento"
  - "Tabelas da folha de pagamento com chapa"→ query="chapa"`,
      inputSchema: {
        query: z.string().min(1).max(200).describe('Texto para buscar no nome ou descrição da tabela'),
        limit: z.number().int().min(1).max(100).default(20).describe('Máximo de resultados'),
        offset: z.number().int().min(0).default(0).describe('Deslocamento para paginação'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit, offset }) => {
      const result = searchTables(query, limit, offset);

      if (result.items.length === 0) {
        return { content: [{ type: 'text', text: `Nenhuma tabela encontrada para: "${query}"` }] };
      }

      const lines = [
        `# Tabelas TOTVS RM — Busca: "${query}"`,
        '',
        `Encontradas **${result.total}** tabelas (exibindo ${result.items.length}):`,
        '',
        '| Relevância | Tabela | Regras | Descrição | Módulo |',
        '|:----------:|--------|--------|-----------|--------|',
        ...result.items.map(t => {
          const rules = hasTableRules(t.name) ? '✓' : '-';
          const colInfo = t.matchedColumns && t.matchedColumns.length > 0
            ? ` *(via coluna: ${t.matchedColumns.map(c => `\`${c.name}\``).join(', ')})*`
            : '';
          const score = t.score ?? 0;
          return `| ${score} | \`${t.name}\` | ${rules} | ${t.description}${colInfo} | ${t.module} |`;
        }),
      ];

      if (result.total > offset + result.items.length) {
        lines.push('', `> Use offset=${offset + result.items.length} para ver mais resultados.`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // ── totvs_get_table_schema ────────────────────────────────────────────────
  server.registerTool(
    'totvs_get_table_schema',
    {
      title: 'Obter Esquema de Tabela TOTVS RM',
      description: `Retorna o esquema completo de uma tabela do ERP TOTVS RM: colunas, tipos, chave primária e relacionamentos (FKs).

Use esta ferramenta antes de escrever qualquer query SQL para entender a estrutura exata da tabela.
Indispensável para saber quais colunas existem, seus tipos e como as tabelas se relacionam.

Args:
  - table_name (string): Nome da tabela (ex: "PFUNC", "FCFO", "TITMMOV")

Returns:
  - Descrição da tabela
  - Chave primária
  - Lista de colunas com tipo, nulabilidade e descrição semântica
  - Chaves estrangeiras de entrada e saída

Importante:
  - SEMPRE inclua CODCOLIGADA no filtro quando a tabela possuir esta coluna.
  - Use (NOLOCK) em queries de leitura para evitar bloqueios.`,
      inputSchema: {
        table_name: z.string().min(1).max(100).describe('Nome da tabela (ex: PFUNC, TITMMOV)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ table_name }) => {
      try {
        const raw = getTableRawMarkdown(table_name);
        return { content: [{ type: 'text', text: raw }] };
      } catch (err) {
        return { content: [{ type: 'text', text: (err as Error).message }] };
      }
    },
  );

  // ── totvs_list_modules ────────────────────────────────────────────────────
  server.registerTool(
    'totvs_list_modules',
    {
      title: 'Listar Módulos ERP TOTVS RM',
      description: `Retorna a lista de todos os módulos do ERP TOTVS RM com seus prefixos de tabela.

Use esta ferramenta para descobrir qual prefixo pertence a qual módulo antes de listar tabelas.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const lines = [
        '# Módulos ERP TOTVS RM',
        '',
        '| Prefixo | Módulo |',
        '|---------|--------|',
        ...Object.entries(MODULES).map(([k, v]) => `| \`${k}\` | ${v} |`),
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // ── totvs_get_table_rules ──────────────────────────────────────────────────
  server.registerTool(
    'totvs_get_table_rules',
    {
      title: 'Obter Regras de Colunas de Tabela TOTVS RM',
      description: `Retorna as regras de valores possíveis para colunas de uma tabela do ERP TOTVS RM.

Use esta ferramenta para descobrir os valores válidos de colunas codificadas (enumerações, flags, status, tipos).
Retorna null/mensagem informativa quando não há arquivo de regras para a tabela.

Args:
  - table_name (string): Nome da tabela (ex: "MBIMMODELO", "PFUNC", "TITMMOV")

Returns:
  Conteúdo do arquivo <TABELA>.rules.md com os possíveis valores documentados por coluna.`,
      inputSchema: {
        table_name: z.string().min(1).max(100).describe('Nome da tabela (ex: MBIMMODELO, PFUNC)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ table_name }) => {
      const rules = getTableRules(table_name);
      if (rules === null) {
        return { content: [{ type: 'text', text: `Nenhum arquivo de regras encontrado para a tabela: ${table_name.toUpperCase()}` }] };
      }
      return { content: [{ type: 'text', text: rules }] };
    },
  );
}
