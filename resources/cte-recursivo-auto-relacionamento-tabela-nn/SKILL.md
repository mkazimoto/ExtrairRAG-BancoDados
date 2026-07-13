---
name: cte-recursivo-auto-relacionamento-tabela-nn
description: 'Gera CTE recursiva para relacionamentos N-N com auto-referência via tabela de junção. Use quando: trabalhar com hierarquias muitos-para-muitos, explorar redes com múltiplas conexões, navegar grafos complexos através de tabelas de associação.'
---

# CTE Recursivo - Auto-Relacionamento Tabela N-N

## Quando usar
- Explorar hierarquias de relacionamentos muitos-para-muitos (M2M)
- Navegar redes ou grafos complexos
- Trabalhar com associações transitivas
- Mapear estruturas onde um elemento pode ter múltiplos pais e múltiplos filhos

## Pré-requisitos
- Tabela de junção que referencia a mesma tabela (2 FKs para a mesma tabela)
- Chaves primárias bem definidas
- Estrutura de dados de grafo/rede

## Padrão de Consulta

### 1. Identificar a Tabela de Junção
```sql
-- Encontre a tabela que possui duas FKs para a mesma tabela
-- Exemplo: TABELA_ASSOCIACAO com COL_ID_ORIGEM e COL_ID_DESTINO
```

### 2. Construir a CTE Recursiva N-N
```sql
WITH HIERARQUIA_NN AS (
  -- Âncora: pontos de entrada (nós iniciais)
  SELECT 
    T.COL_PK AS ID_ORIGEM,
    TJ.COL_ID_DESTINO AS ID_DESTINO,
    T.COL_DESCRICAO AS DESC_ORIGEM,
    T2.COL_DESCRICAO AS DESC_DESTINO,
    1 AS NIVEL,
    CAST(T.COL_PK AS VARCHAR(MAX)) AS CAMINHO
  FROM <TABELA> T (NOLOCK)
  JOIN <TABELA_JUNACAO> TJ (NOLOCK) ON T.COL_PK = TJ.COL_ID_ORIGEM
  JOIN <TABELA> T2 (NOLOCK) ON TJ.COL_ID_DESTINO = T2.COL_PK
  WHERE T.COL_PK = <ID_INICIAL>
  
  UNION ALL
  
  -- Recursão: seguir as conexões
  SELECT 
    H.ID_ORIGEM,
    TJ.COL_ID_DESTINO,
    H.DESC_ORIGEM,
    T2.COL_DESCRICAO,
    H.NIVEL + 1,
    CAST(H.CAMINHO + ',' + CAST(TJ.COL_ID_DESTINO AS VARCHAR) AS VARCHAR(MAX))
  FROM HIERARQUIA_NN H
  JOIN <TABELA_JUNACAO> TJ (NOLOCK) ON H.ID_DESTINO = TJ.COL_ID_ORIGEM
  JOIN <TABELA> T2 (NOLOCK) ON TJ.COL_ID_DESTINO = T2.COL_PK
  WHERE H.NIVEL < 20  -- Limite de profundidade
    AND H.CAMINHO NOT LIKE '%,' + CAST(TJ.COL_ID_DESTINO AS VARCHAR) + ',%'  -- Evitar ciclos
)
SELECT * FROM HIERARQUIA_NN
ORDER BY NIVEL, ID_DESTINO
```

## Exemplo Prático

Para relacionamento de projetos com dependências (projeto A depende de projeto B):

```sql
WITH DEPENDENCIAS_PROJETO AS (
  -- Âncora: projeto inicial
  SELECT 
    P.CODPROJETO AS PROJETO_ORIGEM,
    PD.CODPROJETO_DEPENDE AS PROJETO_DESTINO,
    P.NOMEPROJETO AS DESC_ORIGEM,
    P2.NOMEPROJETO AS DESC_DESTINO,
    1 AS NIVEL,
    CAST(P.CODPROJETO AS VARCHAR(MAX)) AS CAMINHO
  FROM GPROJETO P (NOLOCK)
  JOIN GPROJETODEPENDE PD (NOLOCK) ON P.CODPROJETO = PD.CODPROJETO
  JOIN GPROJETO P2 (NOLOCK) ON PD.CODPROJETO_DEPENDE = P2.CODPROJETO
  WHERE P.CODPROJETO = 'PROJ001'
  
  UNION ALL
  
  -- Recursão: explorar dependências transitivas
  SELECT 
    D.PROJETO_ORIGEM,
    PD.CODPROJETO_DEPENDE,
    D.DESC_ORIGEM,
    P2.NOMEPROJETO,
    D.NIVEL + 1,
    CAST(D.CAMINHO + ',' + CAST(PD.CODPROJETO_DEPENDE AS VARCHAR) AS VARCHAR(MAX))
  FROM DEPENDENCIAS_PROJETO D
  JOIN GPROJETODEPENDE PD (NOLOCK) ON D.PROJETO_DESTINO = PD.CODPROJETO
  JOIN GPROJETO P2 (NOLOCK) ON PD.CODPROJETO_DEPENDE = P2.CODPROJETO
  WHERE D.NIVEL < 20
    AND D.CAMINHO NOT LIKE '%,' + CAST(PD.CODPROJETO_DEPENDE AS VARCHAR) + ',%'
)
SELECT 
  REPLICATE('  ', NIVEL - 1) + DESC_DESTINO AS HIERARQUIA,
  PROJETO_DESTINO,
  NIVEL,
  CAMINHO
FROM DEPENDENCIAS_PROJETO
ORDER BY NIVEL, PROJETO_DESTINO
```

## Considerar
- **Evitar ciclos**: Monitorar CAMINHO para detectar referências circulares
- **Limite de profundidade**: Definir limite de recursão para proteger performance
- **Performance**: Índices em FKs são críticos para tabelas grandes
- **Usar (NOLOCK)**: Em consultas de leitura
- **CODCOLIGADA**: Incluir filtro se a tabela ou tabela de junção tiver esta coluna
