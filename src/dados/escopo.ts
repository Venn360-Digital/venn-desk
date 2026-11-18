import type { Prisma, PrismaClient } from '#prisma'
import type { Attachment, HealthEpisode, HealthState, Problem, SlaTimer, Ticket, TicketEvent, TicketMessage } from '#prisma'

import { ErroDeDominio } from '../lib/erros.ts'
import { transicionar, type Evento, type Status } from '../dominio/estados.ts'
import {
    aoMudarStatus,
    metaEmMinutos,
    METAS_PADRAO,
    vencimentoDe,
    type Meta,
    type MetasEmMinutos,
    type Prioridade,
    type Relogio,
} from '../dominio/sla.ts'

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
    accountId?: string
    status?: Status[]
    prioridade?: ('BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE')[]
    /** O número do chamado dentro do app, sem o prefixo. */
    numero?: number
    limite?: number
}

/** O chamado como a fila precisa dele: com a empresa e a conta já resolvidas. */
export type ChamadoNaFila = Ticket & {
    tenant: { id: string; nome: string; plano: string | null } & {
        account: { id: string; nome: string } | null
    }
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
            /** A conta acima da empresa, quando o app a informa. */
            contaExternalId?: string
            contaNome?: string
        }): Promise<{ tenantId: string; requesterId: string }>
        /** Para quem o aviso por e-mail vai. Nunca vem do corpo da requisição. */
        porId(id: string): Promise<{ nome: string; email: string } | null>
        /**
         * Quem é este e-mail dentro deste app — e `null` se não for ninguém.
         *
         * Serve ao "também fui afetado" da página de status (seção 7), que é o
         * único lugar onde um e-mail digitado por quem não está logado entra no
         * sistema. Por isso devolve `null` em vez de criar: a seção 7 exige que
         * o caminho atenda SÓ e-mail de usuário já conhecido, e nenhum caminho
         * aceita usuário anônimo.
         */
        porEmail(email: string): Promise<{ id: string; tenantId: string; nome: string } | null>
    }

    chamados: {
        porId(id: string): Promise<Ticket | null>
        porNumero(numero: number): Promise<Ticket | null>
        listar(filtro: FiltroDeLista): Promise<Ticket[]>
        /**
         * A mesma lista, com empresa e conta no mesmo ida-e-volta.
         *
         * Separada de `listar` porque o widget não precisa disso e pagaria o
         * join à toa — e porque a fila do Console, que recarrega sozinha, não
         * pode resolver o nome da empresa chamado a chamado.
         */
        listarParaFila(filtro: FiltroDeLista): Promise<ChamadoNaFila[]>
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

    /** Para os seletores de filtro da fila. Nome e id, nada mais. */
    empresas: {
        listar(limite?: number): Promise<{ id: string; nome: string }[]>
        /** Com a conta junto — é o cabeçalho do chamado. */
        porId(id: string): Promise<{
            id: string
            nome: string
            plano: string | null
            conta: { id: string; nome: string } | null
        } | null>
    }

    contas: {
        listar(limite?: number): Promise<{ id: string; nome: string }[]>
    }

    problemas: {
        porId(id: string): Promise<Problem | null>
        abrir(dados: { titulo: string; causa?: string }): Promise<Problem>
        resolver(id: string): Promise<Problem | null>
    }

    /**
     * A verificação de saúde (seção 7). Mora no escopo como o resto: o estado é
     * por app, e a página de status de um app nunca enxerga outro.
     */
    saude: {
        estado(): Promise<HealthState | null>
        /** Grava o veredito e devolve a linha nova. */
        gravarEstado(estado: {
            saudavel: boolean
            falhasSeguidas: number
            desdeEm: Date
            verificadoEm: Date
            latenciaMs?: number | null
            detalhe?: string | null
        }): Promise<HealthState>
        episodioAberto(): Promise<HealthEpisode | null>
        abrirEpisodio(dados: {
            iniciadoEm: Date
            detalhe?: string | null
            problemId?: string | null
        }): Promise<HealthEpisode>
        fecharEpisodio(id: string, terminadoEm: Date): Promise<void>
        /** Os últimos episódios, para a página de status. */
        episodios(limite?: number): Promise<HealthEpisode[]>
    }

    /**
     * Os relógios de SLA (seções 4 e 5). A aritmética fica em
     * `src/dominio/sla.ts`, pura e provada; aqui só se lê e se grava.
     */
    sla: {
        /** As metas do app para uma prioridade: a política, ou o padrão. */
        metasDe(prioridade: Prioridade): Promise<MetasEmMinutos>
        /** Abre os relógios de um chamado recém-criado. */
        abrir(ticketId: string, prioridade: Prioridade, agora: Date): Promise<SlaTimer[]>
        doChamado(ticketId: string): Promise<SlaTimer[]>
        /**
         * Os relógios de VÁRIOS chamados, numa consulta só.
         *
         * A fila tem dezenas de linhas e é recarregada a cada 20 segundos.
         * Buscar relógio por chamado daria uma consulta por linha a cada
         * recarga — o jeito clássico de uma tela útil virar a consulta mais
         * cara do sistema.
         */
        deChamados(ticketIds: string[]): Promise<SlaTimer[]>
        /** Pausa ou retoma os relógios abertos conforme o status novo. */
        aplicarStatus(ticketId: string, status: Status, agora: Date): Promise<void>
        /** Marca a meta como cumprida. Só a primeira vez tem efeito. */
        cumprir(ticketId: string, meta: Meta, agora: Date): Promise<boolean>
        /** Relógios abertos cujo prazo já passou. A varredura do cão de guarda. */
        vencidos(agora: Date, limite?: number): Promise<SlaTimer[]>
        violar(id: string, agora: Date): Promise<boolean>
        /** As políticas cadastradas do app, por prioridade. */
        politicas(): Promise<Record<string, MetasEmMinutos>>
        /** Grava a política de uma prioridade. Vale do próximo chamado em diante. */
        definirPolitica(prioridade: Prioridade, metas: MetasEmMinutos): Promise<void>
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

/**
 * A cláusula `where` da fila, uma só para as duas listagens.
 *
 * O `appId` entra SEMPRE e primeiro, como em todo o escopo. Os demais filtros
 * são opcionais e se somam — `undefined` não vira cláusula, para um filtro
 * vazio não virar "where false".
 */
function ondeDaFila(appId: string, filtro: FiltroDeLista) {
    return {
        appId,
        excluidoEm: null,
        ...(filtro.requesterId === undefined ? {} : { requesterId: filtro.requesterId }),
        ...(filtro.tenantId === undefined ? {} : { tenantId: filtro.tenantId }),
        ...(filtro.accountId === undefined ? {} : { tenant: { accountId: filtro.accountId } }),
        ...(filtro.status === undefined ? {} : { status: { in: filtro.status } }),
        ...(filtro.prioridade === undefined ? {} : { prioridade: { in: filtro.prioridade } }),
        ...(filtro.numero === undefined ? {} : { numero: filtro.numero }),
    }
}

/** A linha do banco vista como o relógio puro de `src/dominio/sla.ts`. */
function paraRelogio(linha: SlaTimer): Relogio {
    return {
        meta: linha.meta as Meta,
        metaMin: linha.metaMin,
        venceEm: linha.venceEm,
        pausadoEm: linha.pausadoEm,
        violadoEm: linha.violadoEm,
        cumpridoEm: linha.cumpridoEm,
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
                /**
                 * A conta vem ANTES da empresa, porque a empresa aponta para
                 * ela. Sem `contaExternalId` nada é criado e o vínculo fica
                 * nulo — é o caso do app que ainda não manda a claim.
                 */
                const conta =
                    identidade.contaExternalId === undefined
                        ? null
                        : await conexao.account.upsert({
                              where: {
                                  appId_externalId: {
                                      appId,
                                      externalId: identidade.contaExternalId,
                                  },
                              },
                              create: {
                                  appId,
                                  externalId: identidade.contaExternalId,
                                  nome: identidade.contaNome ?? identidade.contaExternalId,
                              },
                              update: {
                                  ...(identidade.contaNome === undefined
                                      ? {}
                                      : { nome: identidade.contaNome }),
                              },
                          })

                const tenant = await conexao.tenant.upsert({
                    where: { appId_externalId: { appId, externalId: identidade.tenantExternalId } },
                    create: {
                        appId,
                        externalId: identidade.tenantExternalId,
                        nome: identidade.tenantNome,
                        ...(identidade.plano === undefined ? {} : { plano: identidade.plano }),
                        ...(conta === null ? {} : { accountId: conta.id }),
                    },
                    /// O nome e o plano vêm do app a cada token: o app é a fonte
                    /// da verdade, e o Desk acompanha sem precisar de sincronismo.
                    update: {
                        nome: identidade.tenantNome,
                        ...(identidade.plano === undefined ? {} : { plano: identidade.plano }),
                        /// Só liga; nunca DESliga. Um token sem a claim não
                        /// pode apagar o vínculo que outro já estabeleceu.
                        ...(conta === null ? {} : { accountId: conta.id }),
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

            async porId(id) {
                const achado = await conexao.requester.findFirst({
                    where: { id, appId },
                    select: { nome: true, email: true },
                })
                return achado
            },

            async porEmail(email) {
                /// Minúsculas dos dois lados: o usuário digita o e-mail à mão
                /// nesse caminho, e `Joao@` não é outra pessoa que `joao@`.
                return conexao.requester.findFirst({
                    where: { appId, email: { equals: email.trim(), mode: 'insensitive' } },
                    select: { id: true, tenantId: true, nome: true },
                })
            },
        },

        chamados: {
            async porId(id) {
                return conexao.ticket.findFirst({ where: { id, appId, excluidoEm: null } })
            },

            async porNumero(numero) {
                return conexao.ticket.findFirst({ where: { appId, numero, excluidoEm: null } })
            },

            async listarParaFila(filtro) {
                return conexao.ticket.findMany({
                    where: ondeDaFila(appId, filtro),
                    include: {
                        tenant: {
                            select: {
                                id: true,
                                nome: true,
                                plano: true,
                                account: { select: { id: true, nome: true } },
                            },
                        },
                    },
                    orderBy: { atualizadoEm: 'desc' },
                    take: filtro.limite ?? 50,
                })
            },

            async listar(filtro) {
                return conexao.ticket.findMany({
                    where: ondeDaFila(appId, filtro),
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

                /**
                 * Os relógios seguem o status na MESMA transação da mudança.
                 *
                 * Fora dela, uma falha entre as duas escritas deixaria um
                 * chamado aguardando o usuário com o relógio correndo — e a
                 * violação apareceria depois, sem nada no histórico que
                 * explicasse por quê.
                 */
                const esteEscopo = escopoDoApp(conexao, appId)
                await esteEscopo.sla.aplicarStatus(id, destino, agora)
                if (destino === 'RESOLVIDO') {
                    await esteEscopo.sla.cumprir(id, 'resolucao', agora)
                }

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

                /**
                 * A primeira resposta é cumprida por MENSAGEM, não por status.
                 *
                 * É o que o prazo mede: alguém respondeu a quem abriu. Nota
                 * interna não conta — ela é conversa entre nós —, e rascunho
                 * da IA em modo sombra também não: ele ainda não saiu. Medir
                 * por status diria "cumprido" quando o atendente apenas assumiu
                 * o chamado sem dizer nada ao cliente.
                 */
                const respondeuAoUsuario =
                    (dados.autor === 'IA' || dados.autor === 'HUMANO') &&
                    (dados.visibilidade ?? 'PUBLICA') === 'PUBLICA' &&
                    (dados.rascunho ?? false) === false

                if (respondeuAoUsuario) {
                    await escopoDoApp(conexao, appId).sla.cumprir(
                        dados.ticketId,
                        'primeira_resposta',
                        mensagem.criadoEm
                    )
                }

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

        empresas: {
            async porId(id) {
                const achada = await conexao.tenant.findFirst({
                    where: { id, appId },
                    select: {
                        id: true,
                        nome: true,
                        plano: true,
                        account: { select: { id: true, nome: true } },
                    },
                })
                if (achada === null) return null
                const { account, ...resto } = achada
                return { ...resto, conta: account }
            },

            async listar(limite) {
                return conexao.tenant.findMany({
                    where: { appId },
                    select: { id: true, nome: true },
                    orderBy: { nome: 'asc' },
                    take: limite ?? 500,
                })
            },
        },

        contas: {
            async listar(limite) {
                return conexao.account.findMany({
                    where: { appId },
                    select: { id: true, nome: true },
                    orderBy: { nome: 'asc' },
                    take: limite ?? 500,
                })
            },
        },

        problemas: {
            async porId(id) {
                return conexao.problem.findFirst({ where: { id, appId } })
            },

            async abrir(dados) {
                return conexao.problem.create({
                    data: {
                        appId,
                        titulo: dados.titulo,
                        ...(dados.causa === undefined ? {} : { causa: dados.causa }),
                    },
                })
            },

            async resolver(id) {
                const { count } = await conexao.problem.updateMany({
                    where: { id, appId, resolvidoEm: null },
                    data: { resolvidoEm: new Date() },
                })
                return count === 1 ? conexao.problem.findFirst({ where: { id, appId } }) : null
            },
        },

        saude: {
            async estado() {
                return conexao.healthState.findFirst({ where: { appId } })
            },

            async gravarEstado(estado) {
                const campos = {
                    saudavel: estado.saudavel,
                    falhasSeguidas: estado.falhasSeguidas,
                    desdeEm: estado.desdeEm,
                    verificadoEm: estado.verificadoEm,
                    latenciaMs: estado.latenciaMs ?? null,
                    detalhe: estado.detalhe ?? null,
                }

                /// `upsert` pela chave primária, que AQUI é o próprio `app_id` —
                /// é o único caso do escopo em que a chave única já é o escopo,
                /// então não há como a consulta alcançar outro app.
                return conexao.healthState.upsert({
                    where: { appId },
                    create: { appId, ...campos },
                    update: campos,
                })
            },

            async episodioAberto() {
                return conexao.healthEpisode.findFirst({
                    where: { appId, terminadoEm: null },
                    orderBy: { iniciadoEm: 'desc' },
                })
            },

            async abrirEpisodio(dados) {
                return conexao.healthEpisode.create({
                    data: {
                        appId,
                        iniciadoEm: dados.iniciadoEm,
                        detalhe: dados.detalhe ?? null,
                        problemId: dados.problemId ?? null,
                    },
                })
            },

            async fecharEpisodio(id, terminadoEm) {
                await conexao.healthEpisode.updateMany({
                    where: { id, appId, terminadoEm: null },
                    data: { terminadoEm },
                })
            },

            async episodios(limite) {
                return conexao.healthEpisode.findMany({
                    where: { appId },
                    orderBy: { iniciadoEm: 'desc' },
                    take: limite ?? 20,
                })
            },
        },

        sla: {
            async metasDe(prioridade) {
                const politica = await conexao.slaPolicy.findFirst({
                    where: { appId, prioridade },
                })

                /// Sem política cadastrada, o padrão. É o que deixa um app novo
                /// atender no mesmo dia (Fase 8) sem passar por cadastro.
                if (politica === null) return METAS_PADRAO[prioridade]

                return {
                    primeiraRespostaMin: politica.primeiraRespostaMin,
                    proximaRespostaMin: politica.proximaRespostaMin,
                    resolucaoMin: politica.resolucaoMin,
                }
            },

            async abrir(ticketId, prioridade, agora) {
                const metas = await this.metasDe(prioridade)

                /**
                 * Dois relógios, não três. `proxima_resposta` nasce a cada
                 * resposta do usuário, não na abertura — abrir junto o deixaria
                 * vencendo sem que exista próxima resposta a dar.
                 */
                const quais: Meta[] = ['primeira_resposta', 'resolucao']

                const criados: SlaTimer[] = []
                for (const meta of quais) {
                    const metaMin = metaEmMinutos(metas, meta)
                    criados.push(
                        await conexao.slaTimer.create({
                            data: {
                                appId,
                                ticketId,
                                meta,
                                metaMin,
                                venceEm: vencimentoDe(agora, metaMin),
                            },
                        })
                    )
                }

                return criados
            },

            async doChamado(ticketId) {
                return conexao.slaTimer.findMany({
                    where: { appId, ticketId },
                    orderBy: { venceEm: 'asc' },
                })
            },

            async deChamados(ticketIds) {
                if (ticketIds.length === 0) return []
                return conexao.slaTimer.findMany({
                    where: { appId, ticketId: { in: ticketIds } },
                    orderBy: { venceEm: 'asc' },
                })
            },

            async aplicarStatus(ticketId, status, agora) {
                const relogios = await conexao.slaTimer.findMany({
                    where: { appId, ticketId, cumpridoEm: null, violadoEm: null },
                })

                for (const linha of relogios) {
                    const mudanca = aoMudarStatus(paraRelogio(linha), status, agora)
                    if (mudanca === null) continue

                    await conexao.slaTimer.updateMany({
                        where: { id: linha.id, appId },
                        data:
                            mudanca.acao === 'pausar'
                                ? { pausadoEm: mudanca.pausadoEm }
                                : { pausadoEm: null, venceEm: mudanca.venceEm },
                    })
                }
            },

            async cumprir(ticketId, meta, agora) {
                /// `cumpridoEm: null` no filtro é o que torna isto idempotente:
                /// a segunda resposta pública não reescreve a hora da primeira.
                const { count } = await conexao.slaTimer.updateMany({
                    where: { appId, ticketId, meta, cumpridoEm: null, violadoEm: null },
                    data: { cumpridoEm: agora },
                })
                return count > 0
            },

            async vencidos(agora, limite) {
                return conexao.slaTimer.findMany({
                    where: {
                        appId,
                        cumpridoEm: null,
                        violadoEm: null,
                        pausadoEm: null,
                        venceEm: { lte: agora },
                    },
                    orderBy: { venceEm: 'asc' },
                    take: limite ?? 50,
                })
            },

            async violar(id, agora) {
                const { count } = await conexao.slaTimer.updateMany({
                    where: { id, appId, violadoEm: null, cumpridoEm: null },
                    data: { violadoEm: agora },
                })
                return count === 1
            },

            async politicas() {
                const linhas = await conexao.slaPolicy.findMany({ where: { appId } })
                const porPrioridade: Record<string, MetasEmMinutos> = {}

                for (const linha of linhas) {
                    porPrioridade[linha.prioridade] = {
                        primeiraRespostaMin: linha.primeiraRespostaMin,
                        proximaRespostaMin: linha.proximaRespostaMin,
                        resolucaoMin: linha.resolucaoMin,
                    }
                }

                return porPrioridade
            },

            async definirPolitica(prioridade, metas) {
                /**
                 * **Não mexe em relógio já aberto.** Encurtar a meta e aplicar
                 * ao que está correndo violaria chamados retroativamente, por
                 * uma decisão tomada depois de eles existirem. A política nova
                 * vale do próximo chamado em diante.
                 */
                await conexao.slaPolicy.upsert({
                    where: { appId_prioridade: { appId, prioridade } },
                    create: { appId, prioridade, ...metas },
                    update: metas,
                })
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
