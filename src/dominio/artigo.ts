import { z } from 'zod'

/**
 * A base de conhecimento — o que a empresa sabe, escrito uma vez.
 *
 * **Por que ela muda a qualidade da resposta.** Sem artigos, o agente responde
 * pelo que alguém já perguntou: ele busca em chamados antigos e devolve o que
 * um atendente respondeu numa terça-feira, com o acerto e o erro daquele dia.
 * Com artigos, ele responde pelo que a empresa decidiu que é a resposta certa.
 *
 * **O artigo é dado para o agente, nunca instrução.** Quem escreve artigo é
 * gente da Venn360, e ainda assim ele entra no contexto do modelo rotulado
 * como conteúdo — a mesma disciplina que vale para texto de solicitante. Um
 * artigo com "ignore as regras anteriores" no corpo não deve virar ordem só
 * porque a origem é interna; interna é a origem, não a revisão de cada linha.
 */

export const esquemaDoArtigo = z.object({
    titulo: z.string().trim().min(3).max(160),
    corpo: z.string().trim().min(10).max(20_000),
    tags: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
    /**
     * Sem app = global, válido para os três.
     *
     * Está na seção 6 da especificação (`app_id (ou global)`) e é a única
     * exceção à regra de que toda linha carrega app. Ela se sustenta porque um
     * artigo é conteúdo NOSSO, publicado de propósito: "como trocar a senha"
     * é a mesma resposta nos três produtos, e três cópias seriam três lugares
     * para desatualizar. O que a regra protege — dado de cliente de um app
     * alcançar outro — continua intacto, porque artigo não tem cliente.
     *
     * A consequência é que o filtro deixa de ser igualdade e vira
     * "deste app OU global". Isso mora num lugar só, `ondeDoArtigo` em
     * `src/dados/escopo.ts`, e tem teste de isolamento próprio.
     */
    global: z.boolean().default(false),
})

export type DadosDoArtigo = z.infer<typeof esquemaDoArtigo>

/**
 * O que uma edição parcial pode trazer.
 *
 * Não é `Partial<DadosDoArtigo>`: sob `exactOptionalPropertyTypes`, `Partial`
 * diz "a chave pode faltar" e NÃO "a chave pode valer `undefined`" — enquanto
 * o `.partial()` do Zod produz exatamente a segunda forma. Escrever o mapeado à
 * mão faz os dois lados concordarem sem `as`.
 */
export type EdicaoDoArtigo = { [C in keyof DadosDoArtigo]?: DadosDoArtigo[C] | undefined }

export const STATUS = ['RASCUNHO', 'PUBLICADO', 'ARQUIVADO'] as const
export type StatusDoArtigo = (typeof STATUS)[number]

/**
 * Para onde um artigo pode ir, a partir de onde está.
 *
 * Arquivado volta para rascunho, e não direto para publicado: quem arquivou
 * tirou do ar por algum motivo, e republicar sem reler é desfazer a decisão
 * sem olhar o que ela decidiu.
 */
const TRANSICOES: Record<StatusDoArtigo, StatusDoArtigo[]> = {
    RASCUNHO: ['PUBLICADO', 'ARQUIVADO'],
    PUBLICADO: ['RASCUNHO', 'ARQUIVADO'],
    ARQUIVADO: ['RASCUNHO'],
}

export function podeIrPara(de: StatusDoArtigo, para: StatusDoArtigo): boolean {
    return TRANSICOES[de].includes(para)
}

/**
 * O que o agente e o widget enxergam.
 *
 * Só publicado. Rascunho é texto em revisão — entregá-lo ao modelo faria a IA
 * responder com o que alguém ainda está escrevendo, e entregá-lo ao widget
 * publicaria por acidente.
 */
export const VISIVEL: StatusDoArtigo = 'PUBLICADO'

export interface ArtigoBuscavel {
    id: string
    titulo: string
    corpo: string
    tags: string[]
}

/**
 * O texto que a busca enxerga, montado com o título PESADO.
 *
 * Repetir o título três vezes não é truque de pontuação arbitrário: o corpo de
 * um artigo bom tem centenas de palavras e o título tem seis, então sem peso a
 * palavra certa no título vale o mesmo que uma menção de passagem no terceiro
 * parágrafo. Com a repetição, "redefinir senha" acha o artigo chamado
 * "Redefinir senha" antes do que só cita senha ao explicar outra coisa.
 *
 * As tags entram uma vez: elas existem para alcançar a palavra que o autor
 * sabia que as pessoas usariam e não quis escrever no título.
 */
export function textoDeBusca(artigo: ArtigoBuscavel): string {
    return [artigo.titulo, artigo.titulo, artigo.titulo, artigo.tags.join(' '), artigo.corpo].join(
        ' '
    )
}

/**
 * O recorte do artigo que vai para o modelo.
 *
 * O corpo inteiro de vários artigos estoura o contexto e dilui a resposta. O
 * começo basta para o agente decidir se aquele artigo serve, e ele tem o `id`
 * para pedir o texto completo quando servir.
 */
export const RESUMO_MAXIMO = 600

export function resumir(corpo: string): string {
    const limpo = corpo.replace(/\s+/g, ' ').trim()
    if (limpo.length <= RESUMO_MAXIMO) return limpo

    /// Corta na última fronteira de palavra, para não entregar sílaba partida.
    const bruto = limpo.slice(0, RESUMO_MAXIMO)
    const ultimo = bruto.lastIndexOf(' ')

    return `${ultimo > RESUMO_MAXIMO / 2 ? bruto.slice(0, ultimo) : bruto}…`
}
