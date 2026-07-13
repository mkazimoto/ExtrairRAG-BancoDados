---
name: gerar-consulta-sql
description: 'Gera consultas SQL T-SQL otimizadas para o ERP RM TOTVS. Use quando: construir queries de análise de dados, filtrar por regras de negócio, juntar múltiplas tabelas, gerar relatórios do RM.'
---

# Gerar Consulta SQL

## Quando usar
- Construir queries de análise de dados do ERP RM
- Filtrar dados por regras de negócio específicas
- Juntar múltiplas tabelas com relacionamentos complexos
- Gerar relatórios otimizados
- Validar sintaxe T-SQL antes de executar

## Pré-requisitos
- Conhecimento das tabelas envolvidas
- Entender as colunas e seus tipos
- Ter as regras de negócio definidas

## Processo de Geração

### 1. Definir o Objetivo
- Que dados você precisa?
- Quais filtros aplicar?
- Qual é o resultado esperado?

### 2. Identificar as Tabelas
```sql
-- Use a ferramenta `totvs_search_tables` para encontrar:
-- Busque por palavra-chave relevante
-- Ex: "funcionario", "folha", "evento"
```

### 3. Consultar o Schema
```sql
-- Use `totvs_get_table_schema` para cada tabela:
-- Verifique colunas, tipos de dados, PKs e FKs
```

### 4. Consultar Regras de Negócio
```sql
-- Use `totvs_get_table_rules` para valores específicos:
-- Entenda enumerações, códigos e valores válidos
```

### 5. Construir a Query T-SQL

#### Regras Obrigatórias
- ✅ **Sempre qualifique colunas** com alias
- ✅ **Use (NOLOCK)** para leitura
- ✅ **Filtre CODCOLIGADA** quando existir
- ✅ **Nunca use SELECT \***
- ✅ **Use INNER JOIN** em vez de subconsultas
- ✅ **Valide T-SQL** com `totvs_validate_sql`

#### Template Básico
```sql
SELECT 
  T1.COLUNA1,
  T1.COLUNA2,
  T2.COLUNA3,
  COUNT(*) AS TOTAL
FROM TABELA1 T1 (NOLOCK)
INNER JOIN TABELA2 T2 (NOLOCK) 
  ON T1.ID = T2.T1_ID
WHERE T1.CODCOLIGADA = 1
  AND T1.DATAEVENTO >= '2024-01-01'
GROUP BY T1.COLUNA1, T1.COLUNA2, T2.COLUNA3
ORDER BY T1.COLUNA1
```

## Exemplo Prático

### Objetivo
Listar todos os funcionários com seus últimos 10 eventos de ponto registrados

### Passo 1: Identificar Tabelas
```
PFUNC - Funcionários
AEVENTOCALCULADO - Eventos de ponto
```

### Passo 2: Consultar Schema
- PFUNC: CODCOLIGADA, CHAPA, NOMEFUNC
- AEVENTOCALCULADO: CODCOLIGADA, CHAPA, IDEVENT, DESCRICAO, DATA

### Passo 3: Query Gerada
```sql
SELECT TOP 10
  F.CHAPA,
  F.NOMEFUNC,
  E.IDEVENT,
  E.DESCRICAO,
  E.DATA
FROM PFUNC F (NOLOCK)
INNER JOIN AEVENTOCALCULADO E (NOLOCK)
  ON F.CODCOLIGADA = E.CODCOLIGADA
  AND F.CHAPA = E.CHAPA
WHERE F.CODCOLIGADA = 1
  AND E.DATA >= DATEADD(DAY, -30, GETDATE())
ORDER BY E.DATA DESC, F.CHAPA
```

### Passo 4: Validar
```sql
-- Use: totvs_validate_sql
-- Resultado: Sintaxe T-SQL válida ✓
```

## Otimizações Comuns

### Filtros de Data
```sql
WHERE E.DATA >= CONVERT(DATE, '2024-01-01')
  AND E.DATA < CONVERT(DATE, '2024-12-31')
```

### Agregações
```sql
GROUP BY F.CHAPA, F.NOMEFUNC, MONTH(E.DATA)
HAVING COUNT(*) > 5
```

### Top com Ties
```sql
SELECT TOP 10 WITH TIES
  F.CHAPA, COUNT(*) AS QTD_EVENTOS
FROM PFUNC F (NOLOCK)
GROUP BY F.CHAPA
ORDER BY QTD_EVENTOS DESC
```

### CTE para Lógica Complexa
```sql
WITH ULTIMOS_EVENTOS AS (
  SELECT 
    E.CHAPA,
    E.DATA,
    ROW_NUMBER() OVER (PARTITION BY E.CHAPA ORDER BY E.DATA DESC) AS RN
  FROM AEVENTOCALCULADO E (NOLOCK)
  WHERE E.CODCOLIGADA = 1
)
SELECT * FROM ULTIMOS_EVENTOS WHERE RN <= 10
```

## Recursos Disponíveis

| Skill | Uso |
|-------|-----|
| `diagrama-relacionamento-tabelas` | Visualizar estrutura |
| `totvs_validate_sql` | Validar sintaxe |
| `cte-recursivo-auto-relacionamento` | Hierarquias em árvore para tabela com autorelacionamento |
| `cte-recursivo-auto-relacionamento-tabela-nn` | Hierarquias em árvore para tabela n:n com autorelacionamento |

