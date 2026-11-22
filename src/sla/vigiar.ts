import type { PrismaClient } from '#prisma'

import { appsAtivos } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { pedeCaoDeGuarda, type Meta, type Relogio } from '../dominio/sla.ts'

/**
 * A varredura dos prazos, a cada minuto, no mesmo Cron Trigger da saúde.
 *
 * Ela faz UMA coisa: transformar "o prazo passou" em fato registrado. Marca o
 * relógio como violado, grava o evento na trilha do chamado e, quando o prazo
 * violado é o de primeira resposta, grava também o cão de guarda (seção 4).
 *
 * **O que ela ainda não faz, e por quê.** A seção 4 manda o cão de guarda
 * repetir o chamado na thread e marcar o responsável humano do app. Repetir na
 * thread depende da ponte com o Slack, que depende do token do bot. O que não
 * depende de nada — perceber e registrar — está aqui, e o evento
 * `sla:cao_de_guarda` é o gancho: quando a ponte entrar, ela lê este evento em
 * vez de recalcular o prazo.
 *
 * **Por que marcar é o suficiente para ser útil hoje.** Sem isto, a pergunta
 * "quantos chamados estouraram o prazo esta semana" não tem resposta, porque
 * ninguém guardou. Com isto, ela é uma consulta — e a fila "SLA em risco" da
 * seção 5 passa a ter de onde sair.
 */

/** Teto por app por execução: a varredura roda a cada minuto e não pode arrastar. */
export const TETO_POR_APP = 50

export interface Estouro {
    slug: string
    ticketId: string
    meta: Meta
    caoDeGuarda: boolean
}

export interface Risco {
    slug: string
    ticketId: string
    meta: Meta
    /** Minutos até vencer, para o alerta dizer quanto resta. */
    faltamMin: number
}

/**
 * Os relógios que estão perto de vencer e ainda não foram avisados.
 *
 * Separado de `vigiarPrazos` porque responde outra pergunta: aquele diz o que
 * já falhou, este diz o que ainda dá para salvar. E porque o aviso de risco é
 * UMA vez por relógio — a marca no banco é o que impede o cron de repetir a
 * mesma linha a cada minuto enquanto o prazo corre.
 */
export async function vigiarRiscos(
    cliente: PrismaClient,
    opcoes: { agora?: Date } = {}
): Promise<Risco[]> {
    const agora = opcoes.agora ?? new Date()
    const apps = await appsAtivos(cliente)

    const resultados = await Promise.allSettled(
        apps.map(async (app) => {
            const escopo = escopoDoApp(cliente, app.id)
            const riscos: Risco[] = []

            for (const linha of await escopo.sla.emRisco(agora, TETO_POR_APP)) {
                if (!(await escopo.sla.marcarAvisado(linha.id, agora))) continue

                await escopo.eventos.registrar({
                    ticketId: linha.ticketId,
                    ator: 'sistema',
                    evento: `sla:risco:${linha.meta}`,
                    depois: {
                        metaMin: linha.metaMin,
                        venceEm: linha.venceEm.toISOString(),
                    },
                })

                riscos.push({
                    slug: app.slug,
                    ticketId: linha.ticketId,
                    meta: linha.meta as Meta,
                    faltamMin: Math.max(0, Math.round((linha.venceEm.getTime() - agora.getTime()) / 60_000)),
                })
            }

            return riscos
        })
    )

    return resultados.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

export async function vigiarPrazos(
    cliente: PrismaClient,
    opcoes: { agora?: Date } = {}
): Promise<Estouro[]> {
    const agora = opcoes.agora ?? new Date()
    const apps = await appsAtivos(cliente)

    /// Um app com problema não pode calar os outros — mesma razão da saúde.
    const resultados = await Promise.allSettled(
        apps.map(async (app) => {
            const escopo = escopoDoApp(cliente, app.id)
            const vencidos = await escopo.sla.vencidos(agora, TETO_POR_APP)
            const estouros: Estouro[] = []

            for (const linha of vencidos) {
                /**
                 * `violar` devolve falso quando outra execução chegou antes.
                 * Duas invocações do cron podem se sobrepor — a da Cloudflare
                 * não garante exclusão —, e sem esta checagem o mesmo estouro
                 * geraria dois eventos e dois alertas.
                 */
                if (!(await escopo.sla.violar(linha.id, agora))) continue

                const relogio: Relogio = {
                    meta: linha.meta as Meta,
                    metaMin: linha.metaMin,
                    venceEm: linha.venceEm,
                    pausadoEm: linha.pausadoEm,
                    /// Antes de marcar: é assim que o cão de guarda enxerga
                    /// "vencido" em vez de "já violado".
                    violadoEm: null,
                    cumpridoEm: linha.cumpridoEm,
                }

                const cao = pedeCaoDeGuarda(relogio, agora)

                await escopo.eventos.registrar({
                    ticketId: linha.ticketId,
                    ator: 'sistema',
                    evento: `sla:violado:${linha.meta}`,
                    depois: {
                        metaMin: linha.metaMin,
                        venceEm: linha.venceEm.toISOString(),
                        atrasoMin: Math.round(
                            (agora.getTime() - linha.venceEm.getTime()) / 60_000
                        ),
                    },
                })

                if (cao) {
                    /// Evento próprio, e não um campo do anterior: é o que a
                    /// ponte do Slack vai procurar, e o que distingue "ninguém
                    /// olhou" de "o problema é difícil".
                    await escopo.eventos.registrar({
                        ticketId: linha.ticketId,
                        ator: 'sistema',
                        evento: 'sla:cao_de_guarda',
                        depois: { meta: linha.meta, canal: app.canalSuporte },
                    })
                }

                estouros.push({
                    slug: app.slug,
                    ticketId: linha.ticketId,
                    meta: linha.meta as Meta,
                    caoDeGuarda: cao,
                })
            }

            return estouros
        })
    )

    const todos: Estouro[] = []
    for (const [indice, resultado] of resultados.entries()) {
        if (resultado.status === 'fulfilled') {
            todos.push(...resultado.value)
            continue
        }
        console.error(`[sla] falhou ao vigiar ${apps[indice]?.slug}:`, resultado.reason)
    }

    return todos
}
