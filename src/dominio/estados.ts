import { ErroDeDominio } from '../lib/erros.ts'

/**
 * A máquina de estados do chamado — seção 6 de `docs/PROJETO-VENN-DESK.md`.
 *
 * Mora aqui, pura, por dois motivos. O primeiro é que é a única regra do
 * sistema que TODO caminho de entrada atravessa — widget, Console, Slack e as
 * ferramentas do MCP — e uma regra assim não pode ter três implementações. O
 * segundo é testabilidade: sem banco e sem binding, ela roda nos testes desta
 * máquina, onde o Miniflare não roda.
 *
 * Transição inválida é erro, não correção silenciosa: um estado errado gravado
 * em silêncio reaparece depois como chamado parado, e a trilha de auditoria não
 * teria como explicar.
 */

export type Status =
    | 'NOVO'
    | 'ABERTO'
    | 'AGUARDANDO_USUARIO'
    | 'EM_ESPERA'
    | 'RESOLVIDO'
    | 'FECHADO'

/**
 * O que acontece com um chamado. Eventos, não estados: quem chama diz o que
 * ocorreu e a máquina decide o destino — é o que impede a tela, o Slack e a IA
 * de discordarem sobre o próximo status.
 */
export type Evento =
    | 'assumir'
    | 'responder_usuario'
    | 'mensagem_do_usuario'
    | 'escalar_engenharia'
    | 'engenharia_concluida'
    | 'resolver'
    | 'resolver_por_inatividade'
    | 'fechar'

const TRANSICOES: Readonly<Record<Status, Partial<Record<Evento, Status>>>> = {
    NOVO: {
        assumir: 'ABERTO',
        responder_usuario: 'AGUARDANDO_USUARIO',
        escalar_engenharia: 'EM_ESPERA',
        resolver: 'RESOLVIDO',
    },
    ABERTO: {
        responder_usuario: 'AGUARDANDO_USUARIO',
        mensagem_do_usuario: 'ABERTO',
        escalar_engenharia: 'EM_ESPERA',
        resolver: 'RESOLVIDO',
    },
    AGUARDANDO_USUARIO: {
        /// A resposta do usuário devolve o chamado à fila e religa o relógio.
        mensagem_do_usuario: 'ABERTO',
        responder_usuario: 'AGUARDANDO_USUARIO',
        escalar_engenharia: 'EM_ESPERA',
        resolver: 'RESOLVIDO',
        /// Sem retorno em 5 dias úteis, resolve com aviso (seção 6).
        resolver_por_inatividade: 'RESOLVIDO',
    },
    EM_ESPERA: {
        engenharia_concluida: 'ABERTO',
        responder_usuario: 'AGUARDANDO_USUARIO',
        mensagem_do_usuario: 'EM_ESPERA',
        resolver: 'RESOLVIDO',
    },
    RESOLVIDO: {
        /// Reabertura: o usuário responde um chamado resolvido.
        mensagem_do_usuario: 'ABERTO',
        fechar: 'FECHADO',
    },
    /// Fechado é imutável. Resposta do usuário gera chamado de acompanhamento,
    /// e quem decide isso é a rota, não a máquina.
    FECHADO: {},
}

/** O destino de um evento, ou `null` se a máquina não o permite nesse estado. */
export function proximoStatus(atual: Status, evento: Evento): Status | null {
    return TRANSICOES[atual][evento] ?? null
}

/** O mesmo, lançando — é a forma que as rotas usam. */
export function transicionar(atual: Status, evento: Evento): Status {
    const destino = proximoStatus(atual, evento)

    if (destino === null) {
        throw new ErroDeDominio(
            'transicao_invalida',
            `Não é possível ${evento.replace(/_/g, ' ')} um chamado em ${atual.toLowerCase()}.`
        )
    }

    return destino
}

/** Fechado não aceita mais nada. */
export function ehImutavel(status: Status): boolean {
    return status === 'FECHADO'
}

/**
 * O relógio de SLA pausa enquanto a bola está com o usuário (seção 6). Em espera
 * NÃO pausa: a engenharia é nossa, e o tempo dela conta.
 */
export function slaPausado(status: Status): boolean {
    return status === 'AGUARDANDO_USUARIO' || status === 'RESOLVIDO' || status === 'FECHADO'
}

/**
 * Os três grupos que o widget mostra ao usuário (seção 5). O usuário não vê
 * status cru: vê abertos, em andamento e fechados.
 */
export type GrupoNoWidget = 'abertos' | 'em_andamento' | 'fechados'

export function grupoNoWidget(status: Status): GrupoNoWidget {
    switch (status) {
        case 'NOVO':
        case 'ABERTO':
        case 'AGUARDANDO_USUARIO':
            return 'abertos'
        case 'EM_ESPERA':
            return 'em_andamento'
        case 'RESOLVIDO':
        case 'FECHADO':
            return 'fechados'
    }
}
