import { postar, type Buscador } from './cliente.ts'
import { mensagemDeAlerta, type DadosDoAlerta } from './mensagens.ts'

/**
 * O canal de alertas (`#desk-alertas`, seção 8).
 *
 * Um canal para os três apps, e não um por app: quem olha alerta está de
 * plantão sobre a plataforma, não sobre um produto. O nome do app vai na linha.
 *
 * **Só o que mudou.** O cron roda a cada minuto; postar "tudo bem" 1.440 vezes
 * por dia é o jeito mais eficiente de ninguém notar o dia em que não estava.
 * Quem chama aqui já filtrou.
 */
export async function alertarNoSlack(
    env: { SLACK_BOT_TOKEN?: string | undefined; SLACK_CANAL_DE_ALERTAS?: string | undefined },
    alertas: DadosDoAlerta[],
    /// Injetável pela mesma razão do resto do módulo: sem isto, o teste do
    /// canal de alertas provaria apenas que `fetch` falha offline.
    buscador?: Buscador
): Promise<{ postados: number }> {
    const canal = env.SLACK_CANAL_DE_ALERTAS
    if (canal === undefined || canal === '' || alertas.length === 0) return { postados: 0 }

    const config = { token: env.SLACK_BOT_TOKEN, ...(buscador === undefined ? {} : { buscador }) }

    let postados = 0
    for (const alerta of alertas) {
        const r = await postar(config, { canal, mensagem: mensagemDeAlerta(alerta) })
        if (r.ok) postados += 1
        else if (r.erro !== 'sem_token') console.error('[slack] alerta não postado:', r.erro)
    }

    return { postados }
}

/**
 * Traduz o que o cron já descobriu para alertas.
 *
 * Vive aqui, e não no cron, para ser testável sem banco: o cron fica com a
 * decisão de quando chamar, e esta função com a de o que dizer.
 */
export function alertasDaRodada(p: {
    saude: { slug: string; mudanca: 'caiu' | 'voltou' | null; detalhe: string }[]
    prazos: { slug: string; ticketId: string; meta: string; caoDeGuarda: boolean }[]
    /** Prazos que ainda dá para salvar. */
    riscos?: { slug: string; ticketId: string; meta: string; faltamMin: number }[]
    numeroDoChamado?: (ticketId: string) => string | undefined
    urlBase?: string | undefined
}): DadosDoAlerta[] {
    const alertas: DadosDoAlerta[] = []

    for (const v of p.saude) {
        if (v.mudanca === null) continue
        alertas.push({
            gravidade: v.mudanca,
            app: v.slug,
            resumo: v.mudanca === 'caiu' ? `fora do ar: ${v.detalhe}` : 'voltou a responder',
        })
    }

    for (const e of p.prazos) {
        const numero = p.numeroDoChamado?.(e.ticketId)
        alertas.push({
            gravidade: e.caoDeGuarda ? 'cao-de-guarda' : 'sla',
            app: e.slug,
            resumo: e.caoDeGuarda
                ? 'ninguém respondeu no prazo e o chamado foi devolvido à fila'
                : `prazo de ${e.meta.replace(/_/g, ' ')} estourado`,
            ...(numero === undefined ? {} : { numero }),
            ...(p.urlBase === undefined || numero === undefined
                ? {}
                : { urlNoConsole: `${p.urlBase}/app/${e.slug}/chamados/${numero.split('-').pop() ?? ''}` }),
        })
    }

    for (const r of p.riscos ?? []) {
        const numero = p.numeroDoChamado?.(r.ticketId)
        alertas.push({
            gravidade: 'sla',
            app: r.slug,
            /// Quanto FALTA, não quanto já passou: o alerta de risco existe
            /// para alguém agir, e "faltam 6 minutos" é a informação que leva
            /// à ação.
            resumo: `prazo de ${r.meta.replace(/_/g, ' ')} vence em ${r.faltamMin} min`,
            ...(numero === undefined ? {} : { numero }),
            ...(p.urlBase === undefined || numero === undefined
                ? {}
                : { urlNoConsole: `${p.urlBase}/app/${r.slug}/chamados/${numero.split('-').pop() ?? ''}` }),
        })
    }

    return alertas
}
