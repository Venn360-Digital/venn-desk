import { slaPausado, type Status } from './estados.ts'

/**
 * Os relógios de SLA (seções 4 e 5) e o cão de guarda.
 *
 * Módulo puro: entram um relógio e um instante, sai um veredito. Nenhuma
 * consulta, nenhum `Date.now()` escondido — o agora é sempre parâmetro. É o que
 * permite provar a parte difícil, que não é "venceu ou não venceu": é a
 * **aritmética da pausa**.
 *
 * **Por que a pausa é o lugar do defeito.** O relógio para enquanto a bola está
 * com o usuário (`slaPausado`, em `estados.ts`). Parar é fácil; o que erra é
 * voltar. Se o vencimento for absoluto e ninguém o empurrar na retomada, um
 * chamado que ficou três dias aguardando o usuário volta já violado, por culpa
 * do usuário. Se for empurrado duas vezes — na pausa e na retomada —, o prazo
 * dobra em silêncio. Aqui o vencimento só anda na RETOMADA, e anda exatamente
 * o tempo que ficou parado.
 *
 * **Sem calendário comercial.** A seção 5 coloca horário comercial e feriados
 * na Fase 7, e `sla_policies.calendario` já existe para isso. Até lá o tempo é
 * corrido, 24 por 7 — o que é o certo para incidente e o errado para dúvida
 * aberta às 18h de sexta. A troca é local: `vencimentoDe` passa a consultar o
 * calendário, e nada mais aqui muda.
 */

export type Meta = 'primeira_resposta' | 'proxima_resposta' | 'resolucao'
export type Prioridade = 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE'

export interface MetasEmMinutos {
    primeiraRespostaMin: number
    proximaRespostaMin: number
    resolucaoMin: number
}

/**
 * O padrão, quando o app ainda não tem política cadastrada.
 *
 * Existe para o relógio nascer junto com o primeiro chamado de um app novo —
 * a Fase 8 quer "menos de um dia" para incluir um produto, e exigir cadastrar
 * política antes de atender seria mais um passo. Cadastrada a política, ela
 * manda.
 */
export const METAS_PADRAO: Record<Prioridade, MetasEmMinutos> = {
    URGENTE: { primeiraRespostaMin: 15, proximaRespostaMin: 30, resolucaoMin: 4 * 60 },
    ALTA: { primeiraRespostaMin: 30, proximaRespostaMin: 60, resolucaoMin: 8 * 60 },
    NORMAL: { primeiraRespostaMin: 60, proximaRespostaMin: 4 * 60, resolucaoMin: 24 * 60 },
    BAIXA: { primeiraRespostaMin: 4 * 60, proximaRespostaMin: 8 * 60, resolucaoMin: 72 * 60 },
}

export function metaEmMinutos(metas: MetasEmMinutos, meta: Meta): number {
    switch (meta) {
        case 'primeira_resposta':
            return metas.primeiraRespostaMin
        case 'proxima_resposta':
            return metas.proximaRespostaMin
        case 'resolucao':
            return metas.resolucaoMin
    }
}

export function vencimentoDe(inicio: Date, minutos: number): Date {
    return new Date(inicio.getTime() + minutos * 60_000)
}

/** O que o banco guarda de um relógio. Só o que o cálculo precisa. */
export interface Relogio {
    meta: Meta
    /** A meta original, em minutos. É o que torna "em risco" calculável. */
    metaMin: number
    venceEm: Date
    pausadoEm: Date | null
    violadoEm: Date | null
    cumpridoEm: Date | null
}

/**
 * Quanto falta, em milissegundos.
 *
 * Parado, o que falta é o que faltava quando parou — e não o que falta para um
 * vencimento que continua no futuro enquanto o mundo anda.
 */
export function restanteMs(relogio: Relogio, agora: Date): number {
    const referencia = relogio.pausadoEm ?? agora
    return relogio.venceEm.getTime() - referencia.getTime()
}

/**
 * A fatia final do prazo em que o relógio conta como "em risco".
 *
 * Proporcional à meta, e não um número fixo de minutos: 10 minutos antes do fim
 * é aviso útil numa meta de 15 minutos e ruído numa de 72 horas.
 */
export const FRACAO_DE_RISCO = 0.2

export type EstadoDoRelogio = 'cumprido' | 'violado' | 'pausado' | 'vencido' | 'em_risco' | 'em_dia'

export function estadoDoRelogio(relogio: Relogio, agora: Date): EstadoDoRelogio {
    /// Cumprido e violado são finais e vêm primeiro: um relógio já violado que
    /// depois pausa não volta a ser "pausado".
    if (relogio.cumpridoEm !== null) return 'cumprido'
    if (relogio.violadoEm !== null) return 'violado'
    if (relogio.pausadoEm !== null) return 'pausado'

    const restante = restanteMs(relogio, agora)
    if (restante <= 0) return 'vencido'
    if (restante <= relogio.metaMin * 60_000 * FRACAO_DE_RISCO) return 'em_risco'

    return 'em_dia'
}

/**
 * O que acontece com um relógio quando o chamado muda de status.
 *
 * Devolve a MUDANÇA, não o relógio novo: quem grava é a camada de dados, e
 * assim esta função não precisa saber se a escrita é `update` ou `updateMany`.
 * `null` significa "nada a fazer", que é o caso mais comum.
 */
export type MudancaDoRelogio =
    | { acao: 'pausar'; pausadoEm: Date }
    | { acao: 'retomar'; venceEm: Date }
    | null

export function aoMudarStatus(
    relogio: Relogio,
    status: Status,
    agora: Date
): MudancaDoRelogio {
    if (relogio.cumpridoEm !== null || relogio.violadoEm !== null) return null

    const deveriaPausar = slaPausado(status)
    const estaPausado = relogio.pausadoEm !== null

    if (deveriaPausar === estaPausado) return null

    if (deveriaPausar) return { acao: 'pausar', pausadoEm: agora }

    /**
     * A retomada empurra o vencimento pelo tempo exato em que ficou parado.
     *
     * Esta soma é a única no módulo, e é a que não pode errar: ela acontece uma
     * vez por retomada, nunca na pausa. Somar nos dois lugares dobraria o prazo
     * sem nenhum sintoma visível até alguém comparar os números à mão.
     */
    const parado = agora.getTime() - (relogio.pausadoEm as Date).getTime()
    return { acao: 'retomar', venceEm: new Date(relogio.venceEm.getTime() + parado) }
}

/**
 * O cão de guarda (seção 4): o prazo de primeira resposta estourou e ninguém
 * — IA ou humano — agiu.
 *
 * É mais estreito que "SLA violado" de propósito. Violar a resolução significa
 * que o problema é difícil; violar a PRIMEIRA RESPOSTA significa que ninguém
 * olhou, e é o único caso que a seção 4 manda repetir na thread e marcar o
 * responsável humano. A documentação do Claude no Slack prevê exatamente o
 * silêncio que isto cobre: resposta automática desligada no canal, ou leitura
 * suspensa por volume.
 */
export function pedeCaoDeGuarda(relogio: Relogio, agora: Date): boolean {
    return relogio.meta === 'primeira_resposta' && estadoDoRelogio(relogio, agora) === 'vencido'
}

/**
 * O que a fila mostra numa linha: o relógio mais urgente do chamado.
 *
 * Um chamado tem dois ou três relógios, e a fila tem uma coluna. Mostrar todos
 * não cabe; mostrar o primeiro da lista esconderia justamente o que estourou.
 * Então ganha o mais urgente — e "urgente" aqui é uma ordem explícita de
 * estados, não a data mais próxima: um relógio violado há uma semana importa
 * mais que um em dia que vence em cinco minutos.
 */
const URGENCIA: Record<EstadoDoRelogio, number> = {
    violado: 0,
    vencido: 1,
    em_risco: 2,
    em_dia: 3,
    pausado: 4,
    cumprido: 5,
}

export interface ResumoDeSla {
    estado: EstadoDoRelogio
    meta: Meta
    venceEm: Date
}

export function resumoDoChamado(relogios: Relogio[], agora: Date): ResumoDeSla | null {
    let melhor: ResumoDeSla | null = null
    let melhorUrgencia = Number.POSITIVE_INFINITY

    for (const relogio of relogios) {
        const estado = estadoDoRelogio(relogio, agora)
        const urgencia = URGENCIA[estado]

        /// Empate de estado: vence o que vence antes.
        const ganha =
            urgencia < melhorUrgencia ||
            (urgencia === melhorUrgencia &&
                melhor !== null &&
                relogio.venceEm.getTime() < melhor.venceEm.getTime())

        if (ganha) {
            melhorUrgencia = urgencia
            melhor = { estado, meta: relogio.meta, venceEm: relogio.venceEm }
        }
    }

    return melhor
}
