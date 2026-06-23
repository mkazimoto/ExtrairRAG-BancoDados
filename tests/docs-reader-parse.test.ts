import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...(actual as object),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

vi.mock('node:sqlite', () => ({
  DatabaseSync: vi.fn(),
}));

/** Cria um markdown de tabela realista para testes de parse */
function createSampleMarkdown(overrides: {
  description?: string;
  pk?: string;
  columns?: string;
  outboundFks?: string;
  inboundFks?: string;
} = {}) {
  return `# PFUNC

## Descrição
${overrides.description ?? 'Funcionários da empresa'}

## Metadados
| | |
|---|---|
| Chave primária | ${overrides.pk ?? '\`CODCOLIGADA\`, \`CODFUNC\`'} |
| Tabelas relacionadas | FCFO |

## Colunas

| # | Coluna | Tipo | Nullable | PK | Descrição |
|---|--------|------|----------|----|-----------|
${overrides.columns ?? `| 1 | \`CODCOLIGADA\` | \`INT\` | Não | ✓ | Código da coligada |
| 2 | \`CODFUNC\` | \`INT\` | Não | ✓ | Código do funcionário |
| 3 | \`NOME\` | \`VARCHAR(200)\` | Não |   | Nome do funcionário |
| 4 | \`APELIDO\` | \`VARCHAR(50)\` | Sim |   | Apelido |
| 5 | \`DATANASC\` | \`DATETIME\` | Sim |   | Data de nascimento |
| 6 | \`SEXO\` | \`VARCHAR(1)\` | Sim |   | Sexo (F/M)`}

${overrides.outboundFks ?? `## Relacionamentos

### Chaves Estrangeiras de Saída

| Constraint | Colunas | Tabela Referenciada | Colunas Referenciadas |
|------------|---------|---------------------|----------------------|
| \`FK_PFUNC_FCFO\` | \`CODFUNC\` | \`FCFO\` | \`CODFUNC\` |`}

${overrides.inboundFfs ?? `### Chaves Estrangeiras de Entrada

| Constraint | Colunas | Tabela Referenciada | Colunas Referenciadas |
|------------|---------|---------------------|----------------------|
| \`FK_FCFO_PFUNC\` | \`CODFUNC\` | \`FCFO\` | \`CODFUNC\` |`}
`;
}

describe('docs-reader — parse de markdown', () => {
  let docReader: typeof import('../src/services/docs-reader.js');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({
      mtimeMs: Date.now(),
      isFile: () => true,
    });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

    docReader = await import('../src/services/docs-reader.js');
  });

  describe('getTableDetail', () => {
    it('deve parsear metadados, colunas e FKs corretamente', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(createSampleMarkdown());

      const detail = docReader.getTableDetail('PFUNC');

      expect(detail.name).toBe('PFUNC');
      expect(detail.description).toBe('Funcionários da empresa');
      expect(detail.primaryKey).toEqual(['CODCOLIGADA', 'CODFUNC']);
      expect(detail.columns).toHaveLength(6);

      // Coluna 1: CODCOLIGADA
      expect(detail.columns[0]).toMatchObject({
        ordinal: 1,
        name: 'CODCOLIGADA',
        type: 'INT',
        nullable: false,
        isPrimaryKey: true,
      });

      // Coluna 4: APELIDO (nullable, não PK)
      expect(detail.columns[3]).toMatchObject({
        ordinal: 4,
        name: 'APELIDO',
        type: 'VARCHAR(50)',
        nullable: true,
        isPrimaryKey: false,
      });

      // FK de saída
      expect(detail.outboundFks).toHaveLength(1);
      expect(detail.outboundFks[0]).toMatchObject({
        constraint: 'FK_PFUNC_FCFO',
        columns: ['CODFUNC'],
        referencedTable: 'FCFO',
        referencedColumns: ['CODFUNC'],
      });

      // FK de entrada
      expect(detail.inboundFks).toHaveLength(1);
      expect(detail.inboundFks[0]).toMatchObject({
        constraint: 'FK_FCFO_PFUNC',
        columns: ['CODFUNC'],
        referencedTable: 'FCFO',
        referencedColumns: ['CODFUNC'],
      });
    });

    it('deve tratar PK vazia quando não encontrada', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        createSampleMarkdown({ pk: '' })
      );

      const detail = docReader.getTableDetail('PFUNC');
      expect(detail.primaryKey).toEqual([]);
    });

    it('deve lançar erro se arquivo não existe', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      expect(() => docReader.getTableDetail('INEXISTENTE')).toThrow(/Documentação não encontrada/);
    });

    it('deve parsear múltiplas FK de saída', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        createSampleMarkdown({
          outboundFks: `## Relacionamentos

### Chaves Estrangeiras de Saída

| Constraint | Colunas | Tabela Referenciada | Colunas Referenciadas |
|------------|---------|---------------------|----------------------|
| \`FK_PFUNC_FCFO\` | \`CODFUNC\` | \`FCFO\` | \`CODFUNC\` |
| \`FK_PFUNC_CCUSTO\` | \`CODCCUSTO\` | \`CCUSTO\` | \`CODCCUSTO\` |`,
        })
      );

      const detail = docReader.getTableDetail('PFUNC');
      expect(detail.outboundFks).toHaveLength(2);
      expect(detail.outboundFks[1].constraint).toBe('FK_PFUNC_CCUSTO');
    });

    it('deve usar cache LRU', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(createSampleMarkdown());

      docReader.getTableDetail('PFUNC'); // primeira
      readFileSync.mockClear();

      docReader.getTableDetail('PFUNC'); // segunda — cache
      expect(readFileSync).not.toHaveBeenCalled();
    });
  });

  describe('listTablesByModule', () => {
    const sampleIndex = [
      '| `PFUNC` | Funcionários |',
      '| `PCPAL` | Cargos e Salários |',
      '| `FCFO` | Fornecedores |',
      '| `TITMMOV` | Movimentos de Títulos |',
    ].join('\n');

    it('deve filtrar tabelas por prefixo do módulo', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(sampleIndex);

      const result = docReader.listTablesByModule('P');
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].name).toBe('PFUNC');
      expect(result.items[1].name).toBe('PCPAL');
    });

    it('deve retornar vazio para módulo sem tabelas', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(sampleIndex);

      const result = docReader.listTablesByModule('Z');
      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it('deve respeitar limit e offset', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '| `PAAA` | Tabela A |',
        '| `PBBB` | Tabela B |',
        '| `PCCC` | Tabela C |',
      ].join('\n'));

      const result = docReader.listTablesByModule('P', 1, 1);
      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('PBBB');
    });
  });
});
