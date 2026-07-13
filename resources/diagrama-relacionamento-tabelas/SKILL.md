---
name: diagrama-relacionamento-tabelas
description: 'Gera diagramas Mermaid dos relacionamentos entre tabelas do ERP RM. Use quando: visualizar dependências entre tabelas, documentar fluxos de dados, entender estrutura de relacionamentos, mapear impacto de mudanças em FK.'
---

# Diagrama de Relacionamento de Tabelas

## Quando usar
- Visualizar a estrutura de relacionamentos entre tabelas
- Documentar fluxos de dados para um conjunto de tabelas
- Entender dependências e impacto de chaves estrangeiras
- Mapear tabelas relacionadas a um domínio específico

## Pré-requisitos
- Identificar as tabelas envolvidas
- Ter acesso à documentação das FK em `docs/db/tables/<TABELA>.md`
- Conhecer a direção dos relacionamentos

## Padrão de Diagrama Mermaid

### 1. Estrutura Básica
```mermaid
erDiagram
  TABELA_A ||--o{ TABELA_B : "referencia"
  TABELA_A ||--|| TABELA_C : "tem"
  TABELA_B }o--|| TABELA_D : "pertence a"
```

### 2. Símbolos de Cardinalidade
| Símbolo | Significado |
|---------|------------|
| `\|\|` | Um para Um (1:1) |
| `o\|` | Zero ou Um (0:1) |
| `\|\{` | Um para Muitos (1:N) |
| `o{` | Zero ou Muitos (0:N) |

### 3. Construir Diagrama a partir de Documentação
1. Ler `docs/db/tables/<TABELA>.md`
2. Identificar seção "Chaves Estrangeiras"
3. Mapear relacionamentos de entrada e saída
4. Desenhar com Mermaid

## Exemplo Prático

Para tabelas de folha de pagamento e recursos humanos:

```mermaid
erDiagram
  PCOLIGADA ||--o{ PFUNC : "tem"
  PFUNC ||--o{ AEVENTOCALCULADO : "gera"
  AEVENTOCALCULADO ||--o{ AEVENTOCALCULADO_DETALHE : "compõe"
  PFUNC ||--o{ ACOMPFUN : "possui"
  ACOMPFUN ||--|| ACOMPFORMULA : "referencia"
  PFUNC ||--o{ AVISOCALCULADO : "gera"
  PFUNC ||--o{ AAVISOCALCULADO : "gera"
```

### Estrutura Detalhada com Atributos

```mermaid
erDiagram
  COLIGADA {
    int CODCOLIGADA PK
    string NOMECOLIGADA
  }
  
  FUNCIONARIO {
    int CODCOLIGADA FK
    int CHAPA PK
    string NOMEFUNC
    date DATAMISSAO
  }
  
  EVENTO {
    int CODCOLIGADA FK
    int CHAPA FK
    int IDEVENT PK
    string DESCRICAO
  }
  
  COLIGADA ||--o{ FUNCIONARIO : "registra"
  FUNCIONARIO ||--o{ EVENTO : "gera"
```

## Dicas de Visualização
- **Agrupar por módulo**: Tabelas com mesmo prefixo (P, A, G, etc.)
- **Direcionar fluxo**: Colocar tabelas pai acima, filhas abaixo
- **Código de cores**: Usar comentários para destacar críticos
- **Simplificar**: Mostrar apenas relacionamentos principais em primeiro nível
- **Detalhar progressivamente**: Criar diagramas para cada subdomínio

## Exportar Diagrama
Mermaid pode ser exportado para:
- PNG/SVG: Via VS Code preview
- URL: Usar [Mermaid Live Editor](https://mermaid.live)
- Markdown: Incluir fenced code block com \`\`\`mermaid
