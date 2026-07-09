# TOTVS RM MCP Server

MCP (Model Context Protocol) Server para o banco de dados **ERP TOTVS RM**.  
Permite que modelos de linguagem consultem o esquema do banco e pesquisem tabelas do ERP.

## Ferramentas disponíveis

| Ferramenta | Descrição |
|---|---|
| `totvs_search_tables` | Busca tabelas por nome ou descrição |
| `totvs_get_table_schema` | Retorna colunas, PKs e FKs de uma tabela |
| `totvs_list_modules` | Lista todos os módulos e prefixos do ERP |
| `totvs_get_db_index` | Retorna o índice completo de todas as tabelas |
| `totvs_validate_sql` | Valida a sintaxe T-SQL sem executar a consulta |

## Transportes suportados

O servidor pode operar em **dois modos de transporte**:

| Modo | Variável | Descrição |
|---|---|---|
| **HTTP** (StreamableHTTP) | `MCP_TRANSPORT=http` (padrão) | Comunicação via requisições HTTP — suporta múltiplas sessões concorrentes |
| **stdio** | `MCP_TRANSPORT=stdio` | Comunicação via stdin/stdout — ideal para integração direta com clientes MCP |

## Pré-requisitos

- Node.js 18+
- Acesso ao SQL Server do TOTVS RM

## Configuração

Configure as variáveis de ambiente antes de executar. 
Você pode usar um arquivo `.env` ou definir diretamente na configuração do cliente MCP:

| Variável | Padrão | Descrição |
|---|---|---|
| `MCP_TRANSPORT` | `http` | Modo de transporte: `http` (StreamableHTTP) ou `stdio` |
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
MCP_TRANSPORT = "stdio"
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

### Modo HTTP (padrão)
```bash
# Via variável de ambiente
MCP_TRANSPORT=http npm run start

# Ou apenas (http é o padrão)
npm run start
```

### Modo stdio
```bash
# Defina MCP_TRANSPORT=stdio no .env ou diretamente
MCP_TRANSPORT=stdio npm run start
```

> **Nota:** No modo stdio, as mensagens de log são escritas em **stderr** para não interferir no protocolo MCP (que usa stdout).

## Configuração no VS Code (GitHub Copilot)

### Via HTTP (StreamableHTTP)

Adicione ao seu arquivo `.vscode/mcp.json` ou `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "totvs-rm-database-mcp-server": {
        "type": "http",
        "url": "http://localhost:3000/mcp",
        "headers": {
          "Authorization": "Bearer xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        }
      }
    }
  }
}
```

### Via stdio

```json
{
  "mcp": {
    "servers": {
      "totvs-rm-database-mcp-server": {
        "type": "stdio",
        "command": "node",
        "args": ["dist/index.js"],
        "env": {
          "MCP_TRANSPORT": "stdio",
          "MCP_API_KEY": " xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
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
