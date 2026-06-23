import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createRequire } from 'node:module';

/** @import SyntaxError do parser Peggy do node-sql-parser */
interface ParseErrorLocation {
  start: { offset: number; line: number; column: number };
  end: { offset: number; line: number; column: number };
}
interface ParseException extends Error {
  location?: ParseErrorLocation;
  found?: string;
  expected?: unknown[];
}

/**
 * Factory sob demanda do parser TransactSQL.
 *
 * Usa createRequire para carregar o parser CommonJS do node-sql-parser
 * em um contexto ESM. O parser é criado apenas na primeira chamada e
 * reutilizado nas chamadas seguintes (lazy singleton).
 */
type TsqlParser = { astify: (sql: string) => unknown };

let _parser: TsqlParser | null = null;

function getParser(): TsqlParser {
  if (!_parser) {
    const require = createRequire(import.meta.url);
    const { Parser } = require('node-sql-parser/build/transactsql') as { Parser: new () => TsqlParser };
    _parser = new Parser();
  }
  return _parser;
}

/**
 * Remove cláusulas OPTION (... ) do final da string SQL.
 *
 * O parser PEG.js do node-sql-parser não suporta a sintaxe
 * OPTION (MAXRECURSION N, RECOMPILE, OPTIMIZE FOR UNKNOWN, …)
 * que é específica do T-SQL. Esta função as remove antes da validação.
 */
export function stripOptionClauses(sql: string): string {
  let result = sql.trimEnd();

  // OPTION (...) seguido opcionalmente de comentário (-- ou /* */) e/ou ;
  const optionRe = /\s*\bOPTION\s*\(((?:[^()]+|\([^()]*\))*)\)\s*(?:--[^\n]*)?(?:\/\*[\s\S]*?\*\/)?\s*;?\s*$/i;

  while (optionRe.test(result)) {
    result = result.replace(optionRe, '').trimEnd();
  }

  return result || sql.trimEnd();
}

/**
 * Valida a sintaxe de uma consulta T-SQL localmente usando PEG.js.
 *
 * Não requer conexão com banco de dados — o parsing é feito 100% offline
 * pelo parser TransactSQL do node-sql-parser, que entende a maior parte
 * da sintaxe T-SQL (SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP,
 * CTE, JOIN, subqueries, TOP, OUTPUT, MERGE, PIVOT/UNPIVOT, etc.).
 *
 * Antes de validar, remove automaticamente cláusulas OPTION (...)
 * do final da consulta, pois não são suportadas pelo parser PEG.js.
 */
export function validateSqlSyntax(sqlQuery: string): {
  isValid: boolean;
  message: string;
  errorDetails?: string;
  errorLine?: number;
  errorColumn?: number;
} {
  if (!sqlQuery || sqlQuery.trim().length === 0) {
    return { isValid: false, message: 'A consulta SQL está vazia.' };
  }

  const cleanedSql = stripOptionClauses(sqlQuery);

  try {
    getParser().astify(cleanedSql);
    return { isValid: true, message: 'Sintaxe SQL válida.' };
  } catch (err: unknown) {
    const e = err as ParseException;
    const loc = e.location?.start;
    const summary = loc
      ? `[Linha ${loc.line}, Coluna ${loc.column}] ${e.message}`
      : e.message;

    return {
      isValid: false,
      message: 'Erro de sintaxe SQL encontrado.',
      errorDetails: summary,
      errorLine: loc?.line,
      errorColumn: loc?.column,
    };
  }
}

/** Registra a ferramenta de validação SQL no servidor MCP */
export function registerSqlValidator(server: McpServer): void {
  server.registerTool(
    'totvs_validate_sql',
    {
      title: 'Validar Sintaxe SQL T-SQL',
      description: `Valida a sintaxe de uma consulta T-SQL localmente (offline).

Usa o parser PEG.js (node-sql-parser/transactsql) para analisar a sintaxe
T-SQL sem conectar ao banco de dados. Não requer credenciais nem conexão de rede.
Suporta a maior parte da sintaxe T-SQL incluindo TOP, OUTPUT, MERGE, PIVOT/UNPIVOT.

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
  - "SELECT * FROM TABELA NAOEXISTENTE" → válido sintaticamente (não valida objetos)

Nota: valida apenas sintaxe, NÃO verifica se tabelas/colunas existem.`,
      inputSchema: {
        sql: z.string().min(1).max(100000).describe('Consulta T-SQL a ser validada'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sql }) => {
      const result = validateSqlSyntax(sql);

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
