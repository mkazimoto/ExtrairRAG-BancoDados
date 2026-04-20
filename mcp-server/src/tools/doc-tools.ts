import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    getDbIndexMarkdown,
    getTableDetail,
    listTablesByModule,
    searchTables
} from '../services/docs-reader.js';
import { MODULES, ResponseFormat, type TableDetail, type TableSummary } from '../types.js';

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
  - response_format ('markdown' | 'json'): Formato de saída (padrão: 'markdown')

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
        response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("Formato: 'markdown' ou 'json'"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit, offset, response_format }) => {
      const result = searchTables(query, limit, offset);

      if (result.items.length === 0) {
        return { content: [{ type: 'text', text: `Nenhuma tabela encontrada para: "${query}"` }] };
      }

      if (response_format === ResponseFormat.JSON) {
        const out = {
          total: result.total,
          count: result.items.length,
          offset,
          has_more: result.total > offset + result.items.length,
          next_offset: result.total > offset + result.items.length ? offset + result.items.length : undefined,
          tables: result.items,
        };
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
      }

      const lines = [
        `# Tabelas TOTVS RM — Busca: "${query}"`,
        '',
        `Encontradas **${result.total}** tabelas (exibindo ${result.items.length}):`,
        '',
        '| Tabela | Módulo | Descrição |',
        '|--------|--------|-----------|',
        ...result.items.map(t => `| \`${t.name}\` | ${t.module} | ${t.description} |`),
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
  - response_format ('markdown' | 'json'): Formato de saída (padrão: 'markdown')

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
        response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("Formato: 'markdown' ou 'json'"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ table_name, response_format }) => {
      let detail: TableDetail;
      try {
        detail = getTableDetail(table_name);
      } catch (err) {
        return { content: [{ type: 'text', text: (err as Error).message }] };
      }

      if (response_format === ResponseFormat.JSON) {
        const out = {
          name: detail.name,
          description: detail.description,
          primaryKey: detail.primaryKey,
          columns: detail.columns,
          outboundFks: detail.outboundFks,
          inboundFks: detail.inboundFks,
        };
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
      }

      return { content: [{ type: 'text', text: detail.rawMarkdown }] };
    },
  );

  // ── totvs_list_tables_by_module ───────────────────────────────────────────
  server.registerTool(
    'totvs_list_tables_by_module',
    {
      title: 'Listar Tabelas por Módulo TOTVS RM',
      description: `Lista todas as tabelas de um módulo específico do ERP TOTVS RM.

Cada módulo é identificado por uma letra prefixo no nome da tabela:
- P → TOTVS Folha de Pagamento (ex: PFUNC, PPESSOA, PCONTRATACAO)
- F → TOTVS Gestão Financeira (ex: FCFO, FTIT, FLAN)
- T → TOTVS Gestão de Estoque, Compras e Faturamento (ex: TITMMOV, TMOV, TPRD)
- C → TOTVS Gestão Contábil (ex: CCUSTO, CCONTAB)
- V → TOTVS Gestão de Pessoas (ex: VFUNC, VHISTCARGO)
- S → TOTVS Educacional
- E → Ensino Básico
- M → TOTVS Construção e Projetos
(e demais módulos)

Args:
  - module_prefix (string): Letra prefixo do módulo (ex: "P", "F", "T")
  - limit (number): Máximo de resultados (padrão: 50, máx: 200)
  - offset (number): Deslocamento para paginação (padrão: 0)
  - response_format ('markdown' | 'json'): Formato de saída (padrão: 'markdown')`,
      inputSchema: {
        module_prefix: z.string().length(1).describe('Letra prefixo do módulo (ex: P, F, T, C, V)'),
        limit: z.number().int().min(1).max(200).default(50).describe('Máximo de resultados'),
        offset: z.number().int().min(0).default(0).describe('Deslocamento para paginação'),
        response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("Formato: 'markdown' ou 'json'"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ module_prefix, limit, offset, response_format }) => {
      const prefix = module_prefix.toUpperCase();
      const moduleName = MODULES[prefix] ?? `Módulo '${prefix}' não identificado`;
      const result = listTablesByModule(prefix, limit, offset);

      if (result.items.length === 0) {
        return { content: [{ type: 'text', text: `Nenhuma tabela encontrada para o módulo: ${prefix}` }] };
      }

      if (response_format === ResponseFormat.JSON) {
        const out = {
          module_prefix: prefix,
          module_name: moduleName,
          total: result.total,
          count: result.items.length,
          offset,
          has_more: result.total > offset + result.items.length,
          next_offset: result.total > offset + result.items.length ? offset + result.items.length : undefined,
          tables: result.items,
        };
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
      }

      const lines = [
        `# Módulo: ${moduleName} (${prefix})`,
        '',
        `**Total de tabelas:** ${result.total} (exibindo ${result.items.length})`,
        '',
        '| Tabela | Descrição |',
        '|--------|-----------|',
        ...result.items.map((t: TableSummary) => `| \`${t.name}\` | ${t.description} |`),
      ];

      if (result.total > offset + result.items.length) {
        lines.push('', `> Use offset=${offset + result.items.length} para ver mais.`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
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

  // ── totvs_get_db_index ────────────────────────────────────────────────────
  server.registerTool(
    'totvs_get_db_index',
    {
      title: 'Obter Índice do Banco de Dados TOTVS RM',
      description: `Retorna o índice completo de tabelas do banco de dados ERP TOTVS RM em formato markdown.

AVISO: Este arquivo é grande (8000+ tabelas). Use apenas quando precisar de uma visão geral completa.
Para buscas específicas, prefira totvs_search_tables ou totvs_list_tables_by_module.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const content = getDbIndexMarkdown();
        return { content: [{ type: 'text', text: content }] };
      } catch (err) {
        return { content: [{ type: 'text', text: (err as Error).message }] };
      }
    },
  );
}
