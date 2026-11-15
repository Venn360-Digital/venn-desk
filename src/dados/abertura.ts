import type { Prisma, PrismaClient, Ticket } from '#prisma'

import { escopoDoApp } from './escopo.ts'

/**
 * A abertura do chamado — a única escrita que precisa de transação interativa.
 *
 * O número é sequência POR APP, e a seção 6 exige que seja gerado dentro de
 * transação. O incremento é atômico (`increment` vira `UPDATE … SET n = n + 1`,
 * que trava a linha do app) e o número do chamado é o valor ANTERIOR: assim
 * dois chamados simultâneos no mesmo app não recebem o mesmo número, e uma
 * transação que falhe no meio não deixa buraco visível — ela desfaz o
 * incremento junto.
 *
 * É por isto que o driver do Neon é o de WebSocket e não o HTTP: o HTTP não
 * suporta transação interativa.
 */

export interface DadosDaAbertura {
    tenantId: string
    requesterId: string
    assunto: string
    descricao: string
    tipo?: 'DUVIDA' | 'INCIDENTE' | 'PROBLEMA' | 'SOLICITACAO'
    prioridade?: 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE'
    origem?: 'WIDGET' | 'SLACK' | 'MCP' | 'CONSOLE' | 'PORTAL' | 'EMAIL'
    contexto?: unknown
    /** Quem abriu: o próprio solicitante, ou o atendente em nome dele. */
    ator: string
}

export async function abrirChamado(
    cliente: PrismaClient,
    appId: string,
    dados: DadosDaAbertura
): Promise<Ticket> {
    return cliente.$transaction(async (tx) => {
        const app = await tx.app.update({
            where: { id: appId },
            data: { proximoNumero: { increment: 1 } },
            select: { proximoNumero: true },
        })

        const numero = app.proximoNumero - 1
        const escopo = escopoDoApp(tx, appId)

        const chamado = await tx.ticket.create({
            data: {
                appId,
                numero,
                tenantId: dados.tenantId,
                requesterId: dados.requesterId,
                assunto: dados.assunto,
                tipo: dados.tipo ?? 'DUVIDA',
                prioridade: dados.prioridade ?? 'NORMAL',
                status: 'NOVO',
                nivel: 'N1',
                ...(dados.contexto === undefined
                    ? {}
                    : { contexto: dados.contexto as Prisma.InputJsonValue }),
            },
        })

        /// A descrição do usuário é a primeira mensagem da linha do tempo, não
        /// um campo do chamado: assim a conversa tem uma origem só, e a resposta
        /// da IA entra na mesma lista.
        await escopo.mensagens.adicionar(
            {
                ticketId: chamado.id,
                autor: 'USUARIO',
                corpo: dados.descricao,
                visibilidade: 'PUBLICA',
                origem: dados.origem ?? 'WIDGET',
                autorId: dados.requesterId,
            },
            { ator: dados.ator }
        )

        await escopo.eventos.registrar({
            ticketId: chamado.id,
            ator: dados.ator,
            evento: 'abertura',
            depois: { numero, origem: dados.origem ?? 'WIDGET' },
        })

        return chamado
    })
}
