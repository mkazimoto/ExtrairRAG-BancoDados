import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MODULES, type ColumnInfo, type ForeignKey, type TableDetail, type TableSummary } from '../types.js';

/** Caminho base para a documentação de tabelas */
const DOCS_DIR = resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '..', '..', '..', 'docs', 'db', 'tables');
const INDEX_FILE = resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '..', '..', '..', 'ai', 'db-index.md');

/** Cache em memória dos índices e detalhes de tabelas */
let tableIndex: TableSummary[] | null = null;

/**
 * Retorna o módulo do ERP com base no prefixo da tabela.
 */
export function getModule(tableName: string): string {
  const prefix = tableName[0].toUpperCase();
  return MODULES[prefix] ?? 'Módulo desconhecido';
}

/**
 * Carrega o índice de tabelas a partir do db-index.md.
 * O resultado é cacheado em memória.
 */
export function loadTableIndex(): TableSummary[] {
  if (tableIndex) return tableIndex;

  if (!existsSync(INDEX_FILE)) {
    throw new Error(`Arquivo de índice não encontrado: ${INDEX_FILE}`);
  }

  const content = readFileSync(INDEX_FILE, 'utf-8');
  const rows: TableSummary[] = [];

  // Parseia as linhas da tabela markdown: | [`NOME`](link) | Descrição |
  const lineRe = /^\|\s*\[`([A-Z0-9_]+)`\][^\|]+\|\s*(.*?)\s*\|/;
  for (const line of content.split('\n')) {
    const m = lineRe.exec(line);
    if (!m) continue;
    const name = m[1];
    rows.push({
      name,
      description: m[2].trim(),
      module: getModule(name),
    });
  }

  tableIndex = rows;
  return rows;
}

/**
 * Normaliza texto para busca fonética:
 * - Remove acentos e diacríticos (NFD)
 * - Converte para minúsculas
 * - Aplica equivalências fonéticas do português
 */
function normalizePhonetic(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove diacríticos (ã→a, ç→c, é→e, etc.)
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/nh/g, 'n')
    .replace(/lh/g, 'l')
    .replace(/ch/g, 'x')
    .replace(/qu/g, 'k')
    .replace(/[yw]/g, 'i')
    .replace(/([a-z])\1+/g, '$1');   // reduz letras duplicadas (ss→s, rr→r)
}

/**
 * Busca tabelas pelo nome ou descrição com suporte a busca multi-palavra.
 * @param phonetic Habilita normalização fonética (padrão: true)
 */
export function searchTables(query: string, limit = 20, offset = 0, phonetic = true): { items: TableSummary[]; total: number } {
  const index = loadTableIndex();

  const normalize = phonetic ? normalizePhonetic : (s: string) => s.toLowerCase();

  // Palavras irrelevantes (stopwords) a serem ignoradas na busca
  const STOPWORDS = new Set(['/', '-', 'p/', 'de', 'do', 'da', 'dos', 'das', 'por', 'para', 'pelo', 'pela', 'em', 'no', 'na', 'nos', 'nas', 'a', 'o', 'e', 'ao', 'ou', 'com', 'sem']);

  // Divide a query em palavras, remove stopwords e normaliza conforme o modo escolhido
  const words = query
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 0)
    .filter(w => !STOPWORDS.has(w.toLowerCase()))
    .map(w => {
      const normalized = normalize(w);
      // Remove 's' final para lidar com plural (apenas na busca fonética)
      return phonetic && normalized.endsWith('s') && normalized.length > 2
        ? normalized.slice(0, -1)
        : normalized;
    });

  if (words.length === 0) {
    return { items: [], total: 0 };
  }

  // Filtra se QUALQUER palavra aparece no nome ou descrição
  const filtered = index.filter(t => {
    const name = normalize(t.name);
    const desc = normalize(t.description);
    return words.some(word => name.includes(word) || desc.includes(word));
  });

  return {
    total: filtered.length,
    items: filtered.slice(offset, offset + limit),
  };
}

/**
 * Lista tabelas por módulo (prefixo).
 */
export function listTablesByModule(module: string, limit = 50, offset = 0): { items: TableSummary[]; total: number } {
  const index = loadTableIndex();
  const prefix = module.toUpperCase();
  const filtered = index.filter(t => t.name.startsWith(prefix));
  return {
    total: filtered.length,
    items: filtered.slice(offset, offset + limit),
  };
}

/**
 * Carrega os detalhes de uma tabela específica a partir do arquivo .md.
 */
export function getTableDetail(tableName: string): TableDetail {
  const upper = tableName.toUpperCase();
  const filePath = join(DOCS_DIR, `${upper}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Documentação não encontrada para a tabela: ${upper}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  return parseTableMarkdown(upper, raw);
}

/**
 * Retorna o conteúdo raw (markdown) do arquivo de uma tabela.
 */
export function getTableRawMarkdown(tableName: string): string {
  const upper = tableName.toUpperCase();
  const filePath = join(DOCS_DIR, `${upper}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Documentação não encontrada para a tabela: ${upper}`);
  }
  return readFileSync(filePath, 'utf-8');
}

/**
 * Retorna o conteúdo do arquivo de regras de uma tabela (<TABELA>.rules.md), ou null se não existir.
 */
export function getTableRules(tableName: string): string | null {
  const upper = tableName.toUpperCase();
  const filePath = join(DOCS_DIR, `${upper}.rules.md`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

/**
 * Retorna o conteúdo do db-index.md.
 */
export function getDbIndexMarkdown(): string {
  if (!existsSync(INDEX_FILE)) {
    throw new Error(`Arquivo de índice não encontrado: ${INDEX_FILE}`);
  }
  return readFileSync(INDEX_FILE, 'utf-8');
}

/**
 * Lista todos os nomes de tabelas disponíveis na documentação local.
 */
export function listAvailableTables(): string[] {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}

// ─── Parsers internos ─────────────────────────────────────────────────────────

function parseTableMarkdown(name: string, raw: string): TableDetail {
  const lines = raw.split('\n');

  const description = extractSection(lines, '## Descrição', '##').trim();

  const pkLine = extractMetaValue(lines, 'Chave primária');
  const primaryKey = pkLine
    ? pkLine.match(/`([^`]+)`/g)?.map(s => s.replace(/`/g, '')) ?? []
    : [];

  const columns = parseColumnsTable(lines);
  const outboundFks = parseFkTable(lines, 'Chaves Estrangeiras de Saída');
  const inboundFks = parseFkTable(lines, 'Chaves Estrangeiras de Entrada');

  return { name, description, primaryKey, columns, outboundFks, inboundFks, rawMarkdown: raw };
}

function extractSection(lines: string[], startMarker: string, endMarker: string): string {
  let inside = false;
  const result: string[] = [];
  for (const line of lines) {
    if (line.trim() === startMarker) { inside = true; continue; }
    if (inside && line.startsWith(endMarker) && line.trim() !== startMarker) break;
    if (inside) result.push(line);
  }
  return result.join('\n');
}

function extractMetaValue(lines: string[], label: string): string | null {
  for (const line of lines) {
    if (line.includes(`| ${label}`) || line.includes(`| ${label} |`)) {
      // | Chave primária | `COL1`, `COL2` |
      const parts = line.split('|').map(s => s.trim()).filter(Boolean);
      return parts[1] ?? null;
    }
  }
  return null;
}

function parseColumnsTable(lines: string[]): ColumnInfo[] {
  const cols: ColumnInfo[] = [];
  let inTable = false;

  for (const line of lines) {
    if (line.includes('## Colunas')) { inTable = true; continue; }
    if (inTable && line.startsWith('## ')) break;
    if (!inTable) continue;

    // Pula header e separador
    if (line.startsWith('| #') || line.startsWith('|---') || line.trim() === '') continue;

    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 4) continue;

    const ordinal = parseInt(parts[0], 10);
    if (isNaN(ordinal)) continue;

    cols.push({
      ordinal,
      name: parts[1].replace(/`/g, ''),
      type: parts[2].replace(/`/g, ''),
      nullable: parts[3] === 'Sim',
      isPrimaryKey: (parts[4] ?? '').includes('✓'),
      description: parts[5] ?? '',
    });
  }
  return cols;
}

function parseFkTable(lines: string[], sectionTitle: string): ForeignKey[] {
  const fks: ForeignKey[] = [];
  let inSection = false;
  let inTable = false;

  for (const line of lines) {
    if (line.includes(sectionTitle)) { inSection = true; continue; }
    if (inSection && line.startsWith('### ') && !line.includes(sectionTitle)) break;
    if (!inSection) continue;

    if (line.startsWith('| Constraint')) { inTable = true; continue; }
    if (line.startsWith('|---')) continue;
    if (!inTable || line.trim() === '' || !line.startsWith('|')) continue;
    if (line.startsWith('## ') || line.startsWith('### ')) break;

    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 4) continue;

    const parseColList = (s: string) =>
      s.match(/`([^`]+)`/g)?.map(c => c.replace(/`/g, '')) ?? [s.replace(/`/g, '')];

    fks.push({
      constraint: parts[0].replace(/`/g, ''),
      columns: parseColList(parts[1]),
      referencedTable: parts[2].replace(/`/g, ''),
      referencedColumns: parseColList(parts[3]),
    });
  }
  return fks;
}
