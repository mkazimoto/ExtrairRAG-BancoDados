import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MODULES, type ColumnInfo, type ForeignKey, type TableDetail, type TableSummary } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Caminho base para a documentação de tabelas */
const DOCS_DIR = resolve(__dirname, '..', '..', 'docs', 'db', 'tables');
const INDEX_FILE = resolve(__dirname, '..', '..', 'ai', 'db-index.md');
const CACHE_FILE = resolve(__dirname, '..', '..', 'docs', 'db', 'cache.sqlite');

/** Cache em memória dos índices e detalhes de tabelas */
let tableIndex: TableSummary[] | null = null;
let indexMtime = 0;
const INDEX_TTL_MS = 60_000;

/** Interface genérica para entradas de cache com verificação de mtime */
interface CacheEntry<T> { value: T; mtime: number }

/** Cache LRU para detalhes de tabelas (max 200 entradas) */
const DETAIL_CACHE_MAX = 200;
const detailCache = new Map<string, CacheEntry<TableDetail>>();
const rawMarkdownCache = new Map<string, CacheEntry<string>>();

/** Cache LRU para conteúdos de arquivos .rules.md */
const rulesContentCache = new Map<string, CacheEntry<string>>();
const RULES_CONTENT_CACHE_MAX = 100;

/** Set de tabelas que possuem .rules.md (pré-carregado) */
let rulesTableSet: Set<string> | null = null;

/** Cache para getDbIndexMarkdown */
let dbIndexCache: CacheEntry<string> | null = null;

/** Instância lazy do SQLite de cache (somente leitura) */
let cacheDb: DatabaseSync | null = null;
let cacheDbInitialized = false;

function getCacheDb(): DatabaseSync | null {
  if (cacheDbInitialized) return cacheDb;
  cacheDbInitialized = true;
  if (!existsSync(CACHE_FILE)) { cacheDb = null; return null; }
  try {
    cacheDb = new DatabaseSync(CACHE_FILE);
    return cacheDb;
  } catch {
    cacheDb = null;
    return null;
  }
}

/**
 * Helper genérico para cache LRU com verificação de mtime.
 * Lê o arquivo via `reader(filePath)` apenas se o cache estiver expirado ou ausente.
 * Gerencia evicção LRU quando o cache excede `maxSize`.
 */
function lruCachedGet<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  filePath: string,
  reader: (path: string) => T,
  maxSize: number,
): T {
  const stat = statSync(filePath);
  const cached = cache.get(key);
  if (cached && stat.mtimeMs <= cached.mtime) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.value;
  }
  const value = reader(filePath);
  cache.set(key, { value, mtime: stat.mtimeMs });
  if (cache.size > maxSize) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }
  return value;
}

/**
 * Retorna o módulo do ERP com base no prefixo da tabela.
 */
export function getModule(tableName: string): string {
  const prefix = tableName[0].toUpperCase();
  return MODULES[prefix] ?? 'Módulo desconhecido';
}

/**
 * Carrega o índice de tabelas a partir do db-index.md.
 * O resultado é cacheado em memória com verificação de mtime.
 */
export function loadTableIndex(): TableSummary[] {
  const stat = statSync(INDEX_FILE, { throwIfNoEntry: false });
  if (!stat) {
    throw new Error(`Arquivo de índice não encontrado: ${INDEX_FILE}`);
  }

  if (tableIndex && stat.mtimeMs <= indexMtime) return tableIndex;

  const content = readFileSync(INDEX_FILE, 'utf-8');
  const rows: TableSummary[] = [];

  // Parseia as linhas da tabela markdown: | `TABELA` | Descrição |
  const lineRe = /^\|\s*`([A-Z0-9_]+)`\s*\|\s*(.*?)\s*\|/;
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
  indexMtime = stat.mtimeMs;
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
 * Retorna o coeficiente de Dice baseado em bigramas entre duas strings.
 * Resultado entre 0 (sem semelhança) e 1 (idêntico).
 */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const getBigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) ?? 0) + 1);
    }
    return map;
  };

  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);
  let intersection = 0;
  for (const [bg, countA] of bigramsA) {
    intersection += Math.min(countA, bigramsB.get(bg) ?? 0);
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * Calcula a maior similaridade de bigrama entre uma palavra e qualquer token
 * (palavra) do texto alvo. Retorna valor entre 0 e 1.
 * Só é executado quando não houve match exato e a palavra tem >= 4 chars.
 */
function maxBigramSim(word: string, text: string): number {
  if (word.length < 4) return 0;
  const tokens = text.split(/\W+/).filter(t => t.length >= 3);
  let max = 0;
  for (const token of tokens) {
    const sim = bigramSimilarity(word, token);
    if (sim > max) max = sim;
    if (max === 1) break; // não tem como melhorar
  }
  return max;
}

/**
 * Busca tabelas no cache SQLite pelo nome ou descrição de colunas.
 * Retorna tabelas que NÃO estejam em `excludeNames` (já encontradas pelo índice).
 */
function searchColumnInCache(
  rawWords: string[],
  excludeNames: Set<string>,
): TableSummary[] {
  if (rawWords.length === 0) return [];
  const db = getCacheDb();
  if (!db) return [];

  try {
    const conditions = rawWords
      .map(() => `(LOWER(c.nome) LIKE ? OR (c.gdic_descricao IS NOT NULL AND LOWER(c.gdic_descricao) LIKE ?))`)
      .join(' OR ');
    const params = rawWords.flatMap(w => [`%${w}%`, `%${w}%`]);

    const rows = db.prepare(`
      SELECT c.tabela, COALESCE(t.descricao, '') AS tabela_descricao,
             c.nome, COALESCE(c.gdic_descricao, '') AS gdic_descricao
      FROM   colunas c
      LEFT JOIN tabelas t ON t.nome = c.tabela
      WHERE  ${conditions}
      ORDER  BY c.tabela, c.ordinal
    `).all(...params) as Array<{ tabela: string; tabela_descricao: string; nome: string; gdic_descricao: string }>;

    // Agrupa colunas por tabela, ignorando as já encontradas pelo índice
    const byTable = new Map<string, { desc: string; cols: Array<{ name: string; description: string }> }>();
    for (const row of rows) {
      if (excludeNames.has(row.tabela)) continue;
      if (!byTable.has(row.tabela)) byTable.set(row.tabela, { desc: row.tabela_descricao, cols: [] });
      byTable.get(row.tabela)!.cols.push({ name: row.nome, description: row.gdic_descricao });
    }

    return [...byTable.entries()].map(([tableName, { desc, cols }]) => ({
      name: tableName,
      description: desc,
      module: getModule(tableName),
      matchedColumns: cols,
    }));
  } catch (err) {
    process.stderr.write(`[ERRO] searchColumnInCache: ${err instanceof Error ? err.message : String(err)}\n`);
    return [];
  }
}

export function searchTables(query: string, limit = 20, offset = 0): { items: TableSummary[]; total: number } {
  const index = loadTableIndex();

  // Palavras irrelevantes (stopwords) a serem ignoradas na busca
  const STOPWORDS = new Set(['/', '-', 'p/', 'de', 'do', 'da', 'dos', 'das', 'por', 'para', 'pelo', 'pela', 'em', 'no', 'na', 'nos', 'nas', 'a', 'o', 'e', 'ao', 'ou', 'com', 'sem']);

  // rawWords: apenas lowercase, sem fonética (para busca SQL no cache)
  const rawWords = query
    .split(/\s+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0 && !STOPWORDS.has(w));

  // words: normalização fonética (para busca no índice em memória)
  // Também trata plurais irregulares do português (ex: aluguel→alugueis, locação→locações)
  const words = rawWords.map(w => {
    const normalized = normalizePhonetic(w);
    if (normalized.endsWith('s') && normalized.length > 2) {
      // Plurais portugueses de palavras terminadas em 'ção' (-ções):
      // locação→locações, operação→operações, função→funções
      // Após normalização fonética: 'ções'→'coes', 'ção'→'cao'
      if (normalized.endsWith('coes') && normalized.length > 4) {
        return normalized.slice(0, -4) + 'cao';
      }
      const withoutS = normalized.slice(0, -1);
      // Plurais portugueses de palavras terminadas em 'l':
      // aluguel→alugueis, imóvel→imóveis, animal→animais
      // A forma singular substitui o 'i' final por 'l'
      if (withoutS.endsWith('i') && withoutS.length > 2) {
        return withoutS.slice(0, -1) + 'l';
      }
      return withoutS;
    }
    return normalized;
  });

  if (words.length === 0) {
    return { items: [], total: 0 };
  }

  // Pesos: +10 exato / sim*10 bigrama (módulo), +10 exato / sim*3 bigrama (nome), +3 exato / sim*1 bigrama (descrição)
  // O nome do módulo sempre usa normalização sem acentos para evitar falhas em queries sem acento
  const normalizeModule = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Limiar mínimo de similaridade por bigrama para considerar um match aproximado
  const BIGRAM_THRESHOLD = 0.6;

  const primaryMatches = index
    .map(t => {
      const name = normalizePhonetic(t.name);
      const desc = normalizePhonetic(t.description);
      const mod = normalizeModule(t.module);
      let score = 0;
      // Rastreia palavras que deram match como token na descrição
      const descTokenMatches = new Set<string>();
      // Pré-calcula tokens da descrição uma única vez
      const descTokens = desc.split(/[^a-z0-9]+/).filter(Boolean);
      const descTokenSet = new Set(descTokens);
      // Adiciona forma singular (sem 's' final) para match com palavras
      // na query que foram singularizadas (ex: "lancamentos"→"lancamento",
      // "financeiros"→"financeiro")
      for (const token of descTokens) {
        if (token.endsWith('s') && token.length > 2) {
          descTokenSet.add(token.slice(0, -1));
        }
      }

      for (const word of words) {
        const wordPlain = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Módulo: match exato +10, bigrama proporcional como fallback
        if (mod.includes(wordPlain)) {
          score += 10;
        } else {
          const sim = maxBigramSim(wordPlain, mod);
          if (sim >= BIGRAM_THRESHOLD) score += Math.round(sim * 10);
        }
        // Nome: match exato +10, bigrama proporcional como fallback
        if (name.includes(word)) {
          score += 10;
        } else {
          const sim = maxBigramSim(word, name);
          if (sim >= BIGRAM_THRESHOLD) score += Math.round(sim * 3);
        }
        // Descrição: match exato +3 (+8 se for token isolado), bigrama proporcional como fallback
        if (desc.includes(word)) {
          // Se a descrição normalizada (sem 's' final) é essencialmente a
          // própria palavra consultada, a tabela É sobre esse conceito — +18
          // (mesmo peso de nome exato +10 + token descrição +8)
          const descSingular = desc.endsWith('s') && desc.length > 2
            ? desc.slice(0, -1)
            : desc;
          if (descSingular === word) {
            score += 18;
            descTokenMatches.add(word);
          } else if (descTokenSet.has(word)) {
            score += 8; // match como token → pontuação média-alta
            descTokenMatches.add(word);
          } else {
            score += 3; // match como substring → pontuação baixa
          }
        } else {
          const sim = maxBigramSim(word, desc);
          if (sim >= BIGRAM_THRESHOLD) score += Math.round(sim * 1);
        }
      }

      // Bônus: se TODAS as palavras pesquisadas aparecem como tokens na descrição,
      // a tabela cobre o conceito completo da consulta
      if (descTokenMatches.size === words.length && words.length > 1) {
        score += 5;
      }

      // Bônus: tabelas com regras documentadas (.rules.md) recebem +5
      // pois tendem a ser tabelas de maior relevância no sistema
      if (hasTableRules(t.name)) {
        score += 5;
      }

      return { ...t, score };
    })
    .filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score);

  // Busca secundária: tabelas com colunas (nome ou descrição GDIC) que contenham a query
  // Também inclui tabelas já encontradas no índice primário, pois o score de colunas
  // pode ser superior (ex: PPESSOA com score 5 no índice mas muitas colunas relevantes).
  // Pontua pela quantidade de colunas que corresponderam, com bônus quando
  // alguma coluna cobre TODAS as palavras da consulta (ex: DTNASCIMENTO
  // com GDIC "Data de Nascimento" para a query "Data de Nascimento").
  // O bônus é aplicado uma única vez por tabela (não por coluna) para evitar
  // beneficiar desproporcionalmente tabelas com muitas colunas repetitivas.
  const columnMatches = searchColumnInCache(rawWords, new Set()).map(t => {
    let score = t.matchedColumns?.length ?? 1;
    let hasConceptMatch = false;
    if (t.matchedColumns) {
      for (const col of t.matchedColumns) {
        const colDesc = col.description.toLowerCase();
        const colName = col.name.toLowerCase();
        // Verifica se esta coluna, combinando nome + descrição GDIC,
        // contém TODAS as palavras da consulta (match semântico forte)
        const combined = `${colName} ${colDesc}`;
        if (rawWords.every(w => combined.includes(w))) {
          hasConceptMatch = true;
          break;
        }
      }
    }
    // Bônus único quando existe coluna que representa exatamente o conceito
    // (nome+descrição contém todas as palavras da consulta)
    if (hasConceptMatch) {
      score += 20;
    }
    return { ...t, score };
  });

  // Mescla resultados: para cada tabela, usa o maior score entre primário e colunas
  const scoreMap = new Map<string, TableSummary>();
  for (const t of primaryMatches) {
    scoreMap.set(t.name, t);
  }
  for (const t of columnMatches) {
    const existing = scoreMap.get(t.name);
    if (!existing || (t.score ?? 0) > (existing.score ?? 0)) {
      scoreMap.set(t.name, t);
    }
  }

  // Ordena o resultado final por relevância (score desc)
  const combined = [...scoreMap.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return {
    total: combined.length,
    items: combined.slice(offset, offset + limit),
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
 * Utiliza cache LRU em memória com verificação de mtime.
 */
export function getTableDetail(tableName: string): TableDetail {
  const upper = tableName.toUpperCase();
  const filePath = join(DOCS_DIR, `${upper}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Documentação não encontrada para a tabela: ${upper}`);
  }

  return lruCachedGet(
    detailCache,
    upper,
    filePath,
    (path) => parseTableMarkdown(upper, readFileSync(path, 'utf-8')),
    DETAIL_CACHE_MAX,
  );
}

/**
 * Retorna o conteúdo raw (markdown) do arquivo de uma tabela.
 * Utiliza cache LRU em memória com verificação de mtime.
 */
export function getTableRawMarkdown(tableName: string): string {
  const upper = tableName.toUpperCase();
  const filePath = join(DOCS_DIR, `${upper}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Documentação não encontrada para a tabela: ${upper}`);
  }

  return lruCachedGet(
    rawMarkdownCache,
    upper,
    filePath,
    (path) => readFileSync(path, 'utf-8'),
    DETAIL_CACHE_MAX,
  );
}

/**
 * Retorna o conteúdo do arquivo de regras de uma tabela (<TABELA>.rules.md), ou null se não existir.
 * Utiliza cache LRU em memória com verificação de mtime.
 */
export function getTableRules(tableName: string): string | null {
  const upper = tableName.toUpperCase();
  const filePath = join(DOCS_DIR, `${upper}.rules.md`);
  if (!existsSync(filePath)) return null;

  return lruCachedGet(
    rulesContentCache,
    upper,
    filePath,
    (path) => readFileSync(path, 'utf-8'),
    RULES_CONTENT_CACHE_MAX,
  );
}

/**
 * Verifica se existe arquivo de regras para a tabela sem ler seu conteúdo.
 * Utiliza Set pré-carregado para evitar existsSync repetido.
 */
export function hasTableRules(tableName: string): boolean {
  if (!rulesTableSet) {
    rulesTableSet = new Set(
      existsSync(DOCS_DIR)
        ? readdirSync(DOCS_DIR)
            .filter(f => f.endsWith('.rules.md'))
            .map(f => f.replace(/\.rules\.md$/, ''))
        : []
    );
  }
  return rulesTableSet.has(tableName.toUpperCase());
}

/**
 * Retorna o conteúdo do db-index.md.
 * Utiliza cache em memória com verificação de mtime.
 */
export function getDbIndexMarkdown(): string {
  const stat = statSync(INDEX_FILE, { throwIfNoEntry: false });
  if (!stat) {
    throw new Error(`Arquivo de índice não encontrado: ${INDEX_FILE}`);
  }

  if (dbIndexCache && stat.mtimeMs <= dbIndexCache.mtime) {
    return dbIndexCache.value;
  }

  const content = readFileSync(INDEX_FILE, 'utf-8');
  dbIndexCache = { value: content, mtime: stat.mtimeMs };
  return content;
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
