import { describe, it, expect, beforeEach, vi } from 'vitest';

// A factory do parser é lazy singleton; precisamos resetar entre testes
// para isolar cada teste. Mockamos createRequire para controlar o parser.

describe('validateSqlSyntax', () => {
  let validateSqlSyntax: typeof import('../src/tools/sql-validator.js').validateSqlSyntax;

  beforeEach(async () => {
    // Recarrega o módulo a cada teste para resetar o singleton do parser
    vi.resetModules();
    const mod = await import('../src/tools/sql-validator.js');
    validateSqlSyntax = mod.validateSqlSyntax;
  });

  describe('validação básica', () => {
    it('deve aceitar SELECT simples', () => {
      const result = validateSqlSyntax('SELECT * FROM PFUNC');
      expect(result.isValid).toBe(true);
      expect(result.message).toBe('Sintaxe SQL válida.');
    });

    it('deve aceitar SELECT com WHERE', () => {
      const result = validateSqlSyntax("SELECT CODFUNC, NOME FROM PFUNC WHERE CODCOLIGADA = 1");
      expect(result.isValid).toBe(true);
    });

    it('deve rejeitar string vazia', () => {
      const result = validateSqlSyntax('');
      expect(result.isValid).toBe(false);
      expect(result.message).toBe('A consulta SQL está vazia.');
    });

    it('deve rejeitar string com apenas espaços', () => {
      const result = validateSqlSyntax('   ');
      expect(result.isValid).toBe(false);
      expect(result.message).toBe('A consulta SQL está vazia.');
    });

    it('deve rejeitar SQL com sintaxe inválida', () => {
      const result = validateSqlSyntax('SELECTR * FROM PFUNC');
      expect(result.isValid).toBe(false);
      expect(result.message).toBe('Erro de sintaxe SQL encontrado.');
      expect(result.errorDetails).toBeDefined();
      expect(result.errorLine).toBeDefined();
      expect(result.errorColumn).toBeDefined();
    });
  });

  describe('T-SQL específico', () => {
    it('deve aceitar TOP', () => {
      const result = validateSqlSyntax('SELECT TOP 10 CODFUNC, NOME FROM PFUNC');
      expect(result.isValid).toBe(true);
    });

    it('deve aceitar CTE (WITH)', () => {
      const sql = `
        WITH CTE AS (
          SELECT CODFUNC, NOME FROM PFUNC
        )
        SELECT * FROM CTE
      `;
      const result = validateSqlSyntax(sql);
      expect(result.isValid).toBe(true);
    });

    it('deve aceitar JOIN', () => {
      const sql = `
        SELECT P.CODFUNC, P.NOME, F.CODIGO
        FROM PFUNC P (NOLOCK)
        INNER JOIN FCFO F (NOLOCK) ON P.CODFUNC = F.CODFUNC
      `;
      const result = validateSqlSyntax(sql);
      expect(result.isValid).toBe(true);
    });

    it('deve aceitar INSERT', () => {
      const result = validateSqlSyntax("INSERT INTO PFUNC (CODFUNC, NOME) VALUES (1, 'TESTE')");
      expect(result.isValid).toBe(true);
    });

    it('deve aceitar UPDATE', () => {
      const result = validateSqlSyntax("UPDATE PFUNC SET NOME = 'TESTE' WHERE CODFUNC = 1");
      expect(result.isValid).toBe(true);
    });

    it('deve aceitar DELETE', () => {
      const result = validateSqlSyntax('DELETE FROM PFUNC WHERE CODFUNC = 1');
      expect(result.isValid).toBe(true);
    });
  });

  describe('cláusula OPTION', () => {
    it('deve aceitar OPTION (MAXRECURSION 0)', () => {
      const sql = `
        SELECT CODFUNC, NOME
        FROM PFUNC
        OPTION (MAXRECURSION 0)
      `;
      const result = validateSqlSyntax(sql);
      expect(result.isValid).toBe(true);
    });

    it('deve aceitar múltiplas OPTION', () => {
      const sql = `
        SELECT CODFUNC, NOME
        FROM PFUNC
        OPTION (MAXRECURSION 0, RECOMPILE)
      `;
      const result = validateSqlSyntax(sql);
      expect(result.isValid).toBe(true);
    });

    it('deve aceitar OPTION com OPTIMIZE FOR', () => {
      const sql = `
        SELECT CODFUNC, NOME
        FROM PFUNC
        OPTION (OPTIMIZE FOR UNKNOWN)
      `;
      const result = validateSqlSyntax(sql);
      expect(result.isValid).toBe(true);
    });

    it('deve aceitar OPTION seguido de comentário', () => {
      const sql = `
        SELECT CODFUNC, NOME FROM PFUNC
        OPTION (MAXRECURSION 0) -- otimização de recursão
      `;
      const result = validateSqlSyntax(sql);
      expect(result.isValid).toBe(true);
    });
  });

  describe('MERGE e OUTPUT — limitação conhecida do parser', () => {
    it('não aceita MERGE (limitação do parser PEG.js)', () => {
      const sql = `
        MERGE INTO PFUNC AS TARGET
        USING (SELECT 1 AS CODFUNC) AS SOURCE
        ON TARGET.CODFUNC = SOURCE.CODFUNC
        WHEN MATCHED THEN UPDATE SET NOME = 'TESTE'
        WHEN NOT MATCHED THEN INSERT (CODFUNC, NOME) VALUES (1, 'TESTE');
      `;
      const result = validateSqlSyntax(sql);
      // MERGE não é suportado pelo node-sql-parser/transactsql
      expect(result.isValid).toBe(false);
      expect(result.errorDetails).toContain('Linha');
    });

    it('não aceita OUTPUT (limitação do parser PEG.js)', () => {
      const sql = `
        DELETE FROM PFUNC
        OUTPUT DELETED.CODFUNC
        WHERE CODFUNC = 1
      `;
      const result = validateSqlSyntax(sql);
      // OUTPUT não é suportado pelo node-sql-parser/transactsql
      expect(result.isValid).toBe(false);
      expect(result.errorDetails).toContain('Linha');
    });
  });

  describe('múltiplas statements', () => {
    it('deve aceitar múltiplas queries separadas por ;', () => {
      const sql = `
        SELECT CODFUNC, NOME FROM PFUNC;
        SELECT CODFUNC, NOME FROM PFUNC WHERE CODFUNC = 1;
      `;
      const result = validateSqlSyntax(sql);
      expect(result.isValid).toBe(true);
    });
  });

  describe('erros de sintaxe', () => {
    it('deve capturar erro com linha e coluna', () => {
      const result = validateSqlSyntax('SELECT * FROMR PFUNC');
      expect(result.isValid).toBe(false);
      expect(result.errorLine).toBeGreaterThanOrEqual(1);
      expect(result.errorColumn).toBeGreaterThanOrEqual(1);
    });

    it('deve capturar coluna inexistente semanticamente mas válida sintaticamente', () => {
      // O validador só verifica sintaxe, não semântica
      const result = validateSqlSyntax('SELECT COLUNA_INEXISTENTE FROM PFUNC');
      expect(result.isValid).toBe(true);
    });
  });
});
