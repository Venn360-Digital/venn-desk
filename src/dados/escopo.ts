import type { Prisma, PrismaClient } from '#prisma'
import type { Attachment, CsatResponse, HealthEpisode, HealthState, KbArticle, KbEvento, KbSincronizacao, Problem, SlaTimer, Ticket, TicketEvent, TicketMessage } from '#prisma'

import { ErroDeDominio } from '../lib/erros.ts'
import { transicionar, type Evento, type Status } from '../dominio/estados.ts'
import {
    podeEditarAMao,
    textoDeBusca,
    transicoesPermitidas,
    VISIVEL,
    type DadosDoArtigo,
    type EdicaoDoArtigo,
    type OrigemDoArtigo,
    type StatusDoArtigo,
} from '../dominio/artigo.ts'
import { fundir, parecidos } from '../dominio/busca.ts'
import type { ChamadoMedido } from '../dominio/relatorio.ts'
import type { ConsultaRegistrada } from '../dominio/consultas.ts'
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

/** O que a sincronização grava de cada artigo derivado. */
export interface ArtigoDerivado {
    /** `derivado:<fonte>:<slug>`, estável entre sincronizações. */
    chave: string
    titulo: string
    corpo: string
    tags: string[]
    fonte: Prisma.InputJsonValue
    dados: Prisma.InputJsonValue
    /** Nasce PUBLICADO (true) ou RASCUNHO (false). Só vale na criação. */
    publicarDireto: boolean
    agora: Date
}

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
         * Os nomes de vários solicitantes, numa consulta, para a trilha.
         *
         * Passa pelo escopo como tudo: um id de solicitante vazado de outro app
         * não vira nome aqui — devolve nada, e a trilha mostra o id cru, que é
         * o comportamento certo para "não é deste app".
         */
        nomes(ids: string[]): Promise<{ id: string; nome: string }[]>
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
        /** Liga o chamado ao defeito que o explica (Fase 5). */
        vincularProblema(id: string, problemId: string, autor: Autor): Promise<Ticket>
    }

    mensagens: {
        adicionar(dados: DadosDaMensagem, autor: Autor): Promise<TicketMessage>
        /** O que o widget mostra: públicas, sem rascunho e sem descartada. */
        publicas(ticketId: string): Promise<TicketMessage[]>
        /** O que o Console e o Slack mostram: tudo, inclusive o descartado. */
        todas(ticketId: string): Promise<TicketMessage[]>
        /**
         * Aprova o rascunho do modo sombra e o torna mensagem de verdade.
         *
         * `corpo` presente significa que o humano EDITOU — e é essa diferença,
         * e não o fato de ter enviado, que decide quando o app sai do modo
         * sombra (seção 4).
         */
        aprovarRascunho(
            id: string,
            dados: { corpo?: string | undefined },
            autor: Autor
        ): Promise<TicketMessage>
        descartarRascunho(id: string, autor: Autor): Promise<TicketMessage>
        /** Os rascunhos pendentes de um chamado. */
        rascunhos(ticketId: string): Promise<TicketMessage[]>
        /**
         * A medida que a seção 4 pede: dos últimos rascunhos decididos, quantos
         * saíram sem ninguém mexer.
         */
        placarDoModoSombra(ultimos?: number): Promise<{
            decididos: number
            enviados: number
            semEdicao: number
            descartados: number
        }>
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
     * A nota de satisfação (seção 12). Uma por chamado — o banco tem `@unique`
     * em `ticketId`, e reavaliar substitui em vez de acumular: um chamado
     * reaberto e resolvido de novo vale pela última experiência, não pela
     * primeira.
     */
    csat: {
        doChamado(ticketId: string): Promise<CsatResponse | null>
        registrar(dados: {
            ticketId: string
            nota: number
            comentario?: string
            atendidoPelaIa: boolean
        }): Promise<CsatResponse>
        /** Todas as notas do app, para o resumo. */
        todas(): Promise<{ nota: number; atendidoPelaIa: boolean }[]>
    }

    /**
     * O cru do painel (seção 12).
     *
     * Devolve FATOS por chamado — tempos, quem respondeu, custo — e nenhuma
     * conta. A agregação mora em `src/dominio/relatorio.ts`, onde roda sem
     * banco e tem teste; aqui ficaria sem prova e com `appId` misturado à
     * estatística.
     */
    painel: {
        chamadosMedidos(desde: Date): Promise<ChamadoMedido[]>
        relogiosEncerrados(desde: Date): Promise<{ violadoEm: Date | null; cumpridoEm: Date | null }[]>
    }

    /**
     * A base de conhecimento (seção 6). Única família onde a linha pode NÃO
     * ter app: artigo global vale para os três, por `app_id (ou global)` da
     * especificação. Ver `ondeDoArtigo` abaixo, que é onde isso mora.
     */
    artigos: {
        listar(filtro?: { status?: StatusDoArtigo; origem?: OrigemDoArtigo }): Promise<KbArticle[]>
        porId(id: string): Promise<KbArticle | null>
        /** Pela chave estável do derivado. Só deste app: derivado nunca é global. */
        porChave(chave: string): Promise<KbArticle | null>
        criar(dados: DadosDoArtigo): Promise<KbArticle>
        /**
         * Edição à mão. Recusa com 409 quando o artigo é DERIVADO: a correção
         * duraria até a próxima sincronização e sumiria sem aviso. A mensagem
         * diz onde mudar.
         */
        alterar(id: string, dados: EdicaoDoArtigo): Promise<KbArticle | null>
        /**
         * Muda o status respeitando as transições da origem. Quando uma
         * PESSOA muda o status de um derivado, o `ator` fica em
         * `statusFixadoPor` e a sincronização passa a não tocar nele.
         */
        mudarStatus(id: string, para: StatusDoArtigo, opcoes?: { ator?: string }): Promise<KbArticle>
        /**
         * Só artigos publicados, ordenados por relevância. Usada pelo agente.
         *
         * Com `vetor`, a busca é HÍBRIDA: palavra e cosseno fundidos por
         * posição (RRF). Sem ele, só palavra — é o fallback quando o Workers
         * AI não respondeu, e a razão de a assinatura aceitar os dois.
         */
        buscar(
            texto: string,
            limite: number,
            opcoes?: { vetor?: number[] }
        ): Promise<{ artigo: KbArticle; nota: number }[]>
        /**
         * Grava o que foi perguntado e o que voltou. Devolve o id, para a
         * leitura inteira que vier depois se ligar a esta busca.
         */
        registrarConsulta(dados: {
            texto: string
            origem: string
            ticketId?: string
            artigosDevolvidos: string[]
        }): Promise<{ id: string }>
        /** A busca levou a uma leitura inteira. */
        marcarLeitura(consultaId: string, artigoId: string): Promise<void>
        /** As consultas do período, para o resumo. */
        consultas(desde: Date): Promise<ConsultaRegistrada[]>

        /**
         * Grava (ou regrava) um artigo derivado, pela chave.
         *
         * É um upsert: a mesma chave no mesmo app atualiza em vez de duplicar.
         * O `status` NÃO é tocado na atualização — quem decide se o artigo
         * está no ar é a primeira gravação (`publicarDireto`) e, depois, uma
         * pessoa. A exceção é o artigo ARQUIVADO pela sincronização cuja
         * fonte voltou: ele reabre, a menos que uma pessoa o tenha fixado.
         *
         * Devolve o efeito, para o resultado da sincronização contar criados,
         * atualizados e inalterados — e para "inalterado" não gerar escrita.
         */
        sincronizarDerivado(dados: ArtigoDerivado): Promise<{
            artigo: KbArticle
            efeito: 'criado' | 'atualizado' | 'inalterado' | 'reaberto'
        }>
        /** Marca os derivados conferidos nesta rodada, numa escrita só. */
        tocarDerivados(chaves: string[], agora: Date): Promise<void>
        /**
         * Arquiva os derivados deste prefixo cuja chave NÃO está entre as
         * vivas: a fonte sumiu. Devolve os arquivados, para os eventos.
         */
        arquivarDerivadosFora(prefixoDaChave: string, chavesVivas: string[]): Promise<KbArticle[]>
        /** Um rascunho SUGERIDO, para uma pessoa aprovar. */
        criarSugerido(dados: {
            titulo: string
            corpo: string
            tags: string[]
            fonte: Prisma.InputJsonValue
        }): Promise<KbArticle>
        /** Grava o vetor da busca semântica. SQL cru: o Prisma não tem `vector`. */
        gravarEmbedding(id: string, vetor: number[]): Promise<void>
        /** Os publicados mais próximos do vetor, por cosseno. */
        buscarPorVetor(vetor: number[], limite: number): Promise<{ id: string; distancia: number }[]>
    }

    /** As sincronizações da base com o repositório (uma por app e commit). */
    sincronizacoes: {
        registrarPedido(dados: {
            repositorio: string
            commitSha: string
            pedidaPor: string
            forcada: boolean
        }): Promise<KbSincronizacao>
        porId(id: string): Promise<KbSincronizacao | null>
        iniciar(id: string, agora: Date): Promise<void>
        aguardarLote(id: string, loteId: string): Promise<void>
        concluir(id: string, resultado: Prisma.InputJsonValue, agora: Date): Promise<void>
        falhar(id: string, erro: string, agora: Date): Promise<void>
        /** A mais recente, em qualquer estado. */
        ultima(): Promise<KbSincronizacao | null>
        /** A mais recente que CONCLUIU: é dela que sai o sha anterior. */
        ultimaConcluida(): Promise<KbSincronizacao | null>
        /** Pedida ou em andamento, para não enfileirar duas. */
        emAndamento(): Promise<KbSincronizacao | null>
        listar(limite: number): Promise<KbSincronizacao[]>
    }

    /** A trilha dos artigos: quem fez o quê com cada um. */
    eventosDaBase: {
        registrar(dados: {
            artigoId: string
            ator: string
            evento: string
            antes?: Prisma.InputJsonValue
            depois?: Prisma.InputJsonValue
        }): Promise<void>
        doArtigo(artigoId: string): Promise<KbEvento[]>
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
        /**
         * Abre um relógio de uma meta específica, se já não houver um correndo.
         *
         * Serve a dois casos que o `abrir` da criação não cobre: a PRÓXIMA
         * resposta, que nasce quando o cliente volta a falar, e a resolução de
         * um chamado REABERTO — cujo relógio original foi cumprido, e cumprido
         * é final.
         */
        abrirSeNaoHouver(
            ticketId: string,
            meta: Meta,
            prioridade: Prioridade,
            agora: Date
        ): Promise<SlaTimer | null>
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
    /**
     * A cláusula do artigo: **deste app OU global**.
     *
     * É a única exceção à igualdade `appId: appId` em todo o sistema, e por
     * isso existe aqui, numa função, em vez de repetida em cada consulta da
     * família. Repetida, ela seria seis chances de alguém escrever
     * `{ appId: null }` sozinho — que devolveria os globais e mais nada — ou de
     * esquecer o `null` e sumir com eles.
     *
     * O que a regra de isolamento protege continua intacto: `appId` nulo não é
     * "qualquer app", é "nenhum app em particular". Não existe cláusula aqui
     * que alcance a linha de OUTRO app, e o teste de isolamento prova isso.
     */
    function ondeDoArtigo(): { OR: [{ appId: string }, { appId: null }] } {
        return { OR: [{ appId }, { appId: null }] }
    }

    /** JSON com chaves ordenadas em toda profundidade, para comparar com o que o JSONB devolve. */
    function jsonEstavel(valor: unknown): string {
        const ordenar = (v: unknown): unknown =>
            Array.isArray(v)
                ? v.map(ordenar)
                : v !== null && typeof v === 'object'
                  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, ordenar(x)]))
                  : v
        return JSON.stringify(ordenar(valor))
    }

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
            async nomes(ids) {
                if (ids.length === 0) return []

                return conexao.requester.findMany({
                    where: { id: { in: ids }, appId },
                    select: { id: true, nome: true },
                })
            },

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

                /**
                 * Reabriu: a resolução ganha um relógio NOVO.
                 *
                 * O anterior foi cumprido, e cumprido é final — reabrir não
                 * desfaz o fato de que houve uma resolução. Mas o chamado
                 * voltou a estar aberto, e sem relógio novo ele ficaria
                 * correndo sem prazo até alguém reparar.
                 */
                const reabriu =
                    (atual.status === 'RESOLVIDO' || atual.status === 'FECHADO') &&
                    destino !== 'RESOLVIDO' &&
                    destino !== 'FECHADO'

                if (reabriu) {
                    await esteEscopo.sla.abrirSeNaoHouver(
                        id,
                        'resolucao',
                        atual.prioridade as Prioridade,
                        agora
                    )
                }

                return reler(id, count)
            },

            async vincularProblema(id, problemId, autor) {
                const { count } = await conexao.ticket.updateMany({
                    where: { id, appId },
                    data: { problemId },
                })

                await conexao.ticketEvent.create({
                    data: {
                        appId,
                        ticketId: id,
                        ator: autor.ator,
                        evento: 'vinculo:problema',
                        depois: { problemId },
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

                const esteEscopoDeMensagem = escopoDoApp(conexao, appId)

                if (respondeuAoUsuario) {
                    await esteEscopoDeMensagem.sla.cumprir(
                        dados.ticketId,
                        'primeira_resposta',
                        mensagem.criadoEm
                    )
                    /// Respondeu: a bola volta para o cliente e o relógio da
                    /// próxima resposta, se estava correndo, foi cumprido.
                    await esteEscopoDeMensagem.sla.cumprir(
                        dados.ticketId,
                        'proxima_resposta',
                        mensagem.criadoEm
                    )
                }

                /**
                 * O cliente voltou a falar: nasce o relógio da PRÓXIMA
                 * resposta.
                 *
                 * Sem ele, um chamado já respondido uma vez ficava sem prazo
                 * nenhum correndo — a fila mostrava "cumprido" num chamado
                 * aberto, que se lê como "nada a fazer". É a meta que a seção 5
                 * sempre previu e que faltava ligar.
                 *
                 * Só a mensagem PÚBLICA conta, e só quando já houve resposta:
                 * na abertura quem vale é a primeira resposta.
                 */
                if (
                    dados.autor === 'USUARIO' &&
                    (dados.visibilidade ?? 'PUBLICA') === 'PUBLICA' &&
                    chamado.primeiraRespostaEm !== null
                ) {
                    await esteEscopoDeMensagem.sla.abrirSeNaoHouver(
                        dados.ticketId,
                        'proxima_resposta',
                        chamado.prioridade as Prioridade,
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
                    where: {
                        appId,
                        ticketId,
                        visibilidade: 'PUBLICA',
                        rascunho: false,
                        /// Um rascunho descartado nunca foi mensagem. Ele fica
                        /// no banco para a equipe, não para o cliente.
                        descartadoEm: null,
                    },
                    orderBy: { criadoEm: 'asc' },
                })
            },

            async rascunhos(ticketId) {
                return conexao.ticketMessage.findMany({
                    where: { appId, ticketId, rascunho: true, descartadoEm: null },
                    orderBy: { criadoEm: 'asc' },
                })
            },

            async aprovarRascunho(id, dados, autor) {
                const rascunho = await conexao.ticketMessage.findFirst({
                    where: { appId, id, rascunho: true, descartadoEm: null },
                })
                if (rascunho === null) {
                    throw new ErroDeDominio(
                        'rascunho_nao_encontrado',
                        'Rascunho não encontrado, já enviado ou descartado.',
                        404
                    )
                }

                /**
                 * "Editou" é o texto ter MUDADO, não o campo ter vindo.
                 *
                 * A tela manda o conteúdo da caixa de texto sempre, e ela vem
                 * preenchida com o rascunho — então comparar presença contaria
                 * como edição todo envio, e a métrica que decide a saída do
                 * modo sombra nunca passaria de zero.
                 */
                const corpoNovo = dados.corpo?.trim()
                const editou = corpoNovo !== undefined && corpoNovo !== rascunho.corpo.trim()
                const agora = new Date()

                await conexao.ticketMessage.updateMany({
                    where: { id, appId },
                    data: {
                        rascunho: false,
                        ...(editou ? { corpo: corpoNovo } : {}),
                        aprovadoPor: autor.ator,
                        aprovadoEm: agora,
                        editadoAoEnviar: editou,
                    },
                })

                await conexao.ticketEvent.create({
                    data: {
                        appId,
                        ticketId: rascunho.ticketId,
                        ator: autor.ator,
                        evento: editou ? 'rascunho:editado' : 'rascunho:enviado',
                        depois: { mensagemId: id },
                    },
                })

                /// A primeira resposta é cumprida AGORA, e não quando a IA
                /// escreveu: foi agora que o cliente passou a ter resposta.
                await escopoDoApp(conexao, appId).sla.cumprir(
                    rascunho.ticketId,
                    'primeira_resposta',
                    agora
                )

                const enviada = await conexao.ticketMessage.findFirst({ where: { id, appId } })
                return enviada as TicketMessage
            },

            async descartarRascunho(id, autor) {
                const rascunho = await conexao.ticketMessage.findFirst({
                    where: { appId, id, rascunho: true, descartadoEm: null },
                })
                if (rascunho === null) {
                    throw new ErroDeDominio(
                        'rascunho_nao_encontrado',
                        'Rascunho não encontrado, já enviado ou descartado.',
                        404
                    )
                }

                await conexao.ticketMessage.updateMany({
                    where: { id, appId },
                    data: { descartadoEm: new Date(), descartadoPor: autor.ator },
                })

                await conexao.ticketEvent.create({
                    data: {
                        appId,
                        ticketId: rascunho.ticketId,
                        ator: autor.ator,
                        evento: 'rascunho:descartado',
                        depois: { mensagemId: id },
                    },
                })

                const descartada = await conexao.ticketMessage.findFirst({ where: { id, appId } })
                return descartada as TicketMessage
            },

            async placarDoModoSombra(ultimos) {
                /**
                 * Conta os DECIDIDOS, não os escritos: um rascunho que ainda
                 * espera não diz nada sobre a qualidade da IA, e incluí-lo
                 * empurraria a taxa para baixo só porque ninguém olhou ainda.
                 */
                const decididos = await conexao.ticketMessage.findMany({
                    where: {
                        appId,
                        OR: [{ editadoAoEnviar: { not: null } }, { descartadoEm: { not: null } }],
                    },
                    select: { editadoAoEnviar: true, descartadoEm: true },
                    orderBy: { criadoEm: 'desc' },
                    take: ultimos ?? 30,
                })

                const descartados = decididos.filter((m) => m.descartadoEm !== null).length
                const enviados = decididos.length - descartados

                return {
                    decididos: decididos.length,
                    enviados,
                    semEdicao: decididos.filter(
                        (m) => m.descartadoEm === null && m.editadoAoEnviar === false
                    ).length,
                    descartados,
                }
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

        painel: {
            async chamadosMedidos(desde) {
                /**
                 * UMA consulta, com mensagens e eventos juntos.
                 *
                 * A alternativa — um `findMany` de chamados e depois um de
                 * mensagens por chamado — é o laço N+1 clássico, e aqui ele
                 * seria sobre a tabela que mais cresce. Com `include`, o
                 * Postgres faz o trabalho uma vez.
                 */
                const chamados = await conexao.ticket.findMany({
                    where: { appId, excluidoEm: null, criadoEm: { gte: desde } },
                    select: {
                        tipo: true,
                        prioridade: true,
                        status: true,
                        criadoEm: true,
                        primeiraRespostaEm: true,
                        messages: {
                            where: { visibilidade: 'PUBLICA', rascunho: false },
                            select: { autor: true },
                        },
                        events: {
                            select: { evento: true, depois: true, criadoEm: true },
                            orderBy: { criadoEm: 'asc' },
                        },
                    },
                })

                const minutos = (de: Date, ate: Date) =>
                    Math.max(0, Math.round((ate.getTime() - de.getTime()) / 60_000))

                return chamados.map((c) => {
                    /// A resolução é o PRIMEIRO `status:resolver` da trilha: um
                    /// chamado reaberto e resolvido de novo levou, para quem
                    /// esperava, o tempo até a primeira vez.
                    const resolveu = c.events.find(
                        (e) => e.evento === 'status:resolver' || e.evento === 'status:resolver_por_inatividade'
                    )

                    const voltou =
                        resolveu !== undefined &&
                        c.events.some(
                            (e) =>
                                e.evento === 'status:mensagem_do_usuario' &&
                                e.criadoEm > resolveu.criadoEm
                        )

                    const custo = c.events
                        .filter((e) => e.evento === 'agente:atendeu' || e.evento === 'agente:teto')
                        .reduce((soma, e) => {
                            const d = e.depois as { custoEstimadoUsd?: number } | null
                            return soma + (d?.custoEstimadoUsd ?? 0)
                        }, 0)

                    return {
                        tipo: c.tipo,
                        prioridade: c.prioridade,
                        status: c.status,
                        minutosAteResposta:
                            c.primeiraRespostaEm === null
                                ? null
                                : minutos(c.criadoEm, c.primeiraRespostaEm),
                        minutosAteResolver:
                            resolveu === undefined ? null : minutos(c.criadoEm, resolveu.criadoEm),
                        respondidoPelaIa: c.messages.some((m) => m.autor === 'IA'),
                        respondidoPorHumano: c.messages.some((m) => m.autor === 'HUMANO'),
                        reaberto: voltou,
                        custoDaIa: custo,
                    }
                })
            },

            async relogiosEncerrados(desde) {
                /// Só os que terminaram. Relógio ainda correndo não é cumprido
                /// nem violado, e contá-lo como qualquer um dos dois mentiria.
                return conexao.slaTimer.findMany({
                    where: {
                        appId,
                        /// Pela data do CHAMADO, não do relógio: `SlaTimer` não
                        /// tem `criadoEm`, e a janela que interessa é a dos
                        /// chamados do período — um relógio de resolução nasce
                        /// junto do chamado, mas o da PRÓXIMA resposta nasce
                        /// quando o cliente volta a falar, dias depois.
                        ticket: { criadoEm: { gte: desde } },
                        OR: [{ cumpridoEm: { not: null } }, { violadoEm: { not: null } }],
                    },
                    select: { violadoEm: true, cumpridoEm: true },
                })
            },
        },

        csat: {
            async doChamado(ticketId) {
                return conexao.csatResponse.findFirst({ where: { ticketId, appId } })
            },

            async registrar(dados) {
                /**
                 * `upsert` pelo `ticketId`, que é único — e o `appId` entra nos
                 * DOIS lados.
                 *
                 * No `where` ele não cabe (a chave única é só `ticketId`), então
                 * a garantia de isolamento vem de quem chama: a rota só alcança
                 * o chamado pelo escopo, e um chamado de outro app não chega
                 * aqui. No `create` ele entra para a linha nascer carimbada.
                 */
                return conexao.csatResponse.upsert({
                    where: { ticketId: dados.ticketId },
                    create: {
                        appId,
                        ticketId: dados.ticketId,
                        nota: dados.nota,
                        ...(dados.comentario === undefined ? {} : { comentario: dados.comentario }),
                        atendidoPelaIa: dados.atendidoPelaIa,
                    },
                    update: {
                        nota: dados.nota,
                        comentario: dados.comentario ?? null,
                        atendidoPelaIa: dados.atendidoPelaIa,
                    },
                })
            },

            async todas() {
                return conexao.csatResponse.findMany({
                    where: { appId },
                    select: { nota: true, atendidoPelaIa: true },
                })
            },
        },

        artigos: {
            async listar(filtro) {
                return conexao.kbArticle.findMany({
                    where: {
                        ...ondeDoArtigo(),
                        ...(filtro?.status === undefined ? {} : { status: filtro.status }),
                        ...(filtro?.origem === undefined ? {} : { origem: filtro.origem }),
                    },
                    orderBy: { atualizadoEm: 'desc' },
                })
            },

            async porId(id) {
                return conexao.kbArticle.findFirst({ where: { id, ...ondeDoArtigo() } })
            },

            async porChave(chave) {
                /// `appId` igual, sem o `OR` global: derivado é sempre de um
                /// app, porque o vocabulário é de um app.
                return conexao.kbArticle.findFirst({ where: { appId, chave } })
            },

            async criar(dados) {
                return conexao.kbArticle.create({
                    data: {
                        /**
                         * Global grava `appId` NULO, e é a única escrita do
                         * sistema que faz isso de propósito. Note que ela não
                         * permite gravar no app do vizinho: ou é este app, ou é
                         * de todos — não existe "o app ali".
                         */
                        appId: dados.global ? null : appId,
                        titulo: dados.titulo,
                        corpo: dados.corpo,
                        tags: dados.tags,
                    },
                })
            },

            async alterar(id, dados) {
                const atual = await conexao.kbArticle.findFirst({ where: { id, ...ondeDoArtigo() } })
                if (atual === null) return null

                if (!podeEditarAMao(atual.origem as OrigemDoArtigo)) {
                    const fonte = atual.fonte as { caminhos?: string[] } | null
                    const onde = fonte?.caminhos?.[0] ?? 'no repositório do produto'
                    throw new ErroDeDominio(
                        'artigo_derivado',
                        `Este artigo é gerado do produto e a sincronização o reescreveria. Mude em ${onde}.`,
                        409
                    )
                }

                const { count } = await conexao.kbArticle.updateMany({
                    where: { id, ...ondeDoArtigo() },
                    data: {
                        ...(dados.titulo === undefined ? {} : { titulo: dados.titulo }),
                        ...(dados.corpo === undefined ? {} : { corpo: dados.corpo }),
                        ...(dados.tags === undefined ? {} : { tags: dados.tags }),
                        ...(dados.global === undefined ? {} : { appId: dados.global ? null : appId }),
                    },
                })

                return count === 1
                    ? conexao.kbArticle.findFirst({ where: { id, ...ondeDoArtigo() } })
                    : null
            },

            async mudarStatus(id, para, opcoes) {
                const artigo = await conexao.kbArticle.findFirst({
                    where: { id, ...ondeDoArtigo() },
                })
                if (artigo === null) {
                    throw new ErroDeDominio('artigo_nao_encontrado', 'Artigo não encontrado.', 404)
                }

                const de = artigo.status as StatusDoArtigo
                if (de === para) return artigo

                const origem = artigo.origem as OrigemDoArtigo
                if (!transicoesPermitidas(origem, de).includes(para)) {
                    throw new ErroDeDominio(
                        'transicao_invalida',
                        origem === 'DERIVADO' && para === 'ARQUIVADO'
                            ? 'Artigo gerado do produto não se arquiva à mão: tire do ar (rascunho), ou mude na fonte.'
                            : `Um artigo ${de.toLowerCase()} não vai direto para ${para.toLowerCase()}.`,
                        422
                    )
                }

                /// Uma pessoa mexendo no status de um derivado FIXA o status: a
                /// sincronização passa a respeitar a decisão dela. Sem ator (a
                /// própria sincronização), nada é fixado.
                const fixar = origem === 'DERIVADO' && opcoes?.ator !== undefined
                await conexao.kbArticle.updateMany({
                    where: { id, ...ondeDoArtigo() },
                    data: { status: para, ...(fixar ? { statusFixadoPor: opcoes.ator } : {}) },
                })

                return { ...artigo, status: para, ...(fixar ? { statusFixadoPor: opcoes.ator ?? null } : {}) }
            },

            async buscar(texto, limite, opcoes) {
                /**
                 * Busca HÍBRIDA: palavra em memória e cosseno no Postgres,
                 * fundidas por posição.
                 *
                 * A por palavra é a que existia e continua sendo o chão: ela
                 * não depende de binding nenhum e acha o que a pessoa escreveu
                 * com as palavras do artigo. A por vetor acha o sinônimo — "lista
                 * de clientes" encontrando "exportar contatos" — e só entra
                 * quando quem chamou conseguiu embutir a consulta. Sem vetor, o
                 * resultado é exatamente o de antes.
                 */
                const publicados = await conexao.kbArticle.findMany({
                    where: { ...ondeDoArtigo(), status: VISIVEL },
                })

                /// Pede o dobro de cada lado: a fusão recompõe o topo a partir
                /// das duas listas, e um artigo que é segundo numa e quarto na
                /// outra pode ser o primeiro no conjunto.
                const porPalavra = parecidos(
                    publicados.map((artigo) => ({ artigo, assunto: textoDeBusca(artigo) })),
                    texto,
                    limite * 2
                ).map(({ item, nota }) => ({ artigo: item.artigo, nota }))

                if (opcoes?.vetor === undefined) return porPalavra.slice(0, limite)

                const porId = new Map(publicados.map((a) => [a.id, a]))
                const porVetor = (await this.buscarPorVetor(opcoes.vetor, limite * 2))
                    .map(({ id }) => porId.get(id))
                    .filter((a): a is KbArticle => a !== undefined)

                return fundir(
                    [porPalavra.map((p) => p.artigo), porVetor],
                    (a) => a.id,
                    limite
                ).map(({ item, nota }) => ({ artigo: item, nota }))
            },

            async sincronizarDerivado(dados) {
                const anterior = await conexao.kbArticle.findFirst({
                    where: { appId, chave: dados.chave },
                })

                /// JSONB reordena chaves ao gravar: comparar `fonte` por
                /// `JSON.stringify` cru dizia "mudou" em toda rodada e
                /// reescrevia (e re-embutia) 36 artigos iguais. Chaves
                /// ordenadas antes de comparar.
                const mesmoConteudo =
                    anterior !== null &&
                    anterior.titulo === dados.titulo &&
                    anterior.corpo === dados.corpo &&
                    JSON.stringify(anterior.tags) === JSON.stringify(dados.tags) &&
                    jsonEstavel(anterior.fonte) === jsonEstavel(dados.fonte)

                if (anterior !== null && mesmoConteudo) {
                    /// A fonte voltou depois de arquivada pela sincronização e
                    /// ninguém fixou o status: reabre. Fixado, fica como a
                    /// pessoa deixou.
                    if (anterior.status === 'ARQUIVADO' && anterior.statusFixadoPor === null) {
                        await conexao.kbArticle.updateMany({
                            where: { id: anterior.id, appId },
                            data: {
                                status: dados.publicarDireto ? 'PUBLICADO' : 'RASCUNHO',
                                sincronizadoEm: dados.agora,
                            },
                        })
                        return { artigo: { ...anterior, status: dados.publicarDireto ? 'PUBLICADO' : 'RASCUNHO' }, efeito: 'reaberto' }
                    }
                    return { artigo: anterior, efeito: 'inalterado' }
                }

                /// `upsert` pela chave composta (appId, chave): o `appId` está
                /// DENTRO do `where` único, como no `csat`. É a forma de escrita
                /// que o lint aceita porque carrega o app.
                const artigo = await conexao.kbArticle.upsert({
                    where: { appId_chave: { appId, chave: dados.chave } },
                    create: {
                        appId,
                        origem: 'DERIVADO',
                        chave: dados.chave,
                        titulo: dados.titulo,
                        corpo: dados.corpo,
                        tags: dados.tags,
                        fonte: dados.fonte,
                        dados: dados.dados,
                        status: dados.publicarDireto ? 'PUBLICADO' : 'RASCUNHO',
                        sincronizadoEm: dados.agora,
                    },
                    update: {
                        titulo: dados.titulo,
                        corpo: dados.corpo,
                        tags: dados.tags,
                        fonte: dados.fonte,
                        dados: dados.dados,
                        sincronizadoEm: dados.agora,
                        /// Arquivado pela sincronização e a fonte voltou com
                        /// conteúdo novo: reabre, salvo se uma pessoa fixou.
                        ...(anterior?.status === 'ARQUIVADO' && anterior.statusFixadoPor === null
                            ? { status: dados.publicarDireto ? 'PUBLICADO' : 'RASCUNHO' }
                            : {}),
                    },
                })

                return {
                    artigo,
                    efeito:
                        anterior === null
                            ? 'criado'
                            : anterior.status === 'ARQUIVADO' && anterior.statusFixadoPor === null
                              ? 'reaberto'
                              : 'atualizado',
                }
            },

            async tocarDerivados(chaves, agora) {
                if (chaves.length === 0) return
                await conexao.kbArticle.updateMany({
                    where: { appId, origem: 'DERIVADO', chave: { in: chaves } },
                    data: { sincronizadoEm: agora },
                })
            },

            async arquivarDerivadosFora(prefixoDaChave, chavesVivas) {
                const fora = await conexao.kbArticle.findMany({
                    where: {
                        appId,
                        origem: 'DERIVADO',
                        chave: { startsWith: prefixoDaChave, notIn: chavesVivas },
                        status: { not: 'ARQUIVADO' },
                    },
                })
                if (fora.length === 0) return []

                await conexao.kbArticle.updateMany({
                    where: { id: { in: fora.map((a) => a.id) }, appId },
                    data: { status: 'ARQUIVADO' },
                })

                return fora.map((a) => ({ ...a, status: 'ARQUIVADO' as const }))
            },

            async criarSugerido(dados) {
                return conexao.kbArticle.create({
                    data: {
                        appId,
                        origem: 'SUGERIDO',
                        status: 'RASCUNHO',
                        titulo: dados.titulo,
                        corpo: dados.corpo,
                        tags: dados.tags,
                        fonte: dados.fonte,
                    },
                })
            },

            async gravarEmbedding(id, vetor) {
                /// O vetor vai como texto `[0.1,0.2,…]` convertido no Postgres:
                /// o Prisma não tem o tipo, e o parâmetro continua parâmetro —
                /// nada do vetor entra na string do SQL. O `app_id` está no
                /// WHERE, como em toda escrita.
                const literal = `[${vetor.join(',')}]`
                await conexao.$executeRaw`
                    UPDATE kb_articles
                    SET embedding = ${literal}::vector
                    WHERE id = ${id} AND (app_id = ${appId} OR app_id IS NULL)
                `
            },

            async buscarPorVetor(vetor, limite) {
                const literal = `[${vetor.join(',')}]`
                const linhas = await conexao.$queryRaw<{ id: string; distancia: number }[]>`
                    SELECT id, (embedding <=> ${literal}::vector) AS distancia
                    FROM kb_articles
                    WHERE (app_id = ${appId} OR app_id IS NULL)
                      AND status = 'PUBLICADO'
                      AND embedding IS NOT NULL
                    ORDER BY embedding <=> ${literal}::vector
                    LIMIT ${limite}
                `
                return linhas
            },

            async registrarConsulta(dados) {
                const linha = await conexao.kbConsulta.create({
                    data: {
                        appId,
                        texto: dados.texto,
                        origem: dados.origem,
                        ...(dados.ticketId === undefined ? {} : { ticketId: dados.ticketId }),
                        artigosDevolvidos: dados.artigosDevolvidos,
                    },
                    select: { id: true },
                })
                return linha
            },

            async marcarLeitura(consultaId, artigoId) {
                /// `updateMany` com `appId`: uma consulta de outro app não é
                /// marcada, e zero linhas alteradas é silencioso de propósito —
                /// marcar leitura nunca é motivo para falhar um atendimento.
                await conexao.kbConsulta.updateMany({
                    where: { id: consultaId, appId },
                    data: { artigoLidoId: artigoId },
                })
            },

            async consultas(desde) {
                return conexao.kbConsulta.findMany({
                    where: { appId, criadoEm: { gte: desde } },
                    select: {
                        texto: true,
                        artigosDevolvidos: true,
                        artigoLidoId: true,
                        criadoEm: true,
                    },
                    orderBy: { criadoEm: 'asc' },
                })
            },
        },

        sincronizacoes: {
            async registrarPedido(dados) {
                return conexao.kbSincronizacao.create({
                    data: {
                        appId,
                        repositorio: dados.repositorio,
                        commitSha: dados.commitSha,
                        pedidaPor: dados.pedidaPor,
                        forcada: dados.forcada,
                    },
                })
            },

            async porId(id) {
                return conexao.kbSincronizacao.findFirst({ where: { id, appId } })
            },

            async iniciar(id, agora) {
                await conexao.kbSincronizacao.updateMany({
                    where: { id, appId },
                    data: { estado: 'em_andamento', iniciadaEm: agora },
                })
            },

            async aguardarLote(id, loteId) {
                await conexao.kbSincronizacao.updateMany({
                    where: { id, appId },
                    data: { estado: 'aguardando_lote', loteId },
                })
            },

            async concluir(id, resultado, agora) {
                await conexao.kbSincronizacao.updateMany({
                    where: { id, appId },
                    data: { estado: 'concluida', resultado, terminadaEm: agora, erro: null },
                })
            },

            async falhar(id, erro, agora) {
                await conexao.kbSincronizacao.updateMany({
                    where: { id, appId },
                    data: { estado: 'falhou', erro, terminadaEm: agora },
                })
            },

            async ultima() {
                return conexao.kbSincronizacao.findFirst({
                    where: { appId },
                    orderBy: { criadaEm: 'desc' },
                })
            },

            async ultimaConcluida() {
                return conexao.kbSincronizacao.findFirst({
                    where: { appId, estado: 'concluida' },
                    orderBy: { criadaEm: 'desc' },
                })
            },

            async emAndamento() {
                return conexao.kbSincronizacao.findFirst({
                    where: { appId, estado: { in: ['pedida', 'em_andamento', 'aguardando_lote'] } },
                    orderBy: { criadaEm: 'desc' },
                })
            },

            async listar(limite) {
                return conexao.kbSincronizacao.findMany({
                    where: { appId },
                    orderBy: { criadaEm: 'desc' },
                    take: limite,
                })
            },
        },

        eventosDaBase: {
            async registrar(dados) {
                await conexao.kbEvento.create({
                    data: {
                        appId,
                        artigoId: dados.artigoId,
                        ator: dados.ator,
                        evento: dados.evento,
                        ...(dados.antes === undefined ? {} : { antes: dados.antes }),
                        ...(dados.depois === undefined ? {} : { depois: dados.depois }),
                    },
                })
            },

            async doArtigo(artigoId) {
                return conexao.kbEvento.findMany({
                    where: { appId, artigoId },
                    orderBy: { criadoEm: 'asc' },
                })
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

            async abrirSeNaoHouver(ticketId, meta, prioridade, agora) {
                /// "Correndo" é não cumprido e não violado. Um relógio desta
                /// meta já encerrado não impede o próximo ciclo de começar.
                const correndo = await conexao.slaTimer.findFirst({
                    where: { appId, ticketId, meta, cumpridoEm: null, violadoEm: null },
                })
                if (correndo !== null) return null

                const metas = await this.metasDe(prioridade)
                const metaMin = metaEmMinutos(metas, meta)

                return conexao.slaTimer.create({
                    data: {
                        appId,
                        ticketId,
                        meta,
                        metaMin,
                        venceEm: vencimentoDe(agora, metaMin),
                    },
                })
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
