# TOTVS RM MCP Server

MCP (Model Context Protocol) Server para o banco de dados **ERP TOTVS RM**.  
Permite que modelos de linguagem consultem o esquema do banco e pesquisem tabelas do ERP.

## Ferramentas disponíveis

| Ferramenta | Descrição |
|---|---|
| `totvs_search_tables` | Busca tabelas por nome ou descrição |
| `totvs_get_table_schema` | Retorna colunas, PKs e FKs de uma tabela |
| `totvs_list_tables_by_module` | Lista tabelas de um módulo específico (ex: P=Folha, F=Financeiro) |
| `totvs_list_modules` | Lista todos os módulos e prefixos do ERP |
| `totvs_get_db_index` | Retorna o índice completo de todas as tabelas |

## Pré-requisitos

- Node.js 18+
- Acesso ao SQL Server do TOTVS RM

## Configuração

Configure as variáveis de ambiente antes de executar. 
Você pode usar um arquivo `.env` ou definir diretamente na configuração do cliente MCP:

| Variável | Padrão | Descrição |
|---|---|---|
| `DB_SERVER` | `localhost` | Endereço do SQL Server |
| `DB_PORT` | `1433` | Porta do SQL Server |
| `DB_DATABASE` | *(obrigatório)* | Nome do banco de dados RM |
| `DB_USER` | *(vazio = Windows Auth)* | Usuário SQL |
| `DB_PASSWORD` | *(vazio)* | Senha SQL |
| `DB_TRUST_CERT` | `true` | Confiar no certificado SSL |
| `DB_REQUEST_TIMEOUT` | `30000` | Timeout de requisição em ms |

## Extrair Documentação do Banco de Dados

- Documentação extraída em `docs/db/tables/` (via `npm run extract` na raiz do projeto)

### Crie um arquivo .env na raiz com a configuração
```bash
DB_SERVER = "localhost"
DB_DATABASE = "EXEMPLO1212606"
DB_USER = "rm"
DB_PASSWORD = "SENHA"
```

### Execute o script para conectar com o banco de dados e gerar a documentação de arquivos .md
```bash
npm run extract
```

## Instalação do MCP

```bash
npm install
npm run build
```

## Iniciar o servidor MCP
```bash
npm run start
```

## Configuração no VS Code (GitHub Copilot)

Adicione ao seu arquivo `.vscode/mcp.json` ou `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "totvs-rm-database-mcp-server": {
        "type": "http",
        "url": "http://localhost:3000/mcp",
        "headers": {
          "Authorization": "Bearer ed931c92-33db-4fdb-aa86-c78a236bf40e"
        }
      }
    }
  }
}
```

## Segurança

- Todas as ferramentas funcionam **sem conexão com o banco**, lendo apenas os arquivos `.md` locais.

## Estrutura do Projeto

```
ExtrairRAG-BancoDados
├── src/
│   ├── index.ts              # Entry point — inicializa o servidor MCP (stdio)
│   ├── types.ts              # Interfaces e constantes (módulos ERP, ResponseFormat)
│   ├── services/
│   │   └── docs-reader.ts    # Leitor de documentação .md das tabelas
│   └── tools/
│       └── doc-tools.ts      # Ferramentas de schema e documentação
├── dist/                     # Arquivos compilados (gerados pelo build)
├── package.json
└── tsconfig.json
```
