import sql from 'mssql';

/** Configuração de conexão lida de variáveis de ambiente */
function buildConfig(): sql.config {
  const server = process.env.DB_SERVER ?? 'localhost';
  const port = parseInt(process.env.DB_PORT ?? '1433', 10);
  const database = process.env.DB_DATABASE ?? '';
  const user = process.env.DB_USER ?? '';
  const password = process.env.DB_PASSWORD ?? '';
  const trustCert = (process.env.DB_TRUST_CERT ?? 'true').toLowerCase() === 'true';
  const timeout = parseInt(process.env.DB_REQUEST_TIMEOUT ?? '30000', 10);

  if (!database) {
    throw new Error(
      'Variável de ambiente DB_DATABASE não definida. ' +
      'Configure: DB_SERVER, DB_PORT, DB_DATABASE, DB_USER, DB_PASSWORD.',
    );
  }

  const cfg: sql.config = {
    server,
    port,
    database,
    options: {
      trustServerCertificate: trustCert,
      enableArithAbort: true,
    },
    requestTimeout: timeout,
    connectionTimeout: 15000,
  };

  if (user) {
    cfg.user = user;
    cfg.password = password;
  } else {
    // Windows Authentication
    (cfg.options as Record<string, unknown>).trustedConnection = true;
  }

  return cfg;
}

let pool: sql.ConnectionPool | null = null;

/**
 * Retorna o pool de conexão reutilizável.
 * A primeira chamada abre a conexão.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;

  const cfg = buildConfig();
  pool = await new sql.ConnectionPool(cfg).connect();
  return pool;
}

/**
 * Tipo permitido para parâmetros de query.
 */
type QueryParam = string | number | boolean | Date | null;

/**
 * Executa uma query T-SQL parametrizada de LEITURA apenas.
 * Rejeita comandos DDL / DML (INSERT, UPDATE, DELETE, DROP, …).
 */
export async function executeQuery(
  tsql: string,
  params: Record<string, QueryParam> = {},
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number }> {
  assertReadOnly(tsql);

  const connection = await getPool();
  const request = connection.request();

  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      request.input(key, sql.NVarChar, null);
    } else if (typeof value === 'number') {
      request.input(key, Number.isInteger(value) ? sql.Int : sql.Float, value);
    } else if (typeof value === 'boolean') {
      request.input(key, sql.Bit, value);
    } else if (value instanceof Date) {
      request.input(key, sql.DateTime, value);
    } else {
      request.input(key, sql.NVarChar(sql.MAX), String(value));
    }
  }

  const result = await request.query(tsql);
  const recordset = result.recordset ?? [];

  const columns =
    recordset.length > 0
      ? Object.keys(recordset[0] as object)
      : [];

  return {
    columns,
    rows: recordset as Record<string, unknown>[],
    rowCount: recordset.length,
  };
}

/**
 * Valida que a query é apenas leitura.
 * Lança erro se detectar instruções destrutivas.
 */
function assertReadOnly(tsql: string): void {
  // Remove comentários de linha e blocos antes de checar
  const cleaned = tsql
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  const forbidden = [
    /\bINSERT\b/,
    /\bUPDATE\b/,
    /\bDELETE\b/,
    /\bDROP\b/,
    /\bTRUNCATE\b/,
    /\bALTER\b/,
    /\bCREATE\b/,
    /\bEXEC\b/,
    /\bEXECUTE\b/,
    /\bSP_EXECUTESQL\b/,
    /\bXP_\w+/,
    /\bBULK\b/,
    /\bMERGE\b/,
    /\bOPENROWSET\b/,
    /\bOPENDATASOURCE\b/,
  ];

  for (const re of forbidden) {
    if (re.test(cleaned)) {
      throw new Error(
        `Query rejeitada por segurança: instrução '${re.source.replace(/\\b|\\w\+/g, '').replace(/\\/g, '')}' não é permitida. ` +
        'Apenas consultas SELECT (leitura) são aceitas.',
      );
    }
  }
}

/** Fecha o pool de conexão (use ao encerrar o processo). */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}
