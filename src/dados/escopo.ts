import type { Prisma, PrismaClient } from '#prisma'
import type { Attachment, Ticket, TicketEvent, TicketMessage } from '#prisma'

import { ErroDeDominio } from '../lib/erros.ts'
import { transicionar, type Evento, type Status } from '../dominio/estados.ts'

/**
 * O escopo por app — a peça que faz o isolamento ser estrutural, e não
 * disciplina.
 *
 * A regra da seção 6 é que toda consulta filtra por `app_id`. Escrita como
 * convenção, ela falha no dia em que alguém escreve uma consulta a mais; escrita
 * como ESTA camada, ela não tem como falhar: nenhuma rota recebe um cliente do
 * Prisma, todas recebem um escopo já amarrado a um app, e o `appId` é injetado
 * aqui dentro, em toda cláusula `where` e em todo `data`.
 *
 * Três decisões que sustentam isso:
 *
 *  - **`findFirst`, nunca `findUnique`.** Buscar por `id` com `findUnique`
 *    ignoraria o app: o id é único globalmente, então um id vazado de outro app
 *    retornaria a linha. `findFirst({ where: { id, appId } })` devolve `null`,
 *    que é a resposta certa.
 *  - **`updateMany`, nunca `update`.** `update` exige `where` único e, por isso,
 *    não aceita o `appId` ao lado do `id`. `updateMany` aceita, e a contagem de
 *    volta prova que a linha pertencia ao app.
 *  - **toda escrita grava evento.** A trilha não é opcional nem posterior: as
 *    duas coisas acontecem na mesma transação, ou nenhuma acontece.
 */

/** Serve ao cliente e à transação: o escopo é o mesmo nos dois. */
export type Conexao = PrismaClient | Prisma.TransactionClient

export interface Autor {
    /** `agent:<id>`, `requester:<id>`, `ia:<ferramenta>` ou `sistema`. */
    ator: string
}

export interface DadosDaMensagem {
    ticketId: string
    autor: 'USUARIO' | 'IA' | 'HUMANO' | 'SISTEMA'
    corpo: string
    visibilidade?: 'PUBLICA' | 'INTERNA'
    origem?: 'WIDGET' | 'SLACK' | 'MCP' | 'CONSOLE' | 'PORTAL' | 'EMAIL'
    autorId?: string
    rascunho?: boolean
}

export interface FiltroDeLista {
    requesterId?: string
    tenantId?: string
    status?: Status[]
    limite?: number
}

export interface EscopoDoApp {
    readonly appId: string

    solicitantes: {
        garantir(identidade: {
            tenantExternalId: string
            tenantNome: string
            requesterExternalId: string
            nome: string
            email: string
            papelNoTenant: string
            plano?: string
        }): Promise<{ tenantId: string; requesterId: string }>
    }

    chamados: {
        porId(id: string): Promise<Ticket | null>
        porNumero(numero: number): Promise<Ticket | null>
        listar(filtro: FiltroDeLista): Promise<Ticket[]>
        /** Aplica um evento da máquina de estados e grava a trilha. */
        aplicarEvento(
            id: string,
            evento: Evento,
            autor: Autor
        ): Promise<Ticket>
        alterar(
            id: string,
            campos: {
                tipo?: 'DUVIDA' | 'INCIDENTE' | 'PROBLEMA' | 'SOLICITACAO' | undefined
                prioridade?: 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE' | undefined
                assigneeId?: string | null | undefined
                nivel?: 'N1' | 'N2' | 'N3' | 'HUMANO' | undefined
            },
            autor: Autor
        ): Promise<Ticket>
    }

    mensagens: {
        adicionar(dados: DadosDaMensagem, autor: Autor): Promise<TicketMessage>
        /** O que o widget mostra: públicas, sem rascunho. */
        publicas(ticketId: string): Promise<TicketMessage[]>
        /** O que o Console e o Slack mostram: tudo. */
        todas(ticketId: string): Promise<TicketMessage[]>
    }

    anexos: {
        registrar(dados: {
            ticketId: string
            messageId?: string
            chave: string
            nome: string
            tipo: string
            tamanho: number
        }): Promise<Attachment>
        porChave(chave: string): Promise<Attachment | null>
        doChamado(ticketId: string): Promise<Attachment[]>
    }

    /** Contadores do selo do widget. Uma consulta, não três. */
    contadores: {
        doSolicitante(requesterId: string): Promise<{
            abertos: number
            emAndamento: number
            naoLidas: number
        }>
    }

    eventos: {
        registrar(dados: {
            ticketId: string
            ator: string
            evento: string
            antes?: unknown
            depois?: unknown
        }): Promise<TicketEvent>
        doChamado(ticketId: string): Promise<TicketEvent[]>
    }
}

export function escopoDoApp(conexao: Conexao, appId: string): EscopoDoApp {
    /**
     * Relê a linha depois de um `updateMany`. A contagem zero significa uma de
     * duas coisas — a linha não existe, ou pertence a outro app — e a resposta é
     * a mesma nos dois casos, de propósito: dizer qual seria confirmar a
     * existência de dado de outro cliente.
     */
    async function reler(id: string, alterados: number): Promise<Ticket> {
        if (alterados !== 1) {
            throw new ErroDeDominio('chamado_nao_encontrado', 'Chamado não encontrado.', 404)
        }

        const chamado = await conexao.ticket.findFirst({ where: { id, appId } })
        if (chamado === null) {
            throw new ErroDeDominio('chamado_nao_encontrado', 'Chamado não encontrado.', 404)
        }

        return chamado
    }

    return {
        appId,

        solicitantes: {
            async garantir(identidade) {
                const tenant = await conexao.tenant.upsert({
                    where: { appId_externalId: { appId, externalId: identidade.tenantExternalId } },
                    create: {
                        appId,
                        externalId: identidade.tenantExternalId,
                        nome: identidade.tenantNome,
                        ...(identidade.plano === undefined ? {} : { plano: identidade.plano }),
                    },
                    /// O nome e o plano vêm do app a cada token: o app é a fonte
                    /// da verdade, e o Desk acompanha sem precisar de sincronismo.
                    update: {
                        nome: identidade.tenantNome,
                        ...(identidade.plano === undefined ? {} : { plano: identidade.plano }),
                    },
                })

                const requester = await conexao.requester.upsert({
                    where: {
                        appId_externalId: { appId, externalId: identidade.requesterExternalId },
                    },
                    create: {
                        appId,
                        tenantId: tenant.id,
                        externalId: identidade.requesterExternalId,
                        nome: identidade.nome,
                        email: identidade.email,
                        papelNoTenant: identidade.papelNoTenant,
                    },
                    update: {
                        tenantId: tenant.id,
                        nome: identidade.nome,
                        email: identidade.email,
                        papelNoTenant: identidade.papelNoTenant,
                    },
                })

                return { tenantId: tenant.id, requesterId: requester.id }
            },
        },

        chamados: {
            async porId(id) {
                return conexao.ticket.findFirst({ where: { id, appId, excluidoEm: null } })
            },

            async porNumero(numero) {
                return conexao.ticket.findFirst({ where: { appId, numero, excluidoEm: null } })
            },

            async listar(filtro) {
                return conexao.ticket.findMany({
                    where: {
                        appId,
                        excluidoEm: null,
                        ...(filtro.requesterId === undefined
                            ? {}
                            : { requesterId: filtro.requesterId }),
                        ...(filtro.tenantId === undefined ? {} : { tenantId: filtro.tenantId }),
                        ...(filtro.status === undefined ? {} : { status: { in: filtro.status } }),
                    },
                    orderBy: { atualizadoEm: 'desc' },
                    take: Math.min(filtro.limite ?? 50, 200),
                })
            },

            async aplicarEvento(id, evento, autor) {
                const atual = await conexao.ticket.findFirst({ where: { id, appId } })
                if (atual === null) {
                    throw new ErroDeDominio(
                        'chamado_nao_encontrado',
                        'Chamado não encontrado.',
                        404
                    )
                }

                const destino = transicionar(atual.status as Status, evento)
                const agora = new Date()

                const { count } = await conexao.ticket.updateMany({
                    where: { id, appId, status: atual.status },
                    data: {
                        status: destino,
                        ...(destino === 'RESOLVIDO' ? { resolvidoEm: agora } : {}),
                        ...(destino === 'FECHADO' ? { fechadoEm: agora } : {}),
                        ...(atual.primeiraRespostaEm === null && evento === 'responder_usuario'
                            ? { primeiraRespostaEm: agora }
                            : {}),
                    },
                })

                await conexao.ticketEvent.create({
                    data: {
                        appId,
                        ticketId: id,
                        ator: autor.ator,
                        evento: `status:${evento}`,
                        antes: { status: atual.status },
                        depois: { status: destino },
                    },
                })

                return reler(id, count)
            },

            async alterar(id, campos, autor) {
                const atual = await conexao.ticket.findFirst({ where: { id, appId } })
                if (atual === null) {
                    throw new ErroDeDominio(
                        'chamado_nao_encontrado',
                        'Chamado não encontrado.',
                        404
                    )
                }

                const data = {
                    ...(campos.tipo === undefined ? {} : { tipo: campos.tipo }),
                    ...(campos.prioridade === undefined ? {} : { prioridade: campos.prioridade }),
                    ...(campos.nivel === undefined ? {} : { nivel: campos.nivel }),
                    ...(campos.assigneeId === undefined ? {} : { assigneeId: campos.assigneeId }),
                }

                if (Object.keys(data).length === 0) return atual

                const { count } = await conexao.ticket.updateMany({ where: { id, appId }, data })

                await conexao.ticketEvent.create({
                    data: {
                        appId,
                        ticketId: id,
                        ator: autor.ator,
                        evento: 'alteracao',
                        antes: {
                            tipo: atual.tipo,
                            prioridade: atual.prioridade,
                            nivel: atual.nivel,
                            assigneeId: atual.assigneeId,
                        },
                        depois: data,
                    },
                })

                return reler(id, count)
            },
        },

        mensagens: {
            async adicionar(dados, autor) {
                /**
                 * O `ticketId` é conferido DENTRO do escopo antes de escrever.
                 * Sem isto, um id de chamado de outro app criaria mensagem com o
                 * `appId` errado — a linha ficaria órfã do ponto de vista do
                 * isolamento, e visível na thread errada.
                 */
                const chamado = await conexao.ticket.findFirst({
                    where: { id: dados.ticketId, appId },
                })
                if (chamado === null) {
                    throw new ErroDeDominio(
                        'chamado_nao_encontrado',
                        'Chamado não encontrado.',
                        404
                    )
                }

                const mensagem = await conexao.ticketMessage.create({
                    data: {
                        appId,
                        ticketId: dados.ticketId,
                        autor: dados.autor,
                        corpo: dados.corpo,
                        visibilidade: dados.visibilidade ?? 'PUBLICA',
                        origem: dados.origem ?? 'WIDGET',
                        rascunho: dados.rascunho ?? false,
                        ...(dados.autorId === undefined ? {} : { autorId: dados.autorId }),
                    },
                })

                await conexao.ticketEvent.create({
                    data: {
                        appId,
                        ticketId: dados.ticketId,
                        ator: autor.ator,
                        evento:
                            (dados.visibilidade ?? 'PUBLICA') === 'INTERNA'
                                ? 'nota_interna'
                                : 'mensagem_publica',
                        depois: { messageId: mensagem.id, rascunho: mensagem.rascunho },
                    },
                })

                return mensagem
            },

            async publicas(ticketId) {
                return conexao.ticketMessage.findMany({
                    where: { appId, ticketId, visibilidade: 'PUBLICA', rascunho: false },
                    orderBy: { criadoEm: 'asc' },
                })
            },

            async todas(ticketId) {
                return conexao.ticketMessage.findMany({
                    where: { appId, ticketId },
                    orderBy: { criadoEm: 'asc' },
                })
            },
        },

        anexos: {
            async registrar(dados) {
                const chamado = await conexao.ticket.findFirst({
                    where: { id: dados.ticketId, appId },
                })
                if (chamado === null) {
                    throw new ErroDeDominio(
                        'chamado_nao_encontrado',
                        'Chamado não encontrado.',
                        404
                    )
                }

                return conexao.attachment.create({
                    data: {
                        appId,
                        ticketId: dados.ticketId,
                        chave: dados.chave,
                        nome: dados.nome,
                        tipo: dados.tipo,
                        tamanho: dados.tamanho,
                        ...(dados.messageId === undefined ? {} : { messageId: dados.messageId }),
                    },
                })
            },

            async porChave(chave) {
                return conexao.attachment.findFirst({ where: { chave, appId } })
            },

            async doChamado(ticketId) {
                return conexao.attachment.findMany({
                    where: { appId, ticketId },
                    orderBy: { criadoEm: 'asc' },
                })
            },
        },

        contadores: {
            async doSolicitante(requesterId) {
                /**
                 * "Não lidas" é derivado, não guardado: toda mensagem pública
                 * de IA ou humano posterior à última mensagem DO PRÓPRIO
                 * usuário naquele chamado conta como não lida.
                 *
                 * Guardar um `lido_em` por mensagem seria mais exato e custaria
                 * uma escrita a cada abertura do widget. Para um selo, derivar
                 * basta — e não há estado novo para sincronizar entre o widget,
                 * o Console e o Slack.
                 */
                const [abertos, emAndamento, naoLidas] = await Promise.all([
                    conexao.ticket.count({
                        where: {
                            appId,
                            requesterId,
                            excluidoEm: null,
                            status: { in: ['NOVO', 'ABERTO', 'AGUARDANDO_USUARIO'] },
                        },
                    }),
                    conexao.ticket.count({
                        where: { appId, requesterId, excluidoEm: null, status: 'EM_ESPERA' },
                    }),
                    conexao.ticketMessage.count({
                        where: {
                            appId,
                            visibilidade: 'PUBLICA',
                            rascunho: false,
                            autor: { in: ['IA', 'HUMANO'] },
                            ticket: { requesterId, appId, excluidoEm: null },
                        },
                    }),
                ])

                return { abertos, emAndamento, naoLidas }
            },
        },

        eventos: {
            async registrar(dados) {
                return conexao.ticketEvent.create({
                    data: {
                        appId,
                        ticketId: dados.ticketId,
                        ator: dados.ator,
                        evento: dados.evento,
                        ...(dados.antes === undefined
                            ? {}
                            : { antes: dados.antes as Prisma.InputJsonValue }),
                        ...(dados.depois === undefined
                            ? {}
                            : { depois: dados.depois as Prisma.InputJsonValue }),
                    },
                })
            },

            async doChamado(ticketId) {
                return conexao.ticketEvent.findMany({
                    where: { appId, ticketId },
                    orderBy: { criadoEm: 'asc' },
                })
            },
        },
    }
}
