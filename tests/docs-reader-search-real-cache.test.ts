/**
 * Testes de integração para searchTables usando o cache SQLite real.
 * Valida que a busca por colunas (via cache) funciona com dados reais,
 * incluindo o bônus de conceito match (+20).
 */
import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const CACHE_PATH = 'docs/db/cache.sqlite';

describe('docs-reader — searchTables Data de Nascimento (integração)', () => {
  it('deve retornar PPESSOA na primeira página ao buscar "Data de Nascimento"', async () => {
    // Pula o teste se o cache não existir (ex: CI)
    if (!existsSync(CACHE_PATH)) {
      return;
    }

    // Importa o módulo real (sem mocks)
    const { searchTables } = await import('../src/services/docs-reader.js');

    const result = searchTables('Data de Nascimento', 20);

    // PPESSOA deve estar na primeira página (top 20)
    const ppessoa = result.items.find(t => t.name === 'PPESSOA');
    expect(ppessoa).toBeDefined();
    expect(result.items.indexOf(ppessoa)).toBeLessThan(20);

    // PPESSOA deve ter matchedColumns incluindo DTNASCIMENTO
    expect(ppessoa!.matchedColumns).toBeDefined();
    expect(ppessoa!.matchedColumns!.some((c: { name: string }) => c.name === 'DTNASCIMENTO')).toBe(true);

    // DTNASCIMENTO deve ter a descrição GDIC "Data de Nascimento"
    const dtnascimento = ppessoa!.matchedColumns!.find((c: { name: string }) => c.name === 'DTNASCIMENTO');
    expect(dtnascimento).toBeDefined();
    expect(dtnascimento!.description).toBe('Data de Nascimento');

    // PPESSOA deve ter score maior que o número bruto de colunas correspondentes
    // (o bônus +20 por conceito match deve ser aplicado, então score > matchedColumns.length)
    expect(ppessoa!.score).toBeGreaterThan(ppessoa!.matchedColumns!.length);
  });
});
