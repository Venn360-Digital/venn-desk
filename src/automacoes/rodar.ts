import type { PrismaClient } from '#prisma'

import { appsAtivos } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { decidirAutomacoes, PRAZOS_PADRAO, textoDoLembrete, type PrazosDaAutomacao } from '../dominio/automacoes.ts'

/**
 * Aplica as automações de inatividade (Fase 7).
 *
 * Roda uma vez por hora: os prazos são em DIAS, e verificar a cada minuto só
 * multiplicaria consultas para chegar à mesma conclusão 1.440 vezes.
 *
 * **Teto por app, e por isso a ordem importa.** A consulta traz os mais antigos
 * primeiro (`atualizadoEm` crescente), então um acúmulo de mil chamados parados
 * é resolvido aos poucos, começando pelos que esperam mais — e não deixa um app
 * movimentado consumir a rodada inteira.
 */
export const TETO_POR_APP = 50

export interface AcaoAplicada {
    app: string
    numero: number
    acao: string
}

export async function rodarAutomacoes(
    cliente: PrismaClient,
    opcoes: { agora?: Date; prazos?: PrazosDaAutomacao } = {}
): Promise<AcaoAplicada[]> {
    const agora = opcoes.agora ?? new Date()
    const prazos = opcoes.prazos ?? PRAZOS_PADRAO
    const aplicadas: AcaoAplicada[] = []

    for (const app of await appsAtivos(cliente)) {
        const escopo = escopoDoApp(cliente, app.id)

        try {
            const parados = await escopo.chamados.paradosParaAutomacao(TETO_POR_APP)

            for (const decisao of decidirAutomacoes(parados, agora, prazos)) {
                try {
                    if (decisao.acao === 'lembrar') {
                        /**
                         * A mensagem é PÚBLICA e de SISTEMA.
                         *
                         * Pública porque é para o cliente ler; de sistema
                         * porque não é alguém falando — atribuí-la à IA faria o
                         * indicador de resolução pela IA contar um lembrete
                         * como atendimento, e atribuí-la a um humano seria
                         * falso.
                         */
                        await escopo.mensagens.adicionar(
                            {
                                ticketId: decisao.chamadoId,
                                autor: 'SISTEMA',
                                corpo: textoDoLembrete(decisao.diasParado, prazos.resolverEmDias),
                                visibilidade: 'PUBLICA',
                                origem: 'WIDGET',
                            },
                            { ator: 'sistema:automacao' }
                        )

                        /// O evento é o que marca o ciclo: é por ele que a
                        /// próxima rodada sabe que o lembrete já saiu.
                        await escopo.eventos.registrar({
                            ticketId: decisao.chamadoId,
                            ator: 'sistema:automacao',
                            evento: 'automacao:lembrete',
                            depois: { diasParado: decisao.diasParado },
                        })
                    } else {
                        /**
                         * `aplicarEvento` passa pela máquina de estados, e isso
                         * é o ponto: se alguém respondeu entre a consulta e
                         * aqui, o chamado já saiu de "aguardando usuário" e a
                         * transição é recusada — o que é o comportamento certo.
                         */
                        await escopo.chamados.aplicarEvento(decisao.chamadoId, decisao.acao, {
                            ator: 'sistema:automacao',
                        })
                    }

                    aplicadas.push({ app: app.slug, numero: decisao.numero, acao: decisao.acao })
                } catch (erro) {
                    /// Um chamado não derruba os outros: transição recusada é
                    /// resposta legítima, e vira linha de log.
                    console.log(
                        '[automacao] não aplicada:',
                        JSON.stringify({ numero: decisao.numero, acao: decisao.acao, erro: erro instanceof Error ? erro.message : 'erro' })
                    )
                }
            }
        } catch (erro) {
            console.error(`[automacao] falhou em ${app.slug}:`, erro)
        }
    }

    return aplicadas
}
