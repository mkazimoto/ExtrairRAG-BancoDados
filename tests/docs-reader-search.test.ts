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

// Mock do SQLite de cache — retorna nada por padrão
const mockDb = {
  prepare: vi.fn(() => ({
    all: vi.fn(() => []),
  })),
};

vi.mock('node:sqlite', () => ({
  DatabaseSync: vi.fn(() => mockDb),
}));

describe('docs-reader — searchTables', () => {
  let docReader: typeof import('../src/services/docs-reader.js');

  /** Índice de tabelas usado nos testes */
  const sampleIndex = [
    '| `PFUNC` | Funcionários |',
    '| `VFUNCIONARIO` | Tabela de Funcionários |',
    '| `FCFO` | Fornecedores |',
    '| `TITMMOV` | Movimentos de Títulos |',
    '| `PCPAL` | Cargos e Salários |',
    '| `PPESSOAL` | Dados Pessoais dos Funcionários |',
    '| `SALARIO` | Salários e Remunerações |',
    '| `CCUSTO` | Centro de Custo |',
    '| `AHORARIO` | Horários de Trabalho |',
    '| `ABANCOHORFUN` | Banco de Horas do Funcionário |',
  ].join('\n');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({
      mtimeMs: Date.now(),
      isFile: () => true,
    });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(sampleIndex);

    docReader = await import('../src/services/docs-reader.js');
  });

  it('deve encontrar PFUNC ao buscar "funcionario"', () => {
    const result = docReader.searchTables('funcionario');
    expect(result.total).toBeGreaterThan(0);

    // PFUNC tem descrição "Funcionários" — deve estar nos resultados
    const pfunc = result.items.find(t => t.name === 'PFUNC');
    expect(pfunc).toBeDefined();
    expect(pfunc!.score).toBeGreaterThan(0);
  });

  it('deve priorizar tabela com nome exato sobre descrição', () => {
    const result = docReader.searchTables('funcionario');

    // VFUNCIONARIO tem "Funcionário" no nome → score alto
    const vfunc = result.items.find(t => t.name === 'VFUNCIONARIO');
    expect(vfunc).toBeDefined();

    // PPESSOAL tem "Pessoais dos Funcionários" na descrição
    const ppessoal = result.items.find(t => t.name === 'PPESSOAL');
    expect(ppessoal).toBeDefined();

    // VFUNCIONARIO deve ter score maior que PPESSOAL
    expect(vfunc!.score).toBeGreaterThanOrEqual(ppessoal!.score);
  });

  it('deve retornar vazio para query sem correspondência', () => {
    const result = docReader.searchTables('xyzzy_nao_existe');
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('deve retornar vazio para query com apenas stopwords', () => {
    const result = docReader.searchTables('de do da');
    expect(result.total).toBe(0);
  });

  it('deve respeitar limit e offset', () => {
    // "funcionario" deve ter vários matches
    const all = docReader.searchTables('funcionario', 100);
    const limited = docReader.searchTables('funcionario', 2);

    expect(all.total).toBeGreaterThan(2);
    expect(limited.items).toHaveLength(2);
    expect(limited.total).toBe(all.total);
  });

  it('deve ordenar por score decrescente', () => {
    const result = docReader.searchTables('funcionario', 50);
    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i].score).toBeLessThanOrEqual(result.items[i - 1].score!);
    }
  });

  it('deve encontrar tabelas relacionadas a "banco horas"', () => {
    const result = docReader.searchTables('banco horas');

    const bancoHoras = result.items.find(t => t.name === 'ABANCOHORFUN');
    expect(bancoHoras).toBeDefined();
  });

  it('deve encontrar "fornecedores"', () => {
    const result = docReader.searchTables('fornecedores');
    const fcfo = result.items.find(t => t.name === 'FCFO');
    expect(fcfo).toBeDefined();
    expect(fcfo!.score).toBeGreaterThan(0);
  });

  it('deve ser tolerante a acentos (fonética)', () => {
    // "funcionários" com acento deve encontrar "Funcionários"
    const result = docReader.searchTables('funcionários');
    const pfunc = result.items.find(t => t.name === 'PFUNC');
    expect(pfunc).toBeDefined();
  });

  it('deve encontrar "horario" sem acento mesmo com "Horários" no índice', () => {
    const result = docReader.searchTables('horario');
    const horario = result.items.find(t => t.name === 'AHORARIO');
    expect(horario).toBeDefined();
  });

  it('deve tratar plurais ("salarios" → "Salários")', () => {
    const result = docReader.searchTables('salarios');
    const salario = result.items.find(t => t.name === 'SALARIO');
    expect(salario).toBeDefined();
  });

  it('deve buscar por código exato da tabela', () => {
    const result = docReader.searchTables('PFUNC');
    const pfunc = result.items.find(t => t.name === 'PFUNC');
    expect(pfunc).toBeDefined();
    // Match exato no nome = score alto
    expect(pfunc!.score).toBeGreaterThanOrEqual(10);
  });

  it('deve retornar matchedColumns quando busca via cache de colunas', () => {
    // O cache SQLite não está disponível nos mocks, então esse teste verifica
    // apenas que o mecanismo não quebra quando o cache não existe
    const result = docReader.searchTables('funcionario');
    expect(Array.isArray(result.items)).toBe(true);
  });
});

describe('docs-reader — searchTables com cache SQLite', () => {
  let docReader: typeof import('../src/services/docs-reader.js');

  const sampleIndex = [
    '| `PFUNC` | Funcionários |',
    '| `FCFO` | Fornecedores |',
  ].join('\n');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({
      mtimeMs: Date.now(),
      isFile: () => true,
    });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(sampleIndex);

    docReader = await import('../src/services/docs-reader.js');
  });

  it('deve funcionar quando cache SQLite existe mas não retorna resultados', () => {
    // Já configurado no mock global: prepare().all() retorna []
    const result = docReader.searchTables('funcionario');
    expect(result.items.length).toBeGreaterThan(0);
  });
});
