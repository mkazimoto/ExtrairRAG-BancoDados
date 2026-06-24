# Tabelas Desativadas — Extrator RAG

Este documento lista as tabelas do banco de dados ERP TOTVS RM que **não devem ser documentadas** pelo script `extract-rag.mjs`.

Mesmo que estas tabelas possuam descrição no GDIC (dicionário de dados), elas devem ser ignoradas por se tratarem de:

- **Cópias de segurança** (`_BKP`, `_BKPTIN`)
- **Tabelas antigas substituídas** (`_OLD`)
- **Tabelas temporárias** (`_TEMP`)

---

## Critérios de Exclusão

### 1. Cópias de Segurança (`_BKP`)

Tabelas criadas como backup de tabelas originais. Não representam dados de negócio.

| Tabela | Descrição | Módulo |
|--------|-----------|--------|
| `FLANVINCULO_BKP` | Backup da FLANVINCULO | Financeiro |
| `FRELLANPAI_BKPTIN` | Backup pontual da FRELLANPAI | Financeiro |
| `SZAGENDACIRURGICAMOVIBKP` | Backup da SZAGENDACIRURGICAMOVI | Saúde |
| `SZAPRAZAMENTOBKP` | Backup da SZAPRAZAMENTO | Saúde |
| `SZATENDMATMEDBKP` | Backup da SZATENDMATMED | Saúde |
| `SZCINCOCERTOSCHECKBKP` | Backup da SZCINCOCERTOSCHECK | Saúde |
| `SZCINCOCERTOSCHECKINGTIMESBKP` | Backup da SZCINCOCERTOSCHECKINGTIMES | Saúde |
| `SZCINCOCERTOSGRUPOBKP` | Backup da SZCINCOCERTOSGRUPO | Saúde |
| `SZESTOQUEPACIENTEBKP` | Backup da SZESTOQUEPACIENTE | Saúde |
| `SZITENSCIRURGIABKP` | Backup da SZITENSCIRURGIA | Saúde |
| `SZMOVIESTMANBKP` | Backup da SZMOVIESTMAN | Saúde |
| `SZMOVIESTOQUEBKP` | Backup da SZMOVIESTOQUE | Saúde |
| `SZMOVIESTOQUEITEMBKP` | Backup da SZMOVIESTOQUEITEM | Saúde |
| `SZMOVITMAPRAZBKP` | Backup da SZMOVITMAPRAZ | Saúde |
| `SZMOVITMAPRAZNAPLICBKP` | Backup da SZMOVITMAPRAZNAPLIC | Saúde |
| `SZREGINFCIRURGIAFOLHASALABKP` | Backup da SZREGINFCIRURGIAFOLHASALA | Saúde |
| `SZRELEXAMEMATMEDCONTABKP` | Backup da SZRELEXAMEMATMEDCONTA | Saúde |
| `SZRELEXAMEMOVIESTOQUEBKP` | Backup da SZRELEXAMEMOVIESTOQUE | Saúde |
| `SZREQUISICAOREGINFBKP` | Backup da SZREQUISICAOREGINF | Saúde |

### 2. Tabelas Antigas/Substituídas (`_OLD`)

Tabelas mantidas para compatibilidade, mas substituídas por versões mais recentes.

| Tabela | Descrição | Módulo |
|--------|-----------|--------|
| `MCONTROLEREVISAO_OLD` | Versão antiga do controle de revisão | Construção/Projetos |
| `MITEMPEDIDOMAT_OLD` | Versão antiga do item de pedido de material | Construção/Projetos |

### 3. Tabelas Temporárias (`_TEMP`)

Tabelas de processamento temporário, sem valor semântico permanente.

| Tabela | Descrição | Módulo |
|--------|-----------|--------|
| `GUPGATUALIZACAOTEMP` | Atualização temporária de pacotes | Inteligência de Negócios |
| `MPERIODO_TEMP` | Períodos virtuais do cronograma | Construção/Projetos |
| `PFCONTABILIZACAOTEMP` | Contabilização temporária | Folha de Pagamento |
| `PFCONTRATOTEMPCONSIG` | Contrato temporário de consignado | Folha de Pagamento |
| `PFMOVTEMP` | Movimentação temporária | Folha de Pagamento |
| `PFMOVTEMPCONSIG` | Movimentação temporária de consignado | Folha de Pagamento |
| `SZACAOTEMP` | Ação temporária | Saúde |
| `SZCONTROLTEMP` | Controle temporário | Saúde |
| `VAGENTESNOCIVOSTEMP` | Agentes nocivos temporários | Gestão de Pessoas |
| `VREQRATEIOCCTEMP` | Rateio temporário de centro de custo | Gestão de Pessoas |

### 4. Outras Tabelas

Tabelas que não se enquadram nos padrões anteriores, mas que foram desativadas por decisão técnica ou de negócio.

| Tabela | Descrição | Módulo |
|--------|-----------|--------|
| `XVENDAPESSOA` | Cadastro de Pessoas do Contrato de Venda | Incorporação |
| `FHISTVALORESINTEGRACAO_BKPTIN` | | |   
| `FLANBAIXAINTEGRACAO_BKPTIN` | | |   
| `FLANBAIXARATCCU_BKPTIN` | | |   
| `FLANBAIXARATDEP_BKPTIN` | | |   
| `FLANBAIXA_BKPTIN` | | |   
| `FLANBOLETOBAIXA_BKPTIN` | | |   
| `FLANBOLETO_BKPTIN` | | |   
| `FLANINTEGRACAO_BKPTIN` | | |   
| `FLANRATCCU_BKPTIN` | | |   
| `FLANRATDEP_BKPTIN` | | |   
| `FLANREMESSA_BKPTIN` | | |   
| `FLAN_BKPTIN` | | |   
| `FLOGVALORES_BKPTIN` | | |   
| `FRELLAN_BKPTIN` | | |   
| `FRETORNOBANCARIOITEM_BKPTIN` | | |   
| `SZMOVIESTOQUEPROCBKP` | | |   
| `GUSRPERFIL_BACKUP` | | |   
| `TTRBITMAGRUPADO_BACKUP` | | |   
| `IBEM_OLD` | | |   
| `IGRPCONT_OLD` | | |   
| `ILEASING_OLD` | | |   
| `IMTBX_OLD` | | |   
| `IOCORHISTCOMP_OLD` | | |   
| `IOCORHIST_OLD` | | |   
| `IOCOR_OLD` | | |   
| `IRATEIODEPREC_OLD` | | |   
| `IRAZAOFILIAL_OLD` | | |   
| `IRAZAOGERENCIAL_OLD` | | |   
| `IRAZAOHIST_OLD` | | |   
| `IRAZAO_OLD` | | |   
| `PFFERIAS_OLD` | | |   
| `PFHSTFER_OLD` | | |   
| `PFPERFER_OLD` | | |   
| `SLAN_OLD_CODPARCELALAN` | | |   
| `XLOGPARCELACOMPONENTE_OLD1217` | | |   
| `XLOGPARCELAPAGAMENTO_OLD1217` | | |   
| `ZLOGPROCESSOS_OLD` | | |   

---

## Como usar

Este arquivo serve como fonte de verdade para o script `extract-rag.mjs`. Para ativar a exclusão:

1. O script deve ler este arquivo e ignorar as tabelas listadas durante a geração dos `.md`.
2. Tabelas listadas aqui **não devem** ter seus arquivos `.md` gerados ou atualizados.
3. Tabelas já documentadas que forem adicionadas a esta lista devem ter seus arquivos `.md` removidos manualmente.

---

*Última atualização: 2026-06-15*
