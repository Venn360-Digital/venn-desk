import type { Consumo } from '../agente/orcamento.ts'

/**
 * Os tipos comuns da base viva.
 *
 * Moram num arquivo sem lógica para o catálogo de fontes, os extratores, os
 * renderizadores e o sincronizador importarem a mesma coisa sem importar uns
 * aos outros — um ciclo de import aqui faria o Worker carregar o Sonnet para
 * renderizar uma FAQ.
 */

/** O que a sincronização precisa saber do app. Vem de `apps`. */
export interface AppSincronizavel {
    id: string
    slug: string
    nome: string
    /** `Venn360-Digital/venn-saas` */
    repositorio: string
    /** `apps/odontobox360` */
    pastaNoRepositorio: string
}

export type Genero = 'm' | 'f'

/**
 * O vocabulário do nicho, como o `brand.ts` de cada app o declara.
 *
 * Quatro eixos em quatro formas (minúscula/maiúscula × singular/plural), mais o
 * gênero de cada eixo. É isso que faz "Pacientes" no Odontobox ser "Clientes"
 * no Conecta — e é por isso que todo artigo derivado é POR APP.
 */
export interface Vocabulario {
    genero: { organizacao: Genero; pessoa: Genero; profissional: Genero; servico: Genero }
    organizacao: string
    Organizacao: string
    organizacoes: string
    Organizacoes: string
    pessoa: string
    Pessoa: string
    pessoas: string
    Pessoas: string
    profissional: string
    Profissional: string
    profissionais: string
    Profissionais: string
    servico: string
    Servico: string
    servicos: string
    Servicos: string
}

/** As dezesseis formas, sem o gênero. */
export type PalavraDoVocabulario = Exclude<keyof Vocabulario, 'genero'>

export const PALAVRAS_DO_VOCABULARIO: PalavraDoVocabulario[] = [
    'organizacao', 'Organizacao', 'organizacoes', 'Organizacoes',
    'pessoa', 'Pessoa', 'pessoas', 'Pessoas',
    'profissional', 'Profissional', 'profissionais', 'Profissionais',
    'servico', 'Servico', 'servicos', 'Servicos',
]

/** O que todo renderizador recebe além dos dados extraídos. */
export interface ContextoDeRenderizacao {
    app: AppSincronizavel
    vocabulario: Vocabulario
    /** O commit de `main` desta sincronização. */
    commit: string
    agora: Date
}

/** Um artigo pronto para o escopo gravar. `chave` é estável entre rodadas. */
export interface ArtigoRenderizado {
    chave: string
    titulo: string
    corpo: string
    tags: string[]
    /** O JSON de que o corpo saiu. Vai em `kb_articles.dados` (convertido na gravação). */
    dados: unknown
    /** Os caminhos no repositório de onde este artigo veio. */
    caminhos: string[]
}

/** O resultado de um extrator: os dados e como foram obtidos. */
export interface Extracao<D> {
    dados: D
    /** `parser` é determinístico; `modelo` passou pelo Sonnet e merece aviso. */
    extraidoPor: 'parser' | 'modelo'
    consumo?: Consumo
}

/**
 * Falha de FORMA: o arquivo não tem o que o extrator espera. Não melhora com
 * repetição — fica registrada na sincronização e o artigo anterior continua no
 * ar com a data antiga.
 */
export class ErroDeExtracao extends Error {
    readonly fonte: string
    /** O que o modelo gastou ANTES de a saída ser recusada. Dinheiro gasto conta. */
    readonly consumo: Consumo | undefined

    constructor(fonte: string, mensagem: string, consumo?: Consumo) {
        super(`${fonte}: ${mensagem}`)
        this.name = 'ErroDeExtracao'
        this.fonte = fonte
        this.consumo = consumo
    }
}
