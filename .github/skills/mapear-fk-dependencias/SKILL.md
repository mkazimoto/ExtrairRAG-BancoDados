---
name: mapear-fk-dependencias
description: 'Mapeia tabelas dependentes de uma tabela do ERP RM TOTVS no arquivo mapeamento-regras.md. Use quando: precisar adicionar relações de FK entrada de uma tabela ao mapeamento, identificar tabelas filhas que referenciam uma tabela pai, enriquecer o mapeamento-regras.md com novas dependências.'
---

# Mapear FK Dependências no mapeamento-regras.md

## Quando usar
- Adicionar tabelas dependentes (FK de entrada) de uma tabela ao `mapeamento-regras.md`
- Identificar quais tabelas referenciam uma tabela específica via chave estrangeira
- Enriquecer o arquivo de mapeamento com novas relações

## Pré-requisitos
- O arquivo de documentação da tabela existe em `docs/db/tables/<TABELA>.md`
- O arquivo `regras-script-extract-rag/mapeamento-regras.md` existe

## Procedimento

### 1. Consultar a documentação da tabela
Leia o arquivo `docs/db/tables/<TABELA>.md` e localize a seção **"Chaves Estrangeiras de Entrada (outras tabelas → esta)"**.

### 2. Interpretar as FKs de entrada
Para cada FK de entrada, extraia:
- **Tabela dependente** (a que referencia)
- **Coluna(s)** na tabela dependente
- **Coluna(s)** na tabela atual

### 3. Localizar o ponto de inserção no mapeamento-regras.md
Abra `regras-script-extract-rag/mapeamento-regras.md` e encontre onde inserir cada entrada, mantendo a **ordem alfabética** dos nomes das tabelas (seção `# <TABELA>`).

### 4. Inserir a entrada no formato padrão
Para cada tabela dependente que ainda não exista no mapeamento, adicione:

```markdown
# <TABELA_DEPENDENTE>

## <COLUNA_FK>

| Tabela | Codigo | Descricao |
| ------ | ------ | --------- |
| <TABELA_ORIGEM> | <COLUNA_DESTINO> | DESCRICAO |
```

### 5. Finalizar
Confirme que as entradas foram inseridas nas posições alfabéticas corretas e que o arquivo permanece consistente.

## Exemplo prático

Dado `STIPOALUNO.md` com a FK de entrada:
```
| FKSALUNO_STIPOALUNO | SALUNO | CODCOLIGADA, CODTIPOALUNO | CODCOLIGADA, CODTIPOALUNO |
```

A entrada gerada em `mapeamento-regras.md` é:

```markdown
# SALUNO

## CODTIPOALUNO

| Tabela | Codigo | Descricao |
| ------ | ------ | --------- |
| STIPOALUNO | CODTIPOALUNO | DESCRICAO |
```

## Regras importantes
- A "Tabela" na linha de dados é sempre a **tabela referenciada** (FK de saída), não a dependente
- O "Codigo" é a coluna FK na **tabela dependente**
- Para colunas que usam `CODCOLIGADA` compondo a FK, mapeie apenas a coluna semântica (ex: `CODTIPOALUNO`)
- Mantenha a **ordem alfabética** das seções `# <TABELA>` no arquivo
- Se a tabela dependente já existir no mapeamento, adicione apenas a nova subseção `## <COLUNA_FK>`
