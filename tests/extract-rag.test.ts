import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// ─── Mocks de dependências ───────────────────────────────────────────────────

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...(actual as object),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock('node:sqlite', () => {
  const mockStmt = {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(() => []),
  };
  const mockDb = {
    exec: vi.fn(),
    prepare: vi.fn(() => mockStmt),
    close: vi.fn(),
  };
  return { DatabaseSync: vi.fn(() => mockDb) };
});

vi.mock('mssql', () => ({
  default: {
    connect: vi.fn().mockResolvedValue({ request: vi.fn() }),
    close: vi.fn().mockResolvedValue(undefined),
  },
  connect: vi.fn().mockResolvedValue({ request: vi.fn() }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cria uma coluna fake para generateMarkdown */
function col(overrides: Record<string, unknown> = {}) {
  return {
    ORDINAL_POSITION: 1,
    COLUMN_NAME: 'CODTEST',
    DATA_TYPE: 'INT',
    CHARACTER_MAXIMUM_LENGTH: null,
    NUMERIC_PRECISION: null,
    NUMERIC_SCALE: null,
    IS_NULLABLE: 'NO',
    COLUMN_DEFAULT: null,
    GDIC_DESCRICAO: 'Código de teste',
    GDIC_APLICACOES: null,
    GDIC_APINAME: null,
    GDIC_ANONIMIZAVEL: null,
    IS_PK: 1,
    ...overrides,
  };
}

/** Cria uma FK fake para generateMarkdown */
function fk(overrides: Record<string, unknown> = {}) {
  return {
    CONSTRAINT_NAME: 'FK_TESTE',
    COLUMN_NAME: 'CODTEST',
    ORD: 1,
    REF_TABLE: 'FOUTRA',
    REF_COLUMN: 'CODOUTRA',
    ...overrides,
  };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('extract-rag — utilitários', () => {
  let mod: typeof import('../extract-rag.mjs');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Configura mocks fs padrão
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ size: 1024, mtimeMs: Date.now(), isFile: () => true });
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');

    mod = await import('../extract-rag.mjs');
  });

  // ── toDb ─────────────────────────────────────────────────────────────────

  describe('toDb', () => {
    it('deve converter null/undefined para null', () => {
      expect(mod.toDb(null)).toBeNull();
      expect(mod.toDb(undefined)).toBeNull();
    });

    it('deve converter boolean para 0/1', () => {
      expect(mod.toDb(true)).toBe(1);
      expect(mod.toDb(false)).toBe(0);
    });

    it('deve converter Date para ISO string', () => {
      const d = new Date('2026-01-15T10:30:00Z');
      expect(mod.toDb(d)).toBe('2026-01-15T10:30:00.000Z');
    });

    it('deve converter objeto para string', () => {
      expect(mod.toDb({ foo: 'bar' })).toBe('[object Object]');
    });

    it('deve passar valores primitivos inalterados', () => {
      expect(mod.toDb(42)).toBe(42);
      expect(mod.toDb('texto')).toBe('texto');
    });
  });

  // ── escapeSql ────────────────────────────────────────────────────────────

  describe('escapeSql', () => {
    it('deve escapar aspas simples', () => {
      expect(mod.escapeSql("O'Brian")).toBe("O''Brian");
    });

    it('deve retornar string sem aspas inalterada', () => {
      expect(mod.escapeSql('normal')).toBe('normal');
    });

    it('deve converter número para string', () => {
      expect(mod.escapeSql(123)).toBe('123');
    });
  });

  // ── escapeIdentifier ─────────────────────────────────────────────────────

  describe('escapeIdentifier', () => {
    it('deve envolver nome válido em colchetes', () => {
      expect(mod.escapeIdentifier('PFUNC')).toBe('[PFUNC]');
    });

    it('deve aceitar underscore', () => {
      expect(mod.escapeIdentifier('_temp')).toBe('[_temp]');
    });

    it('deve rejeitar identificador com espaço', () => {
      expect(() => mod.escapeIdentifier('minha tabela')).toThrow('Identificador SQL inválido');
    });

    it('deve rejeitar string vazia', () => {
      expect(() => mod.escapeIdentifier('')).toThrow('Identificador SQL inválido');
    });
  });

  // ── formatType ───────────────────────────────────────────────────────────

  describe('formatType', () => {
    it('deve formatar tipo simples', () => {
      expect(mod.formatType({ DATA_TYPE: 'INT' })).toBe('INT');
    });

    it('deve formatar VARCHAR com tamanho', () => {
      expect(mod.formatType({ DATA_TYPE: 'VARCHAR', CHARACTER_MAXIMUM_LENGTH: 200 })).toBe('VARCHAR(200)');
    });

    it('deve formatar VARCHAR(MAX)', () => {
      expect(mod.formatType({ DATA_TYPE: 'VARCHAR', CHARACTER_MAXIMUM_LENGTH: -1 })).toBe('VARCHAR(MAX)');
    });

    it('deve formatar DECIMAL com precisão e escala', () => {
      expect(mod.formatType({ DATA_TYPE: 'DECIMAL', NUMERIC_PRECISION: 18, NUMERIC_SCALE: 2 })).toBe('DECIMAL(18,2)');
    });

    it('deve formatar tipo com precisão sem escala', () => {
      expect(mod.formatType({ DATA_TYPE: 'NUMERIC', NUMERIC_PRECISION: 10, NUMERIC_SCALE: 0 })).toBe('NUMERIC(10)');
    });

    it('deve retornar UNKNOWN quando DATA_TYPE é null/undefined', () => {
      expect(mod.formatType({})).toBe('UNKNOWN');
    });
  });

  // ── groupByConstraint ────────────────────────────────────────────────────

  describe('groupByConstraint', () => {
    it('deve agrupar linhas pelo nome da constraint', () => {
      const rows = [
        { CONSTRAINT_NAME: 'FK_A', COLUMN_NAME: 'COL1', REF_TABLE: 'T1', REF_COLUMN: 'RC1' },
        { CONSTRAINT_NAME: 'FK_A', COLUMN_NAME: 'COL2', REF_TABLE: 'T1', REF_COLUMN: 'RC2' },
        { CONSTRAINT_NAME: 'FK_B', COLUMN_NAME: 'COL3', REF_TABLE: 'T2', REF_COLUMN: 'RC3' },
      ];
      const result = mod.groupByConstraint(rows);
      expect(result).toHaveLength(2);
      expect(result[0].constraintName).toBe('FK_A');
      expect(result[0].rows).toHaveLength(2);
      expect(result[1].constraintName).toBe('FK_B');
      expect(result[1].rows).toHaveLength(1);
    });

    it('deve retornar array vazio para entrada vazia', () => {
      expect(mod.groupByConstraint([])).toEqual([]);
    });

    it('deve usar chaves personalizadas', () => {
      const rows = [
        { nome: 'GRUPO1', valor: 'A' },
        { nome: 'GRUPO1', valor: 'B' },
      ];
      const result = mod.groupByConstraint(rows, 'nome', 'valor', 'valor');
      expect(result).toHaveLength(1);
    });
  });

  // ── filtrarIgnoradas ─────────────────────────────────────────────────────

  describe('filtrarIgnoradas', () => {
    it('deve remover tabelas com _TEMP', () => {
      const result = mod.filtrarIgnoradas(['PFUNC', 'PFUNC_TEMP', 'FCFO']);
      expect(result).toEqual(['PFUNC', 'FCFO']);
    });

    it('deve remover tabelas com _OLD', () => {
      const result = mod.filtrarIgnoradas(['PFUNC', 'PFUNC_OLD']);
      expect(result).toEqual(['PFUNC']);
    });

    it('deve remover tabelas com BKP', () => {
      const result = mod.filtrarIgnoradas(['PFUNC', 'BKP_PFUNC']);
      expect(result).toEqual(['PFUNC']);
    });

    it('deve ser case-insensitive', () => {
      const result = mod.filtrarIgnoradas(['PFUNC', 'pfunc_temp', 'fcfO_Old']);
      expect(result).toEqual(['PFUNC']);
    });

    it('deve retornar array vazio quando todas são ignoradas', () => {
      expect(mod.filtrarIgnoradas(['PFUNC_TEMP'])).toEqual([]);
    });

    it('deve retornar todas quando nenhuma corresponde', () => {
      expect(mod.filtrarIgnoradas(['PFUNC', 'FCFO'])).toEqual(['PFUNC', 'FCFO']);
    });
  });

  // ── carregarTabelasDesativadas ───────────────────────────────────────────

  describe('carregarTabelasDesativadas', () => {
    it('deve parsear tabelas desativadas do markdown', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# Tabelas Desativadas',
        '',
        '| Tabela | Descrição | Módulo |',
        '|---|----|---|',
        '| `MANALISE` | Análise (desativada) | M |',
        '| `MTEMP` | Tabela temporária | M |',
      ].join('\n'));

      const result = mod.carregarTabelasDesativadas();
      expect(result.has('MANALISE')).toBe(true);
      expect(result.has('MTEMP')).toBe(true);
      expect(result.has('PFUNC')).toBe(false);
    });

    it('deve retornar Set vazio se arquivo não existe', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      expect(mod.carregarTabelasDesativadas()).toEqual(new Set());
    });

    it('deve pular cabeçalho e separadores', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '| Tabela | Descrição |',
        '|---|---|',
        '| `PFUNC` | Funcionários |',
      ].join('\n'));

      const result = mod.carregarTabelasDesativadas();
      expect(result.has('PFUNC')).toBe(true);
      expect(result.size).toBe(1);
    });
  });

  // ── carregarColunasDesativadas ──────────────────────────────────────────

  describe('carregarColunasDesativadas', () => {
    it('deve parsear colunas desativadas do markdown', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '## CODUSUARIO',
        '## DTULTALTER',
        '# FCFO',
        '## CODFILIAL',
      ].join('\n'));

      const result = mod.carregarColunasDesativadas();
      expect(result.get('PFUNC')).toBeInstanceOf(Set);
      expect(result.get('PFUNC')!.has('CODUSUARIO')).toBe(true);
      expect(result.get('PFUNC')!.has('DTULTALTER')).toBe(true);
      expect(result.get('FCFO')!.has('CODFILIAL')).toBe(true);
      expect(result.get('PFUNC')!.has('NOME')).toBe(false);
    });

    it('deve retornar Map vazio se arquivo não existe', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      expect(mod.carregarColunasDesativadas()).toEqual(new Map());
    });
  });

  // ── carregarDescricoesTabelas ────────────────────────────────────────────

  describe('carregarDescricoesTabelas', () => {
    it('deve parsear descrições de tabelas do markdown', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '',
        'Funcionários da empresa',
        '',
        '# FCFO',
        '',
        'Fornecedores e clientes',
      ].join('\n'));

      const result = mod.carregarDescricoesTabelas();
      expect(result.get('PFUNC')).toBe('Funcionários da empresa');
      expect(result.get('FCFO')).toBe('Fornecedores e clientes');
    });

    it('deve retornar Map vazio se arquivo não existe', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      expect(mod.carregarDescricoesTabelas()).toEqual(new Map());
    });

    it('deve acumular múltiplas linhas de descrição', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '',
        'Funcionários',
        'da empresa',
      ].join('\n'));

      const result = mod.carregarDescricoesTabelas();
      expect(result.get('PFUNC')).toBe('Funcionários da empresa');
    });
  });

  // ── generateMarkdown ────────────────────────────────────────────────────

  describe('generateMarkdown', () => {
    it('deve gerar cabeçalho e descrição', () => {
      const md = mod.generateMarkdown('PFUNC', 'Funcionários', [col()]);
      expect(md).toContain('# PFUNC');
      expect(md).toContain('## Descrição');
      expect(md).toContain('Funcionários');
    });

    it('deve incluir chave primária nos metadados', () => {
      const md = mod.generateMarkdown('PFUNC', 'Teste', [
        col({ COLUMN_NAME: 'CODCOLIGADA', IS_PK: 1 }),
        col({ COLUMN_NAME: 'CODFUNC', ORDINAL_POSITION: 2, IS_PK: 1, GDIC_DESCRICAO: 'Código do funcionário' }),
      ]);
      expect(md).toContain('Chave primária');
      expect(md).toContain('CODCOLIGADA');
      expect(md).toContain('CODFUNC');
    });

    it('deve listar colunas na tabela', () => {
      const md = mod.generateMarkdown('PFUNC', 'Teste', [
        col({ ORDINAL_POSITION: 1, COLUMN_NAME: 'CODCOLIGADA', DATA_TYPE: 'INT', IS_NULLABLE: 'NO', IS_PK: 1, GDIC_DESCRICAO: 'Código da coligada' }),
        col({ ORDINAL_POSITION: 2, COLUMN_NAME: 'NOME', DATA_TYPE: 'VARCHAR', CHARACTER_MAXIMUM_LENGTH: 200, IS_NULLABLE: 'YES', IS_PK: 0, GDIC_DESCRICAO: 'Nome' }),
      ]);
      expect(md).toContain('CODCOLIGADA');
      expect(md).toContain('NOME');
      expect(md).toContain('INT');
    });

    it('deve incluir FKs de saída na seção de relacionamentos', () => {
      const md = mod.generateMarkdown('PFUNC', 'Teste', [col()], [fk()]);
      expect(md).toContain('## Relacionamentos');
      expect(md).toContain('Chaves Estrangeiras de Saída');
      expect(md).toContain('FOUTRA');
    });

    it('deve incluir FKs de entrada na seção de relacionamentos', () => {
      const md = mod.generateMarkdown('PFUNC', 'Teste', [col()], [], [fk()]);
      expect(md).toContain('Chaves Estrangeiras de Entrada');
    });

    it('deve usar descrição fallback quando tableDesc está vazio', () => {
      const md = mod.generateMarkdown('PFUNC', '', [col()]);
      expect(md).toContain('Sem descrição registrada');
    });

    it('deve marcar coluna nullable como "Sim"', () => {
      const md = mod.generateMarkdown('TESTE', 'Teste', [col({ IS_NULLABLE: 'YES' })]);
      expect(md).toContain('Sim');
    });

    it('deve marcar coluna não nullable como "Não"', () => {
      const md = mod.generateMarkdown('TESTE', 'Teste', [col({ IS_NULLABLE: 'NO' })]);
      expect(md).toContain('Não');
    });
  });

  // ── parseMapeamentoRegras ───────────────────────────────────────────────

  describe('parseMapeamentoRegras', () => {
    it('deve parsear mapeamento de regras', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '## SEXO',
        '| Tabela | Código | Descrição |',
        '|--------|--------|----------|',
        '| GSEXO | CODIGO | DESCRICAO |',
        '',
        '# FCFO',
        '## TIPO',
        '| Tabela | Código | Descrição |',
        '|--------|--------|----------|',
        '| FTIPO | CODIGO | NOME |',
      ].join('\n'));

      const result = mod.parseMapeamentoRegras('/fake/path') as Record<string, Record<string, unknown>>;
      expect(result).toHaveProperty('PFUNC');
      expect(result).toHaveProperty('FCFO');
      expect(result.PFUNC.SEXO).toMatchObject({
        tabela: 'GSEXO',
        codigo: 'CODIGO',
        descricao: 'DESCRICAO',
      });
    });

    it('deve ignorar linhas de cabeçalho da tabela markdown', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '## ATIVO',
        '| Tabela | Código | Descrição |',
        '|--------|--------|----------|',
        '| GATIVO | CODIGO | DESCRICAO |',
      ].join('\n'));

      const result = mod.parseMapeamentoRegras('/fake/path') as Record<string, Record<string, { tabela: string }>>;
      expect(result.PFUNC.ATIVO.tabela).toBe('GATIVO');
    });
  });

  // ── lerSecoesRulesMd ────────────────────────────────────────────────────

  describe('lerSecoesRulesMd', () => {
    it('deve ler seções de arquivo .rules.md existente', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '## SEXO',
        '| M | Masculino |',
        '',
      ].join('\n'));
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const result = mod.lerSecoesRulesMd('/fake/PFUNC.rules.md');
      expect(result.secoes).toHaveProperty('SEXO');
      expect(result.ordem).toEqual(['SEXO']);
    });

    it('deve retornar vazio quando arquivo não existe', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const result = mod.lerSecoesRulesMd('/fake/inexistente.rules.md');
      expect(result.secoes).toEqual({});
      expect(result.ordem).toEqual([]);
    });

    it('deve normalizar seção com linha em branco no final', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '## SEXO',
        '| M | Masculino |',
        '',
        '',
      ].join('\n'));
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const result = mod.lerSecoesRulesMd('/fake/PFUNC.rules.md');
      const secoes = result.secoes as Record<string, string[]>;
      expect(secoes.SEXO[secoes.SEXO.length - 1]).toBe('');
      // A seção deve terminar com exatamente 1 linha em branco
      const lineCount = secoes.SEXO.length;
      expect(secoes.SEXO[lineCount - 2]).not.toBe('');
    });
  });

  // ── generateIndex ────────────────────────────────────────────────────────

  describe('generateIndex', () => {
    it('deve gerar índice markdown com tabelas listadas', () => {
      const tables = [
        { name: 'PFUNC', descricao: 'Funcionários', totalColunas: 5, colsComDesc: 3, pkCols: ['CODCOLIGADA', 'CODFUNC'], columns: [] },
        { name: 'FCFO', descricao: 'Fornecedores', totalColunas: 4, colsComDesc: 2, pkCols: ['CODIGO'], columns: [] },
      ];

      mod.generateIndex(tables, [], '/fake/db-index.md');

      expect(writeFileSync).toHaveBeenCalledWith(
        '/fake/db-index.md',
        expect.stringContaining('PFUNC'),
        'utf-8',
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        '/fake/db-index.md',
        expect.stringContaining('FCFO'),
        'utf-8',
      );
    });

    it('deve incluir módulos quando fornecidos', () => {
      const tables = [{ name: 'PFUNC', descricao: 'Funcionários', totalColunas: 3, colsComDesc: 2, pkCols: [], columns: [] }];
      const modulos = [{ codsistema: 'P', descricao: 'TOTVS Folha de Pagamento' }];

      mod.generateIndex(tables, modulos, '/fake/db-index.md');

      expect(writeFileSync).toHaveBeenCalledWith(
        '/fake/db-index.md',
        expect.stringContaining('Módulos do Sistema'),
        'utf-8',
      );
    });

    it('deve truncar descrições longas', () => {
      const longDesc = 'A'.repeat(200);
      const tables = [{ name: 'PFUNC', descricao: longDesc, totalColunas: 3, colsComDesc: 2, pkCols: [], columns: [] }];

      mod.generateIndex(tables, [], '/fake/db-index.md');

      expect(writeFileSync).toHaveBeenCalled();
    });

    it('deve retornar número de linhas geradas', () => {
      const lineCount = mod.generateIndex([], [], '/fake/db-index.md');
      expect(lineCount).toBeGreaterThan(0);
    });
  });

  // ── extrairDescricaoMd ───────────────────────────────────────────────────

  describe('extrairDescricaoMd', () => {
    it('deve extrair descrição da seção ## Descrição', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '## Descrição',
        '',
        'Funcionários da empresa',
      ].join('\n'));

      expect(mod.extrairDescricaoMd('/fake/PFUNC.md')).toBe('Funcionários da empresa');
    });

    it('deve retornar string vazia se arquivo não existe', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('ENOENT'); });
      expect(mod.extrairDescricaoMd('/fake/inexistente.md')).toBe('');
    });

    it('deve suportar acentuação portuguesa "Descrição"', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '## Descrição',
        '',
        'Dados dos funcionários',
      ].join('\n'));

      expect(mod.extrairDescricaoMd('/fake/PFUNC.md')).toBe('Dados dos funcionários');
    });

    it('deve lidar com caminho de .rules.md convertendo para .md', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# PFUNC',
        '## Descrição',
        '',
        'Rules description fallback',
      ].join('\n'));

      expect(mod.extrairDescricaoMd('/fake/PFUNC.rules.md')).toBe('Rules description fallback');
    });
  });

  // ── mcpResolve ──────────────────────────────────────────────────────────

  describe('mcpResolve', () => {
    it('deve resolver caminho relativo ao diretório do script', () => {
      const result = mod.mcpResolve('docs', 'db', 'tables');
      expect(result).toContain('docs');
      expect(result).toContain('db');
      expect(result).toContain('tables');
    });
  });
});
