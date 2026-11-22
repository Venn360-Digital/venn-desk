import type { PrismaClient } from '#prisma'

import { appsAtivos } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { totalDesde } from '../dados/gastos.ts'
import { textoDoResumoDiario, type LinhaDoResumo } from '../dominio/resumo-diario.ts'
import { postar } from '../slack/cliente.ts'

/**
 * O resumo diário em `#desk-alertas` (Fase 7).
 *
 * Lê o que já existe — os chamados medidos do painel e a contabilidade de IA —
 * em vez de contar de novo. Se o painel e o resumo discordassem sobre quantos
 * chamados houve ontem, a discussão sobre qual está certo custaria mais que os
 * dois juntos.
 */
export const HORAS_DO_RESUMO = 24

export async function postarResumoDiario(
    cliente: PrismaClient,
    env: { SLACK_BOT_TOKEN?: string | undefined; SLACK_CANAL_DE_ALERTAS?: string | undefined },
    agora: Date
): Promise<{ postou: boolean; motivo?: string }> {
    const canal = env.SLACK_CANAL_DE_ALERTAS
    if (canal === undefined || canal === '') return { postou: false, motivo: 'sem_canal' }

    const desde = new Date(agora.getTime() - HORAS_DO_RESUMO * 60 * 60 * 1000)
    const linhas: LinhaDoResumo[] = []

    for (const app of await appsAtivos(cliente)) {
        const escopo = escopoDoApp(cliente, app.id)
        try {
            const [medidos, relogios, naFila] = await Promise.all([
                escopo.painel.chamadosMedidos(desde),
                escopo.painel.relogiosEncerrados(desde),
                escopo.chamados.listar({ status: ['NOVO', 'ABERTO', 'EM_ESPERA'], limite: 200 }),
            ])

            linhas.push({
                app: app.slug,
                abertos: medidos.length,
                resolvidos: medidos.filter((m) => m.status === 'RESOLVIDO' || m.status === 'FECHADO').length,
                violados: relogios.filter((r) => r.violadoEm !== null).length,
                /**
                 * "Na fila agora" exclui AGUARDANDO_USUARIO de propósito: esse
                 * chamado espera o cliente, não a equipe, e contá-lo faria a
                 * fila da manhã parecer maior do que o trabalho que existe.
                 */
                emAberto: naFila.length,
            })
        } catch (erro) {
            console.error(`[resumo] falhou em ${app.slug}:`, erro)
        }
    }

    const gastoUsd = await totalDesde(cliente, desde)
    const texto = textoDoResumoDiario({ linhas, gastoUsd, horas: HORAS_DO_RESUMO })
    if (texto === null) return { postou: false, motivo: 'sem_movimento' }

    const r = await postar(
        { token: env.SLACK_BOT_TOKEN },
        { canal, mensagem: { text: texto, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: texto } }] } }
    )

    if (!r.ok) {
        if (r.erro !== 'sem_token') console.error('[resumo] não postado:', r.erro)
        return { postou: false, motivo: r.erro }
    }

    return { postou: true }
}
