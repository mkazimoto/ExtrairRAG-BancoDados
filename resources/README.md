# Resources - TOTVS RM Database Skills

Documentação de recursos (skills) para desenvolvimento com banco de dados **ERP TOTVS RM**. 

Cada resource fornece padrões, exemplos e melhores práticas para trabalhar com dados do RM.

## 📚 Resources Disponíveis

### 1. **Gerar Consulta SQL**
`resources/gerar-consulta-sql/`

Guia para gerar queries SQL T-SQL otimizadas para o RM.

**Use quando:**
- Construir queries de análise de dados
- Filtrar dados por regras de negócio
- Juntar múltiplas tabelas
- Gerar relatórios otimizados

**Exemplo:** Relatórios de eventos de ponto, análise de folha de pagamento

---

### 2. **CTE Recursivo - Auto-Relacionamento**
`resources/cte-recursivo-auto-relacionamento/`

Gera CTEs recursivas para explorar hierarquias em uma tabela.

**Use quando:**
- Trabalhar com estruturas organizacionais (departamentos, gerências)
- Navegar relacionamentos parent-child
- Listar todos os níveis de uma hierarquia

**Exemplo:** Hierarquia de departamentos, categorias de produto

---

### 3. **CTE Recursivo - Auto-Relacionamento Tabela N-N**
`resources/cte-recursivo-auto-relacionamento-tabela-nn/`

Gera CTEs recursivas para relacionamentos muitos-para-muitos com auto-referência.

**Use quando:**
- Explorar redes ou grafos complexos
- Trabalhar com associações transitivas
- Mapear relacionamentos onde um elemento tem múltiplos pais/filhos

**Exemplo:** Dependências de projetos, estruturas de permissões

---

### 4. **Diagrama de Relacionamento de Tabelas**
`resources/diagrama-relacionamento-tabelas/`

Gera diagramas Mermaid de relacionamentos entre tabelas.

**Use quando:**
- Visualizar dependências entre tabelas
- Documentar fluxos de dados
- Entender estrutura de relacionamentos
- Mapear impacto de mudanças

**Exemplo:** Diagramas ER para módulos de RH, folha de pagamento

---

## 🚀 Como Usar

Cada resource segue um padrão consistente:

1. **Identificação do Quando Usar** - Casos de aplicação específicos
2. **Pré-requisitos** - Informações necessárias
3. **Padrão de Consulta/Diagrama** - Template genérico
4. **Exemplo Prático** - Caso real do RM
5. **Considerações** - Otimizações e cuidados

## 📋 Estrutura dos Arquivos

Cada resource contém:
- `SKILL.md` - Documentação completa com exemplos

## 🔗 Integração com Ferramentas

Estas resources são complementares às ferramentas do MCP Server:

| Ferramenta | Resource Relacionada |
|-----------|---------------------|
| `totvs_search_tables` | `gerar-consulta-sql` |
| `totvs_get_table_schema` | `gerar-consulta-sql` |
| `totvs_get_table_rules` | `gerar-consulta-sql` |
| `totvs_validate_sql` | `gerar-consulta-sql` |

## 🎯 Fluxo Recomendado

### Para uma Nova Consulta SQL:
1. Use `totvs_search_tables` para encontrar as tabelas
2. Use `totvs_get_table_schema` para entender estrutura
3. Use `totvs_get_table_rules` para valores válidos
4. Siga o padrão em `gerar-consulta-sql`
5. Valide com `totvs_validate_sql`

### Para Entender Relacionamentos:
1. Aplique em queries via `gerar-consulta-sql`
2. Use `diagrama-relacionamento-tabelas` para visualizar
3. Use `cte-recursivo-auto-relacionamento` se for hierarquia com autorelacionamento
4. Use `cte-recursivo-auto-relacionamento-tabela-nn` se for hierarquia com autorelacionamento e tabela n:n


## ⚙️ Regras Globais do RM

- ✅ Sempre use T-SQL (SQL Server)
- ✅ Nunca use `SELECT *`
- ✅ Qualifique colunas com alias
- ✅ Use `(NOLOCK)` em leitura
- ✅ Filtre `CODCOLIGADA` quando existir
- ✅ Prefira `INNER JOIN` sobre subconsultas

## 📞 Suporte

Para usar estas resources:
1. Identifique qual resource se aplica à sua tarefa
2. Leia o arquivo `SKILL.md` correspondente
3. Siga o padrão e adapte ao seu caso específico
4. Use as ferramentas do MCP Server para complementar
