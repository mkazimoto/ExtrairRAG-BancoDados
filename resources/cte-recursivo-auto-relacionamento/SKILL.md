---
name: cte-recursivo-auto-relacionamento
description: 'Gera CTE recursiva para consultas de auto-relacionamento em hierarquias de dados. Use quando: explorar hierarquias em árvore de uma tabela consigo mesma, navegar estruturas organizacionais ou departamentais, gerar consultas recursivas para relacionamentos parent-child.'
---

# CTE Recursivo - Auto-Relacionamento

## Quando usar
- Trabalhar com hierarquias de dados em uma única tabela
- Explorar estruturas organizacionais (departamentos, gerências)
- Navegar relacionamentos parent-child recursivos
- Listar todos os níveis de uma hierarquia

## Pré-requisitos
- Identificar a coluna de chave primária (PK)
- Identificar a coluna de referência para nível superior (FK de auto-relacionamento)
- Estrutura de dados hierárquica com relacionamento reflexivo

## Padrão de Consulta

### 1. Identificar o Auto-Relacionamento
```sql
-- Encontre a FK que referencia a mesma tabela
SELECT COL_PK, COL_FK_SUPERIOR 
FROM <TABELA>
WHERE COL_FK_SUPERIOR IS NOT NULL
```

### 2. Construir a CTE Recursiva
```sql
WITH HIERARQUIA AS (
  -- Âncora: elementos de nível superior (raiz)
  SELECT 
    COL_PK,
    COL_FK_SUPERIOR,
    COL_DESCRICAO,
    1 AS NIVEL
  FROM <TABELA> (NOLOCK)
  WHERE COL_FK_SUPERIOR IS NULL
  
  UNION ALL
  
  -- Recursão: todos os filhos
  SELECT 
    T.COL_PK,
    T.COL_FK_SUPERIOR,
    T.COL_DESCRICAO,
    H.NIVEL + 1
  FROM <TABELA> T (NOLOCK)
  JOIN HIERARQUIA H ON T.COL_FK_SUPERIOR = H.COL_PK
  WHERE H.NIVEL < 20  -- Limite de profundidade
)
SELECT * FROM HIERARQUIA
ORDER BY NIVEL, COL_PK
```

## Exemplo Prático

Para a tabela de departamentos com auto-relacionamento:

```sql
WITH HIERARQUIA_DEPTO AS (
  SELECT 
    CODDEPTO,
    CODDEPTO_SUPERIOR,
    NOMEDEPTO,
    1 AS NIVEL
  FROM ADEPTO (NOLOCK)
  WHERE CODDEPTO_SUPERIOR IS NULL
  
  UNION ALL
  
  SELECT 
    D.CODDEPTO,
    D.CODDEPTO_SUPERIOR,
    D.NOMEDEPTO,
    H.NIVEL + 1
  FROM ADEPTO D (NOLOCK)
  JOIN HIERARQUIA_DEPTO H ON D.CODDEPTO_SUPERIOR = H.CODDEPTO
  WHERE H.NIVEL < 20
)
SELECT 
  REPLICATE('  ', NIVEL - 1) + NOMEDEPTO AS HIERARQUIA,
  CODDEPTO,
  NIVEL
FROM HIERARQUIA_DEPTO
ORDER BY NIVEL, CODDEPTO
```

## Considerar
- Definir limite de profundidade para evitar loops infinitos
- Usar (NOLOCK) em consultas de leitura
- Sempre incluir filtro CODCOLIGADA se aplicável
- Testar com pequeno volume antes de executar em produção
