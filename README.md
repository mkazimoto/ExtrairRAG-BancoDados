# TOTVS RM MCP Server

MCP (Model Context Protocol) Server para o banco de dados **ERP TOTVS RM**.  
Permite que modelos de linguagem consultem o esquema do banco, pesquisem tabelas e executem queries T-SQL de leitura.

## Ferramentas disponíveis

| Ferramenta | Descrição |
|---|---|
| `totvs_search_tables` | Busca tabelas por nome ou descrição |
| `totvs_get_table_schema` | Retorna colunas, PKs e FKs de uma tabela |
| `totvs_list_tables_by_module` | Lista tabelas de um módulo específico (ex: P=Folha, F=Financeiro) |
| `totvs_list_modules` | Lista todos os módulos e prefixos do ERP |
| `totvs_get_db_index` | Retorna o índice completo de todas as tabelas |
| `totvs_execute_query` | Executa SELECT T-SQL no banco (somente leitura) |
| `totvs_suggest_query` | Gera modelo de query para uma tabela |

## Pré-requisitos

- Node.js 18+
- Acesso ao SQL Server do TOTVS RM
- Documentação extraída em `docs/db/tables/` (via `npm run extract` na raiz do projeto)

## Instalação

```bash
cd mcp-server
npm install
npm run build
```

## Configuração

Configure as variáveis de ambiente antes de executar. Você pode usar um arquivo `.env` ou
definir diretamente na configuração do cliente MCP:

| Variável | Padrão | Descrição |
|---|---|---|
| `DB_SERVER` | `localhost` | Endereço do SQL Server |
| `DB_PORT` | `1433` | Porta do SQL Server |
| `DB_DATABASE` | *(obrigatório)* | Nome do banco de dados RM |
| `DB_USER` | *(vazio = Windows Auth)* | Usuário SQL |
| `DB_PASSWORD` | *(vazio)* | Senha SQL |
| `DB_TRUST_CERT` | `true` | Confiar no certificado SSL |
| `DB_REQUEST_TIMEOUT` | `30000` | Timeout de requisição em ms |

## Configuração no VS Code (GitHub Copilot)

Adicione ao seu arquivo `.vscode/mcp.json` ou `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "totvs-rm": {
        "type": "stdio",
        "command": "node",
        "args": ["C:/GIT/ExtrairRAG-BancoDados/mcp-server/dist/index.js"],
        "env": {
          "DB_SERVER": "SEU_SERVIDOR",
          "DB_DATABASE": "NOME_DO_BANCO",
          "DB_USER": "rm",
          "DB_PASSWORD": "SUA_SENHA"
        }
      }
    }
  }
}
```

## Uso com Claude Desktop

Adicione ao `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "totvs-rm": {
      "command": "node",
      "args": ["C:/GIT/ExtrairRAG-BancoDados/mcp-server/dist/index.js"],
      "env": {
        "DB_SERVER": "SEU_SERVIDOR",
        "DB_DATABASE": "NOME_DO_BANCO",
        "DB_USER": "rm",
        "DB_PASSWORD": "SUA_SENHA"
      }
    }
  }
}
```

## Segurança

- Apenas queries `SELECT` são executadas — INSERT, UPDATE, DELETE, DROP, EXEC e outros comandos destrutivos são **bloqueados** na camada da aplicação.
- Parâmetros de query são passados via prepared statements (`mssql` input params) para prevenir SQL Injection.
- A conexão com o banco é estabelecida apenas quando a ferramenta `totvs_execute_query` ou `totvs_suggest_query` é chamada.
- Ferramentas de documentação (schema, busca de tabelas) funcionam **sem conexão com o banco**, lendo apenas os arquivos `.md` locais.

## Estrutura do Projeto

```
mcp-server/
├── src/
│   ├── index.ts              # Entry point — inicializa o servidor MCP (stdio)
│   ├── types.ts              # Interfaces e constantes (módulos ERP, ResponseFormat)
│   ├── services/
│   │   ├── db-client.ts      # Cliente SQL Server (mssql) — somente leitura
│   │   └── docs-reader.ts    # Leitor de documentação .md das tabelas
│   └── tools/
│       ├── doc-tools.ts      # Ferramentas de schema e documentação
│       └── query-tools.ts    # Ferramentas de execução de SQL
├── dist/                     # Arquivos compilados (gerados pelo build)
├── package.json
└── tsconfig.json
```
