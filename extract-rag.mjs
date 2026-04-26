/**
 * Extrator RAG + Gerador de Índice — Banco de Dados EXEMPLO1212606
 * ================================================
 * 1. Extrai metadados em BATCH (4 queries totais) do SQL Server.
 * 2. Armazena tudo em cache SQLite — releituras não acessam o SQL Server.
 * 3. Gera .md por tabela e db-index.md consolidado a partir do cache.
 *
 * Uso:
 *   node extract-rag.mjs
 *   node extract-rag.mjs --tabela MANALISE          (uma tabela específica)
 *   node extract-rag.mjs --prefixo MA               (prefixo customizado)
 *   node extract-rag.mjs --output ./minha-pasta     (diretório de saída)
 *   node extract-rag.mjs --index  ./ai/db-index.md   (arquivo de índice)
 *   node extract-rag.mjs --sem-index                (pula geração do índice)
 *   node extract-rag.mjs --sem-cache                (ignora cache, re-extrai tudo)
 *   node extract-rag.mjs --so-md                    (regera .md do cache sem SQL Server)
 *   node extract-rag.mjs --so-index                 (regera apenas db-index.md do cache)
 *   node extract-rag.mjs --todas                    (extrai todas as tabelas, sem filtro de prefixo)
 *   node extract-rag.mjs --timeout 120000            (timeout de requisição SQL em ms, padrão: 120000)
 */

import sql from 'mssql';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/** Diretório onde este script está instalado (pasta do MCP). */
const __scriptDir = dirname(fileURLToPath(import.meta.url));

/** Resolve um caminho relativo à pasta do MCP, não ao cwd do projeto chamador. */
function mcpResolve(...parts) {
  return resolve(__scriptDir, ...parts);
}

// ─── Configurações ───────────────────────────────────────────────────────────

const CONFIG = {
  // ── Conexão SQL Server ──────────────────────────────────────────────────
  server:       'localhost',
  port:         1433,
  database:     'EXEMPLO1212606',
  user:         'rm',          // deixe vazio para usar Windows Auth
  password:     '??',
  trustServerCertificate: true,
  // ── Extração ────────────────────────────────────────────────────────────
  schema:       'dbo',
  tablePrefix:  'M',           // tabelas que começam com esta letra
  outputDir:    './docs/db/tables',
  maxTables:    9999,          // limite de segurança
  // ── Cache SQLite ─────────────────────────────────────────────────────────
  cacheDb:      './docs/db/cache.sqlite',
  usarCache:    true,          // false com --sem-cache
  soMd:         false,         // true com --so-md
  soIndex:      false,         // true com --so-index
  // ── Índice ──────────────────────────────────────────────────────────────
  indexFile:    './ai/db-index.md',
  gerarIndex:   true,          // false com --sem-index
  todasTabelas:    true,       // false com --prefixo
  requestTimeout:  300000,     // ms — aumentar se houver muitas tabelas
};

// ─── Parse de argumentos CLI ─────────────────────────────────────────────────

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tabela'    && args[i + 1]) { CONFIG.tablePrefix = args[++i]; CONFIG.exactTable = CONFIG.tablePrefix; }
  if (args[i] === '--prefixo'   && args[i + 1]) { CONFIG.tablePrefix = args[++i]; }
  if (args[i] === '--output'    && args[i + 1]) { CONFIG.outputDir   = args[++i]; }
  if (args[i] === '--server'    && args[i + 1]) { CONFIG.server      = args[++i]; }
  if (args[i] === '--database'  && args[i + 1]) { CONFIG.database    = args[++i]; }
  if (args[i] === '--usuario'   && args[i + 1]) { CONFIG.user        = args[++i]; }
  if (args[i] === '--senha'     && args[i + 1]) { CONFIG.password    = args[++i]; }
  if (args[i] === '--index'     && args[i + 1]) { CONFIG.indexFile   = args[++i]; }
  if (args[i] === '--sem-index')                { CONFIG.gerarIndex  = false; }
  if (args[i] === '--sem-cache')                { CONFIG.usarCache   = false; }
  if (args[i] === '--so-md')                    { CONFIG.soMd        = true;  }
  if (args[i] === '--so-index')                 { CONFIG.soIndex     = true;  }
  if (args[i] === '--todas')                    { CONFIG.todasTabelas    = true; }
  if (args[i] === '--timeout'  && args[i + 1])  { CONFIG.requestTimeout  = Number(args[++i]); }
}

// ─── Cache SQLite ─────────────────────────────────────────────────────────────

let db = null;

/** Abre (ou cria) o banco SQLite e garante o schema. */
function initSqlite() {
  const dbPath = mcpResolve(CONFIG.cacheDb);
  const dbDir  = dbPath.substring(0, Math.max(dbPath.lastIndexOf('/'), dbPath.lastIndexOf('\\')));
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tabelas (
      nome        TEXT PRIMARY KEY,
      descricao   TEXT DEFAULT '',
      extraido_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS colunas (
      tabela        TEXT    NOT NULL,
      ordinal       INTEGER NOT NULL,
      nome          TEXT    NOT NULL,
      data_type     TEXT,
      char_max_len  INTEGER,
      num_precision INTEGER,
      num_scale     INTEGER,
      is_nullable   TEXT,
      col_default   TEXT,
      gdic_descricao  TEXT,
      gdic_aplicacoes TEXT,
      gdic_apiname    TEXT,
      gdic_anonimizavel TEXT,
      is_pk         INTEGER DEFAULT 0,
      PRIMARY KEY (tabela, nome)
    );
    CREATE TABLE IF NOT EXISTS fks_saida (
      constraint_name TEXT NOT NULL,
      tabela          TEXT NOT NULL,
      coluna          TEXT NOT NULL,
      ord             INTEGER NOT NULL,
      ref_table       TEXT,
      ref_column      TEXT
    );
    CREATE TABLE IF NOT EXISTS fks_entrada (
      constraint_name TEXT NOT NULL,
      ref_table       TEXT NOT NULL,
      ref_column      TEXT NOT NULL,
      ord             INTEGER NOT NULL,
      tabela          TEXT NOT NULL,
      coluna          TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS modulos (
      codsistema TEXT PRIMARY KEY,
      descricao  TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_col_tab   ON colunas(tabela);
    CREATE INDEX IF NOT EXISTS idx_fkso_tab  ON fks_saida(tabela);
    CREATE INDEX IF NOT EXISTS idx_fkse_tab  ON fks_entrada(tabela);
  `);
}

/** Salva (upsert) os módulos do GSISTEMA no cache. */
function saveModulosToCache(rows) {
  const stmt = db.prepare('INSERT OR REPLACE INTO modulos VALUES (?, ?)');
  db.exec('BEGIN');
  try {
    for (const r of rows) stmt.run(toDb(r.CODSISTEMA), toDb(r.DESCRICAO) ?? '');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Retorna o Set de nomes de tabelas já presentes no cache. */
function getCachedTableNames() {
  return new Set(db.prepare('SELECT nome FROM tabelas').all().map(r => r.nome));
}

/** Converte valores de linhas do SQL Server para tipos compatíveis com node:sqlite. */
function toDb(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean')       return v ? 1 : 0;
  if (v instanceof Date)            return v.toISOString();
  if (typeof v === 'bigint')        return Number(v);
  if (typeof v === 'object')        return String(v);
  return v;
}

/** Salva (upsert) dados em batch numa única transação SQLite. */
function saveToCache(tableNames, allColumns, allDescs, allFksOut, allFksIn) {
  const today = new Date().toISOString().slice(0, 10);

  const byTable    = (arr, key) => arr.reduce((m, r) => { (m[r[key]] ??= []).push(r); return m; }, {});
  const colsMap    = byTable(allColumns, 'TABLE_NAME');
  const descsMap   = byTable(allDescs,   'TABELA');
  const fksOutMap  = byTable(allFksOut,  'TABELA');
  const fksInMap   = byTable(allFksIn,   'TABELA');

  const stmts = {
    upsertTabela:  db.prepare(`INSERT OR REPLACE INTO tabelas VALUES (?,?,?)`),
    upsertColuna:  db.prepare(`INSERT OR REPLACE INTO colunas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    delFksSaida:   db.prepare(`DELETE FROM fks_saida WHERE tabela = ?`),
    insFkSaida:    db.prepare(`INSERT INTO fks_saida VALUES (?,?,?,?,?,?)`),
    delFksEntrada: db.prepare(`DELETE FROM fks_entrada WHERE tabela = ?`),
    insFkEntrada:  db.prepare(`INSERT INTO fks_entrada VALUES (?,?,?,?,?,?)`),
  };

  db.exec('BEGIN');
  try {
    for (const t of tableNames) {
      const descricao = descsMap[t]?.[0]?.DESCRICAO ?? '';
      stmts.upsertTabela.run(t, descricao, today);

      for (const c of (colsMap[t] ?? [])) {
        stmts.upsertColuna.run(
          t,
          toDb(c.ORDINAL_POSITION), toDb(c.COLUMN_NAME), toDb(c.DATA_TYPE),
          toDb(c.CHARACTER_MAXIMUM_LENGTH), toDb(c.NUMERIC_PRECISION), toDb(c.NUMERIC_SCALE),
          toDb(c.IS_NULLABLE), toDb(c.COLUMN_DEFAULT),
          toDb(c.GDIC_DESCRICAO), toDb(c.GDIC_APLICACOES), toDb(c.GDIC_APINAME), toDb(c.GDIC_ANONIMIZAVEL),
          toDb(c.IS_PK),
        );
      }

      stmts.delFksSaida.run(t);
      for (const fk of (fksOutMap[t] ?? [])) {
        stmts.insFkSaida.run(fk.CONSTRAINT_NAME, t, fk.COLUMN_NAME, fk.ORD, fk.REF_TABLE, fk.REF_COLUMN);
      }

      stmts.delFksEntrada.run(t);
      for (const fk of (fksInMap[t] ?? [])) {
        stmts.insFkEntrada.run(fk.CONSTRAINT_NAME, fk.REF_TABLE, fk.REF_COLUMN, fk.ORD, t, fk.COLUMN_NAME);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Retorna todos os nomes de tabelas no cache, ordenados. */
function loadAllTablesFromCache() {
  return db.prepare('SELECT nome FROM tabelas ORDER BY nome').all().map(r => r.nome);
}

// ─── Conexão SQL Server ───────────────────────────────────────────────────────

let pool = null;

async function initSession() {
  const useWindowsAuth = !CONFIG.user;
  pool = await sql.connect({
    server:   CONFIG.server,
    port:     CONFIG.port,
    database: CONFIG.database,
    requestTimeout: CONFIG.requestTimeout,
    options: {
      trustServerCertificate: CONFIG.trustServerCertificate,
      enableArithAbort:       true,
      ...(useWindowsAuth ? { trustedConnection: true } : {}),
    },
    ...(useWindowsAuth ? {} : { user: CONFIG.user, password: CONFIG.password }),
  });
}

async function executeSQL(query) {
  const result = await pool.request().query(query);
  return { rows: result.recordset };
}

// ─── Lógica Principal ─────────────────────────────────────────────────────────

async function main() {
  const startTime  = Date.now();
  const outputPath = mcpResolve(CONFIG.outputDir);

  console.log('═══════════════════════════════════════════════════');
  console.log('  Extrator RAG — Banco de Dados ' + CONFIG.database);
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Servidor  : ${CONFIG.server}:${CONFIG.port}`);
  console.log(`  Banco     : ${CONFIG.database}`);
  console.log(`  Auth      : ${CONFIG.user ? CONFIG.user : 'Windows Auth'}`);
  console.log(`  Prefixo   : ${CONFIG.todasTabelas ? '(todas as tabelas)' : CONFIG.tablePrefix + '%'}`);
  console.log(`  Saída     : ${outputPath}`);
  console.log(`  Cache     : ${mcpResolve(CONFIG.cacheDb)}`);
  console.log('───────────────────────────────────────────────────\n');

  // 1. Abre o cache SQLite
  initSqlite();

  // ── Modo: só INDEX (sem SQL Server, sem gerar .md) ─────────────────────
  if (CONFIG.soIndex) {
    await runGenerateIndex();
    db.close();
    limparCache();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Tempo total de processamento: ${elapsed}s`);
    return;
  }

  // ── Modo: só .md (sem SQL Server) ──────────────────────────────────────
  if (CONFIG.soMd) {
    const names = loadAllTablesFromCache();
    if (names.length === 0) {
      console.error('Cache vazio. Execute sem --so-md para popular o cache primeiro.');
      db.close();
      limparCache();
      process.exit(1);
    }
    gerarMdDaCache(outputPath, names);
    if (CONFIG.gerarIndex) await runGenerateIndex();
    db.close();
    limparCache();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Tempo total de processamento: ${elapsed}s`);
    return;
  }

  // 2. Conecta ao SQL Server
  process.stdout.write('Conectando ao SQL Server... ');
  await initSession();
  console.log('OK');

  // 2b. Busca módulos do GSISTEMA e salva no cache
  process.stdout.write('Buscando módulos GSISTEMA...   ');
  try {
    const { rows: modulosRows } = await executeSQL('SELECT CODSISTEMA, DESCRICAO FROM GSISTEMA ORDER BY CODSISTEMA');
    saveModulosToCache(modulosRows);
    console.log(`${modulosRows.length} módulo(s)`);
  } catch {
    console.log('(tabela GSISTEMA não encontrada — ignorado)');
  }

  // 3. Cria diretório de saída
  if (!existsSync(outputPath)) {
    mkdirSync(outputPath, { recursive: true });
    console.log(`Diretório criado: ${outputPath}`);
  }

  // 4. Lista tabelas
  const buscaLabel = CONFIG.todasTabelas ? '(todas)' : `"${CONFIG.tablePrefix}%"`;
  process.stdout.write(`\nBuscando tabelas ${buscaLabel}... `);

  const whereClause = CONFIG.exactTable
    ? `TABLE_NAME = '${escapeSql(CONFIG.exactTable)}'`
    : CONFIG.todasTabelas
      ? `1=1`
      : `TABLE_NAME LIKE '${escapeSql(CONFIG.tablePrefix)}%'`;

  const { rows: tableRows } = await executeSQL(`
    SELECT TABLE_NAME
    FROM   INFORMATION_SCHEMA.TABLES
    WHERE  TABLE_TYPE   = 'BASE TABLE'
      AND  TABLE_SCHEMA = '${CONFIG.schema}'
      AND  ${whereClause}
    ORDER BY TABLE_NAME
  `);

  const allTables = tableRows.map(r => r.TABLE_NAME).slice(0, CONFIG.maxTables);
  console.log(`${allTables.length} tabela(s) encontrada(s).`);

  if (allTables.length === 0) {
    console.log('Nenhuma tabela encontrada. Verifique o prefixo ou o schema.');
    await sql.close();
    return;
  }

  // 5. Separa tabelas em cache vs. a extrair do SQL Server
  let tablesToFetch = allTables;
  if (CONFIG.usarCache) {
    const cached = getCachedTableNames();
    tablesToFetch = allTables.filter(t => !cached.has(t));
    const fromCache = allTables.length - tablesToFetch.length;
    if (fromCache > 0) {
      console.log(`  → ${fromCache} tabela(s) já em cache | ${tablesToFetch.length} a extrair do SQL Server`);
    }
  }

  // 6. Extrai em batch (4 queries totais) e salva no SQLite
  if (tablesToFetch.length > 0) {
    await batchFetchAndSave(tablesToFetch);
  } else {
    console.log('Todas as tabelas já estão no cache SQLite.\n');
  }

  await sql.close();

  // 7. Gera arquivos .md a partir do cache
  const { ok, erros } = gerarMdDaCache(outputPath, allTables);

  console.log('\n───────────────────────────────────────────────────');
  console.log(`  Concluído!  OK: ${ok}  |  Erros: ${erros}`);
  console.log(`  Arquivos .md salvos em: ${outputPath}`);
  console.log('═══════════════════════════════════════════════════\n');

  // 8. Gera db-index.md a partir do cache
  if (CONFIG.gerarIndex) {
    await runGenerateIndex();
  }

  db.close();
  limparCache();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Tempo total de processamento: ${elapsed}s`);
}

// ─── Extração em Batch (4 queries totais no SQL Server) ──────────────────────

async function batchFetchAndSave(tables) {
  const inClause = tables.map(t => `'${escapeSql(t)}'`).join(',');

  console.log(`\nExtraindo metadados de ${tables.length} tabela(s) em 4 queries batch...`);

  // Query 1 — Colunas + GDIC de todas as tabelas em uma só query
  process.stdout.write('  [1/4] Colunas + GDIC...     ');
  const { rows: allColumns } = await executeSQL(`
    SELECT
      c.TABLE_NAME,
      c.ORDINAL_POSITION,
      c.COLUMN_NAME,
      c.DATA_TYPE,
      c.CHARACTER_MAXIMUM_LENGTH,
      c.NUMERIC_PRECISION,
      c.NUMERIC_SCALE,
      c.IS_NULLABLE,
      c.COLUMN_DEFAULT,
      g.DESCRICAO     AS GDIC_DESCRICAO,
      g.APLICACOES    AS GDIC_APLICACOES,
      g.APINAME       AS GDIC_APINAME,
      g.ANONIMIZAVEL  AS GDIC_ANONIMIZAVEL,
      CASE WHEN pk.TABLE_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
    FROM INFORMATION_SCHEMA.COLUMNS c
    JOIN GDIC g
      ON  g.TABELA = c.TABLE_NAME
      AND g.COLUNA = c.COLUMN_NAME
    LEFT JOIN (
      SELECT tc.TABLE_NAME, ku.COLUMN_NAME
      FROM   INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN   INFORMATION_SCHEMA.KEY_COLUMN_USAGE  ku
             ON  ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
             AND ku.TABLE_NAME      = tc.TABLE_NAME
      WHERE  tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        AND  tc.TABLE_SCHEMA    = '${CONFIG.schema}'
        AND  tc.TABLE_NAME      IN (${inClause})
    ) pk ON pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
    WHERE c.TABLE_SCHEMA = '${CONFIG.schema}'
      AND c.TABLE_NAME   IN (${inClause})
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
  `);
  console.log(`${allColumns.length} linhas`);

  // Query 2 — Descrições de tabela (GDIC COLUNA = '#')
  process.stdout.write('  [2/4] Descrições GDIC...    ');
  const { rows: allDescs } = await executeSQL(`
    SELECT TABELA, DESCRICAO, APLICACOES
    FROM   GDIC
    WHERE  COLUNA = '#'
      AND  TABELA IN (${inClause})
  `);
  console.log(`${allDescs.length} linhas`);

  // Query 3 — FKs de saída (estas tabelas → outras)
  process.stdout.write('  [3/4] FKs de saída...       ');
  let allFksOut = [];
  try {
    const { rows } = await executeSQL(`
      SELECT
        rc.CONSTRAINT_NAME,
        fkc.TABLE_NAME         AS TABELA,
        kcu1.COLUMN_NAME       AS COLUMN_NAME,
        kcu1.ORDINAL_POSITION  AS ORD,
        kcu2.TABLE_NAME        AS REF_TABLE,
        kcu2.COLUMN_NAME       AS REF_COLUMN
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS fkc
           ON  fkc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
           AND fkc.TABLE_SCHEMA    = '${CONFIG.schema}'
           AND fkc.TABLE_NAME      IN (${inClause})
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu1
           ON  kcu1.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
           AND kcu1.TABLE_NAME      = fkc.TABLE_NAME
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
           ON  kcu2.CONSTRAINT_NAME   = rc.UNIQUE_CONSTRAINT_NAME
           AND kcu2.ORDINAL_POSITION  = kcu1.ORDINAL_POSITION
      ORDER BY fkc.TABLE_NAME, rc.CONSTRAINT_NAME, kcu1.ORDINAL_POSITION
    `);
    allFksOut = rows;
  } catch { /* banco pode não ter FKs */ }
  console.log(`${allFksOut.length} linhas`);

  // Query 4 — FKs de entrada (outras tabelas → estas)
  process.stdout.write('  [4/4] FKs de entrada...     ');
  let allFksIn = [];
  try {
    const { rows } = await executeSQL(`
      SELECT
        rc.CONSTRAINT_NAME,
        fkc.TABLE_NAME         AS REF_TABLE,
        kcu1.COLUMN_NAME       AS REF_COLUMN,
        kcu1.ORDINAL_POSITION  AS ORD,
        kcu2.TABLE_NAME        AS TABELA,
        kcu2.COLUMN_NAME       AS COLUMN_NAME
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS fkc
           ON  fkc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
           AND fkc.TABLE_SCHEMA    = '${CONFIG.schema}'
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu1
           ON  kcu1.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
           AND kcu1.TABLE_NAME      = fkc.TABLE_NAME
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
           ON  kcu2.CONSTRAINT_NAME  = rc.UNIQUE_CONSTRAINT_NAME
           AND kcu2.TABLE_NAME       IN (${inClause})
           AND kcu2.ORDINAL_POSITION = kcu1.ORDINAL_POSITION
      ORDER BY kcu2.TABLE_NAME, rc.CONSTRAINT_NAME, kcu1.ORDINAL_POSITION
    `);
    allFksIn = rows;
  } catch { /* silencioso */ }
  console.log(`${allFksIn.length} linhas`);

  process.stdout.write('  Salvando no cache SQLite... ');
  saveToCache(tables, allColumns, allDescs, allFksOut, allFksIn);
  console.log('OK\n');
}

// ─── Gera arquivos .md a partir do cache SQLite ───────────────────────────────

function gerarMdDaCache(outputPath, tableNames) {
  if (!existsSync(outputPath)) mkdirSync(outputPath, { recursive: true });

  const stmtTab    = db.prepare(`SELECT * FROM tabelas WHERE nome = ?`);
  const stmtCols   = db.prepare(`SELECT * FROM colunas WHERE tabela = ? ORDER BY ordinal`);
  const stmtFksOut = db.prepare(`
    SELECT constraint_name AS CONSTRAINT_NAME, tabela AS TABELA,
           coluna AS COLUMN_NAME, ord AS ORD, ref_table AS REF_TABLE, ref_column AS REF_COLUMN
    FROM fks_saida WHERE tabela = ? ORDER BY constraint_name, ord`);
  const stmtFksIn  = db.prepare(`
    SELECT constraint_name AS CONSTRAINT_NAME, ref_table AS REF_TABLE,
           ref_column AS REF_COLUMN, ord AS ORD, tabela AS TABELA, coluna AS COLUMN_NAME
    FROM fks_entrada WHERE tabela = ? ORDER BY ref_table, constraint_name, ord`);

  console.log(`Gerando ${tableNames.length} arquivo(s) .md do cache...`);

  let ok = 0, erros = 0;
  for (let i = 0; i < tableNames.length; i++) {
    const tableName = tableNames[i];
    const progress  = `[${String(i + 1).padStart(String(tableNames.length).length)}/${tableNames.length}]`;
    process.stdout.write(`${progress} ${tableName.padEnd(40)} `);

    try {
      const tbl    = stmtTab.get(tableName);

      // Tabelas sem descrição no dicionário de dados (GDIC) são ignoradas
      if (!tbl?.descricao) {
        console.log(`—  (sem descrição no GDIC, ignorada)`);
        continue;
      }

      const cols   = stmtCols.all(tableName);
      const fksOut = stmtFksOut.all(tableName);
      const fksIn  = stmtFksIn.all(tableName);

      // Adapta nomes snake_case do SQLite para o formato esperado por generateMarkdown
      const columns = cols.map(c => ({
        ORDINAL_POSITION:         c.ordinal,
        COLUMN_NAME:              c.nome,
        DATA_TYPE:                c.data_type,
        CHARACTER_MAXIMUM_LENGTH: c.char_max_len,
        NUMERIC_PRECISION:        c.num_precision,
        NUMERIC_SCALE:            c.num_scale,
        IS_NULLABLE:              c.is_nullable,
        COLUMN_DEFAULT:           c.col_default,
        GDIC_DESCRICAO:           c.gdic_descricao,
        GDIC_APLICACOES:          c.gdic_aplicacoes,
        GDIC_APINAME:             c.gdic_apiname,
        GDIC_ANONIMIZAVEL:        c.gdic_anonimizavel,
        IS_PK:                    c.is_pk,
      }));

      const markdown = generateMarkdown(tableName, tbl?.descricao ?? '', columns, fksOut, fksIn);
      writeFileSync(join(outputPath, `${tableName}.md`), markdown, 'utf-8');
      console.log(`✓  (${columns.length} colunas, ${fksOut.length + fksIn.length} relações)`);
      ok++;
    } catch (err) {
      console.log(`✗  ERRO: ${err.message}`);
      erros++;
    }
  }

  return { ok, erros };
}

// ─── Geração de Markdown ─────────────────────────────────────────────────────

function generateMarkdown(tableName, tableDesc, columns, fksOut = [], fksIn = []) {
  const pkCols    = columns.filter(c => c.IS_PK    ).map(c => c.COLUMN_NAME);
  const withDesc  = columns.filter(c => c.GDIC_DESCRICAO);
  const semDesc   = columns.filter(c => !c.GDIC_DESCRICAO).length;
  const today     = new Date().toISOString().slice(0, 10);

  const lines = [];

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  lines.push(`# ${tableName}`);
  lines.push('');

  // ── Descrição ─────────────────────────────────────────────────────────────
  lines.push('## Descrição');
  lines.push('');
  if (tableDesc) {
    lines.push(tableDesc.trim());
  } else {
    lines.push(`> Tabela \`${tableName}\` do banco **${CONFIG.database}**. Sem descrição registrada no dicionário de dados (GDIC).`);
  }
  lines.push('');

  // ── Metadados ─────────────────────────────────────────────────────────────
  lines.push('## Metadados');
  lines.push('');
  lines.push('| Atributo | Valor |');
  lines.push('|---|---|');
  if (pkCols.length > 0) {
    lines.push(`| Chave primária | ${pkCols.map(k => `\`${k}\``).join(', ')} |`);
  }
  // Agrupa FKs de saída por constraint para exibir no metadados
  const fkOutGroups = groupByConstraint(fksOut);
  const fkInTables  = [...new Set(fksIn.map(r => r.REF_TABLE))];
  if (fkOutGroups.length > 0) {
    lines.push(`| Referencia (FK saída) | ${fkOutGroups.map(g => `\`${g.refTable}\``).join(', ')} |`);
  }
  if (fkInTables.length > 0) {
    lines.push(`| Referenciada por (FK entrada) | ${fkInTables.map(t => `\`${t}\``).join(', ')} |`);
  }
  lines.push('');

  // ── Colunas (tabela resumida) ─────────────────────────────────────────────
  lines.push('## Colunas');
  lines.push('');
  lines.push('| # | Coluna | Tipo | Nulável | PK | Descrição (GDIC) |');
  lines.push('|---|--------|------|---------|:--:|-----------------|');

  for (const col of columns) {
    const tipo     = formatType(col);
    const nullable = col.IS_NULLABLE === 'YES' ? 'Sim' : 'Não';
    const pk       = col.IS_PK ? '✓' : '';
    const desc     = col.GDIC_DESCRICAO
      ? col.GDIC_DESCRICAO.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
      : '—';
    lines.push(`| ${col.ORDINAL_POSITION} | \`${col.COLUMN_NAME}\` | \`${tipo}\` | ${nullable} | ${pk} | ${desc} |`);
  }
  lines.push('');

  // ── Relacionamentos ───────────────────────────────────────────────────────
  if (fksOut.length > 0 || fksIn.length > 0) {
    lines.push('## Relacionamentos');
    lines.push('');

    if (fksOut.length > 0) {
      lines.push('### Chaves Estrangeiras de Saída (esta tabela → outras)');
      lines.push('');
      lines.push('| Constraint | Coluna(s) | Tabela Referenciada | Coluna(s) Referenciada(s) |');
      lines.push('|---|---|---|---|');
      for (const g of groupByConstraint(fksOut)) {
        const cols    = g.rows.map(r => `\`${r.COLUMN_NAME}\``).join(', ');
        const refCols = g.rows.map(r => `\`${r.REF_COLUMN}\``).join(', ');
        lines.push(`| \`${g.constraintName}\` | ${cols} | \`${g.refTable}\` | ${refCols} |`);
      }
      lines.push('');
    }

    if (fksIn.length > 0) {
      lines.push('### Chaves Estrangeiras de Entrada (outras tabelas → esta)');
      lines.push('');
      lines.push('| Constraint | Tabela Referenciando | Coluna(s) | Coluna(s) desta Tabela |');
      lines.push('|---|---|---|---|');
      for (const g of groupByConstraint(fksIn, 'REF_TABLE', 'REF_COLUMN', 'COLUMN_NAME')) {
        const refCols  = g.rows.map(r => `\`${r.REF_COLUMN}\``).join(', ');
        const thisCols = g.rows.map(r => `\`${r.COLUMN_NAME}\``).join(', ');
        lines.push(`| \`${g.constraintName}\` | \`${g.refTable}\` | ${refCols} | ${thisCols} |`);
      }
      lines.push('');
    }
  }

  // ── Rodapé ────────────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push(`*Gerado automaticamente em ${today} — Banco: ${CONFIG.database}*`);
  lines.push('');

  return lines.join('\n');
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

function groupByConstraint(rows, refTableKey = 'REF_TABLE', refColKey = 'REF_COLUMN', thisColKey = 'COLUMN_NAME') {
  const map = new Map();
  for (const row of rows) {
    const key = row.CONSTRAINT_NAME;
    if (!map.has(key)) {
      map.set(key, { constraintName: key, refTable: row[refTableKey], rows: [] });
    }
    map.get(key).rows.push(row);
  }
  return [...map.values()];
}

function formatType(col) {
  const type = (col.DATA_TYPE ?? 'UNKNOWN').toUpperCase();
  if (col.CHARACTER_MAXIMUM_LENGTH != null) {
    const len = col.CHARACTER_MAXIMUM_LENGTH === -1 ? 'MAX' : col.CHARACTER_MAXIMUM_LENGTH;
    return `${type}(${len})`;
  }
  if (col.NUMERIC_PRECISION != null && col.NUMERIC_SCALE != null && col.NUMERIC_SCALE > 0) {
    return `${type}(${col.NUMERIC_PRECISION},${col.NUMERIC_SCALE})`;
  }
  if (col.NUMERIC_PRECISION != null) {
    return `${type}(${col.NUMERIC_PRECISION})`;
  }
  return type;
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

// ─── Gerador de Índice RAG ────────────────────────────────────────────────────

/**
 * Gera o conteúdo do db-index.md e salva no arquivo de saída.
 * `tables`  = array de { name, descricao, totalColunas, colsComDesc, pkCols,
 *                         columns: [{name, type, isPk, desc}] }
 * `modulos` = array de { codsistema, descricao } — conteúdo da tabela GSISTEMA
 */
function generateIndex(tables, modulos, outputFile) {
  const today  = new Date().toISOString().slice(0, 10);
  const lines  = [];

  lines.push(`# Índice RAG — Banco de Dados ERP TOTVS - Linha RM`);
  lines.push('');
  lines.push(
    `Este documento é o **índice central** do RAG local. ` +
    `Contém metadados de **${tables.length} tabelas**, ` +
    `organizadas por nome da tabela e com descrição. ` +
    `Para detalhes completos de uma tabela, consulte o arquivo \`docs/db/tables/<NOME>.md\`.`
  );
  lines.push('');

  lines.push('## Como usar este índice (instrução para IA)');
  lines.push('');
  lines.push('1. Use este índice para localizar qual tabela contém os dados desejados.');
  lines.push('2. Identifique o nome da tabela pelo resumo e descrição.');
  lines.push('3. Consulte a seção **Módulos do Sistema** para entender o prefixo de cada tabela.');
  lines.push('4. Acesse o arquivo `docs/db/tables/<NOME_TABELA>.md` para o dicionário detalhado.');
  lines.push('5. Colunas com `(GDIC)` possuem descrição semântica do dicionário de dados.');
  lines.push('');

  if (modulos.length > 0) {
    lines.push('## Módulos do Sistema (GSISTEMA)');
    lines.push('');
    lines.push('> Cada tabela é prefixada com o código do módulo ao qual pertence.');
    lines.push('');
    lines.push('| Prefixo tabelas | Módulo |');
    lines.push('|-----------------|--------------------|');
    for (const m of modulos) {
      lines.push(`| \`${m.codsistema}\` | ${m.descricao} |`);
    }
    lines.push('');
  }

  lines.push('## Índice Completo de Tabelas');
  lines.push('');
  lines.push('> Tabela rápida para identificação. Para detalhes, acesse o arquivo `.md` da tabela.');
  lines.push('');
  lines.push('| Tabela | Descrição Resumida |');
  lines.push('|--------|-------------------|');
  for (const t of tables) {
    const desc = t.descricao || '*(sem descrição no GDIC)*';
    lines.push(`| [\`${t.name}\`](../docs/db/tables/${t.name}.md) | ${desc} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(`*Índice gerado automaticamente em ${today}. Banco: \`${CONFIG.database}\` — ${tables.length} tabelas.*`);
  lines.push('');

  const outDir = outputFile.substring(0, Math.max(outputFile.lastIndexOf('/'), outputFile.lastIndexOf('\\')));
  if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outputFile, lines.join('\n'), 'utf-8');
  return lines.length;
}

/**
 * Extrai a descrição de um arquivo .md de tabela lendo a seção "## Descrição".
 */
function extrairDescricaoMd(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const match   = content.match(/##\s+Descri[çc][aã]o\s*\n+([^\n#][^\n]*)/);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * Lê o cache SQLite e gera o db-index.md.
 * Também considera todos os arquivos .md em docs/db/tables que não estejam no cache.
 */
async function runGenerateIndex() {
  const outputFile = mcpResolve(CONFIG.indexFile);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Gerando Índice RAG (do cache SQLite + arquivos .md)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Saída : ${outputFile}`);
  console.log('───────────────────────────────────────────────────\n');

  const tableNames = db.prepare('SELECT nome FROM tabelas ORDER BY nome').all().map(r => r.nome);

  console.log(`Carregando ${tableNames.length} tabela(s) do cache...`);

  const stmtCols = db.prepare('SELECT * FROM colunas WHERE tabela = ? ORDER BY ordinal');
  const stmtTab  = db.prepare('SELECT * FROM tabelas WHERE nome = ?');

  const tables = tableNames.map(name => {
    const tbl  = stmtTab.get(name);
    const cols = stmtCols.all(name);

    const pkCols     = cols.filter(c => c.is_pk).map(c => c.nome);
    const colsComDesc = cols.filter(c => c.gdic_descricao).length;
    let descricao    = tbl?.descricao ?? '';
    if (descricao.length > 180) descricao = descricao.slice(0, 177) + '...';

    return {
      name,
      descricao,
      totalColunas: cols.length,
      colsComDesc,
      pkCols,
      columns: cols.map(c => ({
        name:  c.nome,
        type:  formatType({
          DATA_TYPE:                c.data_type,
          CHARACTER_MAXIMUM_LENGTH: c.char_max_len,
          NUMERIC_PRECISION:        c.num_precision,
          NUMERIC_SCALE:            c.num_scale,
        }),
        isPk:  c.is_pk === 1,
        desc:  c.gdic_descricao ?? '',
      })),
    };
  });

  // Complementa com arquivos .md que não estão no cache
  const tablesDir   = mcpResolve(CONFIG.outputDir);
  const cachedNames = new Set(tableNames);
  let mdExtras      = 0;

  if (existsSync(tablesDir)) {
    const mdFiles = readdirSync(tablesDir).filter(f => f.endsWith('.md'));
    for (const file of mdFiles) {
      const name = file.slice(0, -3).toUpperCase();
      if (!cachedNames.has(name)) {
        const descricao = extrairDescricaoMd(join(tablesDir, file));
        tables.push({ name, descricao, totalColunas: 0, colsComDesc: 0, pkCols: [], columns: [] });
        mdExtras++;
      }
    }
  }

  if (mdExtras > 0) {
    tables.sort((a, b) => a.name.localeCompare(b.name));
    console.log(`  + ${mdExtras} tabela(s) incluída(s) somente via arquivo .md`);
  }

  if (tables.length === 0) {
    console.warn('Nenhuma tabela encontrada (cache vazio e nenhum .md em docs/db/tables).');
    return;
  }

  const modulos = db.prepare('SELECT codsistema, descricao FROM modulos ORDER BY codsistema').all();

  console.log('Gravando db-index.md...');
  const lineCount = generateIndex(tables, modulos, outputFile);
  const sizeKB    = Math.round(statSync(outputFile).size / 1024);

  console.log('\n───────────────────────────────────────────────────');
  console.log(`  ✓ db-index.md gerado!`);
  console.log(`    Tabelas indexadas : ${tables.length}`);
  console.log(`    Linhas geradas    : ${lineCount}`);
  console.log(`    Tamanho           : ${sizeKB} KB`);
  console.log(`    Arquivo           : ${outputFile}`);
  console.log('═══════════════════════════════════════════════════\n');
}

// ─── Utilitários de encerramento ────────────────────────────────────────────

function limparCache() {
  const dbPath = mcpResolve(CONFIG.cacheDb);
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
    console.log(`  Cache SQLite removido: ${dbPath}`);
  }
}

// ─── Executa ─────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\n[ERRO FATAL]', err.message);
  process.exit(1);
});
