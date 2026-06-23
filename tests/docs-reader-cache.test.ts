import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock de funções do fs para isolar testes
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

// Mock do módulo sqlite
vi.mock('node:sqlite', () => ({
  DatabaseSync: vi.fn(),
}));

describe('docs-reader — cache e utilitários', () => {
  let docReader: typeof import('../src/services/docs-reader.js');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Stat padrão: arquivo existe e foi modificado agora
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({
      mtimeMs: Date.now(),
      isFile: () => true,
    });

    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

    docReader = await import('../src/services/docs-reader.js');
  });

  describe('getModule', () => {
    it('deve retornar módulo P para tabelas com prefixo P', () => {
      const result = docReader.getModule('PFUNC');
      expect(result).toBe('TOTVS Folha de Pagamento');
    });

    it('deve retornar módulo A para tabelas com prefixo A', () => {
      const result = docReader.getModule('ABANCOHORFUN');
      expect(result).toBe('TOTVS Automação de Ponto');
    });

    it('deve retornar módulo T para tabelas com prefixo T', () => {
      const result = docReader.getModule('TITMMOV');
      expect(result).toBe('TOTVS Gestão de Estoque, Compras e Faturamento');
    });

    it('deve ser case-insensitive para o prefixo', () => {
      const result = docReader.getModule('pfunc');
      expect(result).toBe('TOTVS Folha de Pagamento');
    });

    it('deve retornar "Módulo desconhecido" para prefixo não mapeado', () => {
      const result = docReader.getModule('ZZZZ');
      expect(result).toBe('Módulo desconhecido');
    });
  });

  describe('loadTableIndex', () => {
    const sampleIndex = [
      '| `PFUNC` | Funcionários |',
      '| `FCFO`  | Fornecedores |',
      '| `TITMMOV` | Movimentos de Títulos |',
    ].join('\n');

    it('deve carregar e parsear o índice corretamente', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(sampleIndex);

      const result = docReader.loadTableIndex();

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ name: 'PFUNC', description: 'Funcionários' });
      expect(result[1]).toMatchObject({ name: 'FCFO', description: 'Fornecedores' });
      expect(result[2]).toMatchObject({ name: 'TITMMOV', description: 'Movimentos de Títulos' });
    });

    it('deve retornar cache quando mtime não mudou', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(sampleIndex);

      // Primeira chamada
      const first = docReader.loadTableIndex();
      // Segunda chamada — readFileSync não deve ser chamado de novo
      readFileSync.mockClear();
      const second = docReader.loadTableIndex();

      expect(second).toEqual(first);
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('deve recarregar quando mtime mudar', () => {
      let callCount = 0;
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return '| `PFUNC` | Funcionários |';
        return '| `PFUNC` | Funcionários |\n| `FCFO` | Fornecedores |';
      });

      // Primeira chamada
      const first = docReader.loadTableIndex();
      expect(first).toHaveLength(1);

      // Atualiza mtime
      (statSync as ReturnType<typeof vi.fn>).mockReturnValue({
        mtimeMs: Date.now() + 1000,
        isFile: () => true,
      });

      // Segunda chamada deve recarregar
      const second = docReader.loadTableIndex();
      expect(second).toHaveLength(2);
      expect(readFileSync).toHaveBeenCalledTimes(2);
    });

    it('deve lançar erro se arquivo de índice não existe', () => {
      (statSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      expect(() => docReader.loadTableIndex()).toThrow(/índice/);
    });

    it('deve pular linhas que não correspondem ao padrão', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue([
        '# Índice do Banco',
        '',
        '| Tabela | Descrição |',
        '|--------|-----------|',
        '| `PFUNC` | Funcionários |',
        '| `FCFO`  | Fornecedores |',
        '',
        'Algum texto solto',
      ].join('\n'));

      const result = docReader.loadTableIndex();
      expect(result).toHaveLength(2);
    });
  });

  describe('hasTableRules', () => {
    it('deve retornar true quando arquivo .rules.md existe', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'PFUNC.md',
        'PFUNC.rules.md',
        'FCFO.md',
      ]);

      expect(docReader.hasTableRules('PFUNC')).toBe(true);
    });

    it('deve retornar false quando arquivo .rules.md não existe', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'PFUNC.md',
        'FCFO.md',
      ]);

      expect(docReader.hasTableRules('PFUNC')).toBe(false);
    });

    it('deve ser case-insensitive', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'PFUNC.md',
        'PFUNC.rules.md',
      ]);

      expect(docReader.hasTableRules('pfunc')).toBe(true);
    });

    it('deve usar cache do Set após primeira chamada', () => {
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue(['PFUNC.rules.md']);

      docReader.hasTableRules('PFUNC'); // primeira — popula cache
      readdirSync.mockClear();

      docReader.hasTableRules('PFUNC'); // segunda — usa cache
      expect(readdirSync).not.toHaveBeenCalled();
    });
  });

  describe('getTableRules', () => {
    it('deve retornar null quando arquivo .rules.md não existe', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = docReader.getTableRules('PFUNC');
      expect(result).toBeNull();
    });

    it('deve ler e retornar conteúdo do .rules.md', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('# Regras PFUNC\n## SEXO\nM = Masculino\nF = Feminino');

      const result = docReader.getTableRules('PFUNC');
      expect(result).toContain('Regras PFUNC');
      expect(result).toContain('SEXO');
    });

    it('deve usar cache LRU', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('# Regras PFUNC');

      docReader.getTableRules('PFUNC'); // primeira
      readFileSync.mockClear();

      docReader.getTableRules('PFUNC'); // segunda — cache
      expect(readFileSync).not.toHaveBeenCalled();
    });
  });

  describe('getTableRawMarkdown', () => {
    it('deve lançar erro se arquivo não existe', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      expect(() => docReader.getTableRawMarkdown('PFUNC')).toThrow(/Documentação não encontrada/);
    });

    it('deve ler e retornar conteúdo markdown', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('# PFUNC\n## Descrição\nFuncionários');

      const result = docReader.getTableRawMarkdown('PFUNC');
      expect(result).toContain('# PFUNC');
      expect(result).toContain('Funcionários');
    });
  });

  describe('getDbIndexMarkdown', () => {
    it('deve ler e retornar conteúdo do índice', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('# Índice completo');

      const result = docReader.getDbIndexMarkdown();
      expect(result).toBe('# Índice completo');
    });

    it('deve usar cache', () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('# Índice');

      docReader.getDbIndexMarkdown();
      readFileSync.mockClear();

      docReader.getDbIndexMarkdown();
      expect(readFileSync).not.toHaveBeenCalled();
    });
  });

  describe('listAvailableTables', () => {
    it('deve listar arquivos .md removendo extensão', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'PFUNC.md',
        'FCFO.md',
        'PFUNC.rules.md',
      ]);

      const result = docReader.listAvailableTables();
      expect(result).toEqual(['PFUNC', 'FCFO', 'PFUNC.rules']);
    });

    it('deve retornar array vazio se diretório não existe', () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = docReader.listAvailableTables();
      expect(result).toEqual([]);
    });
  });
});
