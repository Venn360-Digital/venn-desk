import type { PrismaClient } from '#prisma'

/**
 * A contabilidade de IA: uma linha por chamada ao modelo.
 *
 * Fora do `escopoDoApp` de propósito, e por duas razões. Gasto existe sem app
 * (uma rodada de avaliação não pertence a produto nenhum), e a pergunta que
 * importa — "quanto gastamos ontem, e com o quê" — é sobre a plataforma, não
 * sobre um produto. O `appId` entra como coluna e aparece em toda resposta.
 *
 * Nada aqui lança. Falhar ao registrar um gasto não pode derrubar o trabalho
 * que o gerou: a conta erraria para baixo, e é melhor uma conta incompleta e um
 * log de erro do que uma tela de cliente quebrada por causa da contabilidade.
 */

export type OrigemDoGasto = 'atendimento' | 'tela' | 'sincronizacao' | 'sugestao' | 'diagnostico' | 'bateria'

export interface Gasto {
    appId?: string | null
    origem: OrigemDoGasto
    referencia?: string | null
    modelo?: string | null
    tokensDeEntrada?: number
    tokensDeSaida?: number
    custoUsd: number
}

export async function registrarGasto(cliente: PrismaClient, gasto: Gasto): Promise<void> {
    /// Zero não vira linha: uma chamada que não custou (cache, falha antes de
    /// gastar) só encheria a tabela e diluiria a média por chamada.
    if (!(gasto.custoUsd > 0)) return

    try {
        await cliente.iaGasto.create({
            data: {
                origem: gasto.origem,
                custoUsd: gasto.custoUsd,
                tokensDeEntrada: gasto.tokensDeEntrada ?? 0,
                tokensDeSaida: gasto.tokensDeSaida ?? 0,
                ...(gasto.appId === undefined || gasto.appId === null ? {} : { appId: gasto.appId }),
                ...(gasto.referencia === undefined || gasto.referencia === null ? {} : { referencia: gasto.referencia }),
                ...(gasto.modelo === undefined || gasto.modelo === null ? {} : { modelo: gasto.modelo }),
            },
        })
    } catch (erro) {
        console.error('[gastos] não consegui registrar:', erro)
    }
}

export interface SomaDeGasto {
    appId: string | null
    origem: string
    usd: number
    chamadas: number
}

/** O gasto por app e por origem desde um instante. É o que o painel mostra. */
export async function gastoDesde(cliente: PrismaClient, desde: Date): Promise<SomaDeGasto[]> {
    const linhas = await cliente.$queryRaw<{ app_id: string | null; origem: string; usd: unknown; chamadas: bigint }[]>`
        SELECT app_id, origem, sum(custo_usd) AS usd, count(*) AS chamadas
        FROM ia_gastos
        WHERE criado_em >= ${desde}
        GROUP BY app_id, origem
        ORDER BY sum(custo_usd) DESC
    `

    return linhas.map((l) => ({
        appId: l.app_id,
        origem: l.origem,
        usd: Number(l.usd ?? 0),
        chamadas: Number(l.chamadas),
    }))
}

/** O total do dia, para o cão de guarda de custo. */
export async function totalDesde(cliente: PrismaClient, desde: Date): Promise<number> {
    const linhas = await cliente.$queryRaw<{ usd: unknown }[]>`
        SELECT coalesce(sum(custo_usd), 0) AS usd FROM ia_gastos WHERE criado_em >= ${desde}
    `
    return Number(linhas[0]?.usd ?? 0)
}

/**
 * O nível de custo já avisado hoje.
 *
 * Mora na própria tabela de gastos, como uma linha de origem `aviso-de-custo` e
 * custo zero — e por isso ela é a única exceção à regra de não gravar gasto
 * zero. A alternativa seria uma coluna de estado em algum lugar, que discordaria
 * da realidade no primeiro deploy do dia: estado em memória morre a cada
 * requisição, e o cron é outro processo a cada minuto.
 */
export async function nivelJaAvisado(cliente: PrismaClient, desde: Date): Promise<'normal' | 'atencao' | 'estouro'> {
    const linhas = await cliente.iaGasto.findMany({
        where: { origem: 'aviso-de-custo', criadoEm: { gte: desde } },
        select: { referencia: true },
    })

    const niveis = new Set(linhas.map((l) => l.referencia))
    if (niveis.has('estouro')) return 'estouro'
    if (niveis.has('atencao')) return 'atencao'
    return 'normal'
}

export async function registrarAvisoDeCusto(
    cliente: PrismaClient,
    nivel: 'atencao' | 'estouro',
    gastoUsd: number
): Promise<void> {
    try {
        await cliente.iaGasto.create({
            data: { origem: 'aviso-de-custo', referencia: nivel, custoUsd: 0, tokensDeEntrada: Math.round(gastoUsd * 100) },
        })
    } catch (erro) {
        console.error('[gastos] não consegui registrar o aviso:', erro)
    }
}
