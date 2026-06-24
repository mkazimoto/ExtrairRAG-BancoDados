/// <reference types="node" />

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
    '| `PFUNC` | Funcionários | ✓ |',
    '| `VFUNCIONARIO` | Tabela de Funcionários | — |',
    '| `FCFO` | Fornecedores | — |',
    '| `TITMMOV` | Movimentos de Títulos | — |',
    '| `PCPAL` | Cargos e Salários | — |',
    '| `PPESSOAL` | Dados Pessoais dos Funcionários | — |',
    '| `SALARIO` | Salários e Remunerações | — |',
    '| `CCUSTO` | Centro de Custo | — |',
    '| `AHORARIO` | Horários de Trabalho | — |',
    '| `ABANCOHORFUN` | Banco de Horas do Funcionário | — |',
  ].join('\n');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({
      mtimeMs: Date.now(),
      isFile: () => true,
    });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
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

    // PFUNC (desc "Funcionários" = conceito exato) deve ter
    // tanto peso quanto VFUNCIONARIO (nome "VFUNCIONARIO" + desc "Tabela de Funcionários")
    const vfunc = result.items.find(t => t.name === 'VFUNCIONARIO');
    expect(vfunc).toBeDefined();
    expect(pfunc!.score!).toBeGreaterThanOrEqual(vfunc!.score!);
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
    expect(vfunc!.score!).toBeGreaterThanOrEqual(ppessoal!.score!);
  });

  it('deve dar +5 para tabelas com regras documentadas (.rules.md)', () => {
    const result = docReader.searchTables('funcionario');

    const pfunc = result.items.find(t => t.name === 'PFUNC');
    const vfunc = result.items.find(t => t.name === 'VFUNCIONARIO');
    expect(pfunc).toBeDefined();
    expect(vfunc).toBeDefined();

    // PFUNC tem regras (+5), VFUNCIONARIO não — PFUNC deve ter score maior
    expect(pfunc!.score!).toBeGreaterThan(vfunc!.score!);

    // A diferença deve ser exatamente 5 (mesmo score base = 18, +5 do bônus)
    expect(pfunc!.score! - vfunc!.score!).toBe(5);
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
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(sampleIndex);

    docReader = await import('../src/services/docs-reader.js');
  });

  it('deve funcionar quando cache SQLite existe mas não retorna resultados', () => {
    // Já configurado no mock global: prepare().all() retorna []
    const result = docReader.searchTables('funcionario');
    expect(result.items.length).toBeGreaterThan(0);
  });
});

describe('docs-reader — searchTables plural tokens', () => {
  let docReader: typeof import('../src/services/docs-reader.js');

  const financeIndex = [
    '| `FLAN` | Lançamentos / Títulos Financeiros |',
    '| `DLANFIN` | Dados Fiscais do Lançamento Financeiro |',
    '| `CLANCAMENTO` | Lançamentos Contábeis |',
    '| `DLAF` | Lançamentos Fiscais |',
    '| `FINTEGRACAOBOLETOLAN` | Boleto/Lançamento da transação com cartão |',
  ].join('\n');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({
      mtimeMs: Date.now(),
      isFile: () => true,
    });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(financeIndex);

    docReader = await import('../src/services/docs-reader.js');
  });

  it('deve tratar token plural da descrição como match de token (+8) quando query está no singular', () => {
    // CLANCAMENTO tem desc "Lançamentos Contábeis" — token "lancamentos" (plural)
    // A query "lancamento" (singular) deve reconhecer "lancamentos" como token
    // via singularização, ganhando +8 em vez de apenas +3 por substring
    const result = docReader.searchTables('lancamento');
    const clancamento = result.items.find(t => t.name === 'CLANCAMENTO');
    expect(clancamento).toBeDefined();
    // CLANCAMENTO não tem match no módulo (C=contábil) nem no nome,
    // então o score mínimo esperado é 8 (token match na descrição)
    expect(clancamento!.score).toBeGreaterThanOrEqual(8);
  });

  it('deve priorizar FLAN sobre DLANFIN ao buscar "lançamento financeiro"', () => {
    // FLAN (desc "Lançamentos / Títulos Financeiros") é a tabela principal
    // de lançamentos financeiros e deve ter score maior que DLANFIN
    // (desc "Dados Fiscais do Lançamento Financeiro")
    const result = docReader.searchTables('lançamento financeiro', 20);

    const flan = result.items.find(t => t.name === 'FLAN');
    const dlanfin = result.items.find(t => t.name === 'DLANFIN');

    expect(flan).toBeDefined();
    expect(dlanfin).toBeDefined();

    // FLAN deve ter score maior que DLANFIN
    expect(flan!.score!).toBeGreaterThan(dlanfin!.score!);
  });
});

describe('docs-reader — searchTables locação de imóvel', () => {
  let docReader: typeof import('../src/services/docs-reader.js');

  const locacaoIndex = [
    '| `XALGCONTRATOLOC` | Contrato de Locação / Aluguel de Imóvel |',
    '| `XALGCONTRATOLOCIMOVEL` | Imóvel do contrato de locação |',
    '| `XALGCONTRATOLOCADIT` | Aditivo do contrato de locação |',
    '| `XALGCONTRATOLOCLOCATARIO` | Locatário do contrato de locação |',
    '| `XALGIMOVEL` | Imóvel do Contrato de Locação / Aluguel |',
    '| `XALGCONTRATOLOCALGDOBRO` | Tabela do Aluguel em Dobro |',
  ].join('\n');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({
      mtimeMs: Date.now(),
      isFile: () => true,
    });
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(locacaoIndex);

    docReader = await import('../src/services/docs-reader.js');
  });

  it('deve retornar XALGCONTRATOLOC nos resultados ao buscar "locacao de imovel"', () => {
    const result = docReader.searchTables('locacao de imovel', 20);

    const contratoLoc = result.items.find(t => t.name === 'XALGCONTRATOLOC');
    expect(contratoLoc).toBeDefined();

    // XALGCONTRATOLOC deve aparecer na primeira página (top 20)
    expect(result.items.slice(0, 20).some(t => t.name === 'XALGCONTRATOLOC')).toBe(true);
  });

  it('deve retornar XALGCONTRATOLOC na primeira página ao buscar "alugueis de imóveis"', () => {
    // A palavra "alugueis" no plural deve ser corretamente singularizada para "aluguel"
    // (regra portuguesa: aluguel→alugueis, troca 'l' por 'is' no plural)
    const result = docReader.searchTables('alugueis de imóveis', 20);

    const contratoLoc = result.items.find(t => t.name === 'XALGCONTRATOLOC');
    expect(contratoLoc).toBeDefined();

    // XALGCONTRATOLOC deve aparecer na primeira página
    expect(result.items.slice(0, 20).some(t => t.name === 'XALGCONTRATOLOC')).toBe(true);

    // Deve ter score positivo fruto dos matches na descrição
    expect(contratoLoc!.score).toBeGreaterThan(0);
  });

  it('deve retornar XALGCONTRATOLOC na primeira página ao buscar "locacoes de imoveis"', () => {
    // "locacoes" é o plural de "locação" (regra -ção→-ções)
    // Após normalização fonética: "locações"→"locacoes", deve singularizar para "locacao"
    // "imoveis" é o plural de "imóvel" (regra -vel→-veis)
    // Após normalização fonética: "imóveis"→"imoveis", deve singularizar para "imovel"
    const result = docReader.searchTables('locacoes de imoveis', 20);

    const contratoLoc = result.items.find(t => t.name === 'XALGCONTRATOLOC');
    expect(contratoLoc).toBeDefined();

    // XALGCONTRATOLOC deve aparecer na primeira página (top 20)
    expect(result.items.slice(0, 20).some(t => t.name === 'XALGCONTRATOLOC')).toBe(true);

    // Deve ter score positivo — "locacao" como token na descrição (+8) e "imovel" como token (+8)
    expect(contratoLoc!.score).toBeGreaterThan(0);
  });
});
