/** Metadados resumidos de uma tabela — extraídos do db-index.md */
export interface TableSummary {
  name: string;
  description: string;
  module: string;
}

/** Detalhes completos de uma tabela — lidos do arquivo .md individual */
export interface TableDetail {
  name: string;
  description: string;
  primaryKey: string[];
  columns: ColumnInfo[];
  outboundFks: ForeignKey[];
  inboundFks: ForeignKey[];
  rawMarkdown: string;
}

export interface ColumnInfo {
  ordinal: number;
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  description: string;
}

export interface ForeignKey {
  constraint: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

/** Módulos do sistema ERP RM */
export const MODULES: Record<string, string> = {
  '0': 'TOTVS Gestão de Custos',
  A: 'TOTVS Automação de Ponto',
  B: 'TOTVS Avaliação e Pesquisa',
  C: 'TOTVS Gestão Contábil',
  D: 'TOTVS Gestão Fiscal',
  E: 'Ensino Básico',
  F: 'TOTVS Gestão Financeira',
  G: 'TOTVS Inteligência de Negócios',
  H: 'TOTVS Aprovações e Atendimento',
  I: 'TOTVS Gestão Patrimonial',
  K: 'TOTVS Planejamento e Controle da Produção',
  L: 'TOTVS Gestão Bibliotecária',
  M: 'TOTVS Construção e Projetos',
  N: 'TOTVS Manutenção',
  O: 'TOTVS Saúde Hospitais e Clínicas',
  P: 'TOTVS Folha de Pagamento',
  R: 'TOTVS Segurança e Saúde Ocupacional',
  S: 'TOTVS Educacional',
  T: 'TOTVS Gestão de Estoque, Compras e Faturamento',
  U: 'Ensino Superior',
  V: 'TOTVS Gestão de Pessoas',
  W: 'TOTVS Gestão de Conteúdos',
  X: 'TOTVS Incorporação',
  Y: 'TOTVS Controle de Acesso',
};

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}
