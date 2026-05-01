import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getDbIndexMarkdown,
  getTableDetail,
  getTableRules,
  hasTableRules,
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
        phonetic: z.boolean().default(false).describe('Habilita busca fonética (ignora acentos e aplica equivalências sonoras do português). Padrão: true'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit, offset, phonetic }) => {
      const result = searchTables(query, limit, offset, phonetic);

      if (result.items.length === 0) {
        return { content: [{ type: 'text', text: `Nenhuma tabela encontrada para: "${query}"` }] };
      }

      const lines = [
        `# Tabelas TOTVS RM — Busca: "${query}"`,
        '',
        `Encontradas **${result.total}** tabelas (exibindo ${result.items.length}):`,
        '',
        '| Tabela | Regras | Descrição | Módulo |',
        '|--------|--------|-----------|--------|',
        ...result.items.map(t => {
          const rules = hasTableRules(t.name) ? '✓' : '-';
          return `| \`${t.name}\` | ${rules} | ${t.description} | ${t.module} |`;
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
      let detail: TableDetail;
      try {
        detail = getTableDetail(table_name);
      } catch (err) {
        return { content: [{ type: 'text', text: (err as Error).message }] };
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
  - offset (number): Deslocamento para paginação (padrão: 0)`,
      inputSchema: {
        module_prefix: z.string().length(1).describe('Letra prefixo do módulo (ex: P, F, T, C, V)'),
        limit: z.number().int().min(1).max(200).default(50).describe('Máximo de resultados'),
        offset: z.number().int().min(0).default(0).describe('Deslocamento para paginação'),
     },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ module_prefix, limit, offset }) => {
      const prefix = module_prefix.toUpperCase();
      const moduleName = MODULES[prefix] ?? `Módulo '${prefix}' não identificado`;
      const result = listTablesByModule(prefix, limit, offset);

      if (result.items.length === 0) {
        return { content: [{ type: 'text', text: `Nenhuma tabela encontrada para o módulo: ${prefix}` }] };
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
