/**
 * Os indicadores do painel (seção 12).
 *
 * **O cuidado central deste arquivo é a amostra pequena.** Mediana e percentil
 * 90 sobre quatro chamados não são estatística, são anedota com casas decimais
 * — e número com casa decimal convence. Um painel que mostra "p90: 4h12" tendo
 * medido cinco chamados leva alguém a calibrar SLA com base em ruído.
 *
 * Então nada aqui devolve um número que não sustenta: abaixo do mínimo, o campo
 * vem nulo e acompanhado da contagem. "Não sei ainda, com 5 casos" é um
 * resultado; um p90 inventado é pior que campo vazio.
 *
 * Pela mesma razão, divisão por zero vira `null` e nunca `0`. Zero por cento de
 * resolução pela IA e nenhuma oportunidade de resolver são coisas diferentes, e
 * confundi-las faria um app sem uso parecer um app com IA ruim.
 */

/**
 * Quantos casos um percentil precisa para dizer alguma coisa.
 *
 * Dez é arbitrário e assumido como tal — não há literatura que o justifique
 * para esta aplicação. O que ele faz é impedir o caso claramente indefensável
 * (p90 de três chamados), e é revisável quando houver volume para calibrar.
 */
export const MINIMO_PARA_PERCENTIL = 10

/** Quantos casos uma taxa precisa para ser exibida como porcentagem. */
export const MINIMO_PARA_TAXA = 5

export interface Distribuicao {
    casos: number
    /** Em minutos. Nulo quando a amostra não sustenta. */
    mediana: number | null
    p90: number | null
}

/**
 * O percentil pelo método do mais próximo, sobre a lista ordenada.
 *
 * Sem interpolação de propósito: interpolar inventa um valor que nenhum chamado
 * teve, e aqui o número é lido como "um chamado demorou isso". Com amostra
 * pequena — que é o caso por muito tempo — o valor interpolado seria ainda mais
 * frágil que o observado.
 */
function percentil(ordenados: number[], fracao: number): number {
    const indice = Math.min(ordenados.length - 1, Math.ceil(fracao * ordenados.length) - 1)
    return ordenados[Math.max(0, indice)]!
}

export function distribuir(minutos: number[]): Distribuicao {
    const casos = minutos.length
    if (casos < MINIMO_PARA_PERCENTIL) return { casos, mediana: null, p90: null }

    const ordenados = [...minutos].sort((a, b) => a - b)

    return {
        casos,
        mediana: percentil(ordenados, 0.5),
        p90: percentil(ordenados, 0.9),
    }
}

/**
 * Uma proporção que se recusa a mentir.
 *
 * `null` quando não há denominador OU quando a amostra é pequena demais. Uma
 * taxa de "100%" com dois casos é a frase mais perigosa de um painel: ela é
 * verdadeira e inútil, e some no mês seguinte sem ninguém entender por quê.
 */
export function taxa(parte: number, total: number): number | null {
    if (total < MINIMO_PARA_TAXA) return null
    return Number(((parte / total) * 100).toFixed(1))
}

export interface ChamadoMedido {
    tipo: string
    prioridade: string
    status: string
    /** Minutos até a primeira resposta pública. Nulo se ainda não houve. */
    minutosAteResposta: number | null
    /** Minutos até resolver. Nulo se ainda não resolveu. */
    minutosAteResolver: number | null
    /** Houve ao menos uma resposta pública da IA que saiu. */
    respondidoPelaIa: boolean
    /** Humano escreveu alguma resposta pública. */
    respondidoPorHumano: boolean
    /** Foi reaberto depois de resolvido. */
    reaberto: boolean
    /** Custo somado dos atendimentos da IA, em dólares. */
    custoDaIa: number
}

export interface Relatorio {
    chamados: number
    porTipo: Record<string, number>
    porPrioridade: Record<string, number>
    porStatus: Record<string, number>
    primeiraResposta: Distribuicao
    resolucao: Distribuicao
    /** Resolvidos SÓ pela IA, sem nenhuma resposta humana. */
    resolucaoPelaIa: { casos: number; deQuantos: number; percentual: number | null }
    reabertura: { casos: number; deQuantos: number; percentual: number | null }
    sla: { cumpridos: number; violados: number; percentual: number | null }
    custo: { total: number; porChamado: number | null }
}

function contar(valores: string[]): Record<string, number> {
    const mapa: Record<string, number> = {}
    for (const v of valores) mapa[v] = (mapa[v] ?? 0) + 1
    return mapa
}

const ENCERRADOS = new Set(['RESOLVIDO', 'FECHADO'])

export function montarRelatorio(
    chamados: ChamadoMedido[],
    relogios: { violadoEm: Date | null; cumpridoEm: Date | null }[]
): Relatorio {
    const encerrados = chamados.filter((c) => ENCERRADOS.has(c.status))

    /**
     * "Resolvido pela IA" exige resposta DELA e nenhuma de humano.
     *
     * Um chamado em que a IA escreveu e uma pessoa precisou escrever depois não
     * foi resolvido pela IA — foi resolvido pela pessoa, com rascunho. Contá-lo
     * como vitória da IA é o jeito mais fácil de o indicador subir sem o
     * atendimento melhorar.
     */
    const soIa = encerrados.filter((c) => c.respondidoPelaIa && !c.respondidoPorHumano)

    const cumpridos = relogios.filter((r) => r.cumpridoEm !== null).length
    const violados = relogios.filter((r) => r.violadoEm !== null).length

    const custoTotal = Number(chamados.reduce((s, c) => s + c.custoDaIa, 0).toFixed(4))
    const comCusto = chamados.filter((c) => c.custoDaIa > 0).length

    return {
        chamados: chamados.length,
        porTipo: contar(chamados.map((c) => c.tipo)),
        porPrioridade: contar(chamados.map((c) => c.prioridade)),
        porStatus: contar(chamados.map((c) => c.status)),

        primeiraResposta: distribuir(
            chamados.map((c) => c.minutosAteResposta).filter((m): m is number => m !== null)
        ),
        resolucao: distribuir(
            chamados.map((c) => c.minutosAteResolver).filter((m): m is number => m !== null)
        ),

        resolucaoPelaIa: {
            casos: soIa.length,
            deQuantos: encerrados.length,
            percentual: taxa(soIa.length, encerrados.length),
        },

        reabertura: {
            casos: chamados.filter((c) => c.reaberto).length,
            deQuantos: encerrados.length,
            percentual: taxa(chamados.filter((c) => c.reaberto).length, encerrados.length),
        },

        sla: {
            cumpridos,
            violados,
            percentual: taxa(cumpridos, cumpridos + violados),
        },

        custo: {
            total: custoTotal,
            /**
             * Dividido pelos chamados QUE A IA ATENDEU, não por todos.
             *
             * Com o atendimento em manual, a maioria dos chamados tem custo
             * zero — e dividir por todos faria o custo por chamado despencar
             * conforme o produto cresce sem a IA ser usada. O número que
             * interessa é quanto custa um atendimento dela.
             */
            porChamado: comCusto === 0 ? null : Number((custoTotal / comCusto).toFixed(4)),
        },
    }
}
