/**
 * O calendário comercial do SLA (Fase 7).
 *
 * **O problema que ele resolve.** Um prazo de resolução de 8 horas, num chamado
 * aberto às 17h de uma sexta, vence à 1h da manhã de sábado — e aparece como
 * violado na segunda, sem que ninguém tenha deixado de trabalhar. Contar em
 * horas corridas só é honesto para quem atende 24 horas por dia, e a seção 12
 * reserva isso para o urgente.
 *
 * **O que ele NÃO muda.** A prioridade urgente continua correndo 24x7 — quem
 * decide isso é a política do app, não este módulo. Aqui só existe a aritmética:
 * dado um instante e uma quantidade de minutos úteis, qual instante é o
 * vencimento.
 *
 * **Fuso sem biblioteca.** `Intl.DateTimeFormat` com `timeZone` existe no
 * Workers e no Node, e é a única fonte de verdade sobre horário de verão que não
 * exige empacotar um banco de fusos. O preço é converter instante em
 * componentes locais a cada passo, e é por isso que o laço anda de DIA em dia,
 * não de minuto em minuto.
 */

export interface Janela {
    /** `09:00`, hora local do fuso do calendário. */
    de: string
    ate: string
}

export interface Calendario {
    /** `America/Sao_Paulo`. */
    fuso: string
    /**
     * As janelas de atendimento por dia da semana, 0 = domingo.
     *
     * Dia ausente é dia sem atendimento, e é por isso que o padrão não tem 0 nem
     * 6: sábado e domingo não param o relógio por acidente de configuração, e
     * sim por decisão escrita.
     */
    dias: Partial<Record<number, Janela[]>>
    /** `2026-12-25`, no fuso do calendário. */
    feriados?: string[]
}

export const CALENDARIO_COMERCIAL: Calendario = {
    fuso: 'America/Sao_Paulo',
    dias: {
        1: [{ de: '09:00', ate: '18:00' }],
        2: [{ de: '09:00', ate: '18:00' }],
        3: [{ de: '09:00', ate: '18:00' }],
        4: [{ de: '09:00', ate: '18:00' }],
        5: [{ de: '09:00', ate: '18:00' }],
    },
}

/** Os componentes locais de um instante, no fuso pedido. */
function local(instante: Date, fuso: string): { data: string; diaDaSemana: number; minutosDoDia: number } {
    const formatador = new Intl.DateTimeFormat('en-CA', {
        timeZone: fuso,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
    })

    const partes = new Map(formatador.formatToParts(instante).map((p) => [p.type, p.value]))
    const data = `${partes.get('year') ?? ''}-${partes.get('month') ?? ''}-${partes.get('day') ?? ''}`
    /// `hour` pode vir "24" à meia-noite em `hour12: false` — é o comportamento
    /// documentado do Intl, e tratá-lo como 24 somaria um dia ao cálculo.
    const hora = Number(partes.get('hour') ?? '0') % 24
    const minuto = Number(partes.get('minute') ?? '0')

    const SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

    return {
        data,
        diaDaSemana: SEMANA[partes.get('weekday') ?? 'Mon'] ?? 1,
        minutosDoDia: hora * 60 + minuto,
    }
}

function emMinutos(hhmm: string): number {
    const [h, m] = hhmm.split(':')
    return Number(h ?? '0') * 60 + Number(m ?? '0')
}

/**
 * O instante que corresponde a uma data local e um minuto do dia.
 *
 * Feito por aproximação e correção, e não por aritmética de fuso: calcula um
 * palpite em UTC, lê de volta o que aquele instante é no fuso, e corrige a
 * diferença. Duas iterações bastam porque a correção só erra na fronteira do
 * horário de verão, onde a segunda passada já cai do lado certo.
 */
function instanteDe(data: string, minutosDoDia: number, fuso: string): Date {
    let palpite = new Date(`${data}T00:00:00Z`).getTime() + minutosDoDia * 60_000

    for (let i = 0; i < 2; i++) {
        const lido = local(new Date(palpite), fuso)
        const diferenca = (lido.data === data ? lido.minutosDoDia : lido.data < data ? -1440 + lido.minutosDoDia : 1440 + lido.minutosDoDia) - minutosDoDia
        if (diferenca === 0) break
        palpite -= diferenca * 60_000
    }

    return new Date(palpite)
}

function janelasDoDia(cal: Calendario, data: string, diaDaSemana: number): Janela[] {
    if ((cal.feriados ?? []).includes(data)) return []
    return cal.dias[diaDaSemana] ?? []
}

/** O dia seguinte, em data local (`2026-11-21` → `2026-11-22`). */
function proximaData(data: string): string {
    const d = new Date(`${data}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
}

/** Quantos dias o laço anda antes de desistir. Dois anos de feriados seguidos. */
const TETO_DE_DIAS = 800

/**
 * O vencimento de um prazo contado em minutos ÚTEIS.
 *
 * Começa a contar na próxima janela aberta: um chamado que chega às 22h não
 * consome prazo durante a noite. E termina dentro de uma janela, nunca no
 * intervalo entre duas.
 */
export function vencimentoComercial(inicio: Date, minutosUteis: number, cal: Calendario): Date {
    if (minutosUteis <= 0) return inicio

    let restante = minutosUteis
    let { data, diaDaSemana, minutosDoDia } = local(inicio, cal.fuso)

    for (let dia = 0; dia < TETO_DE_DIAS; dia++) {
        for (const janela of janelasDoDia(cal, data, diaDaSemana)) {
            const abre = emMinutos(janela.de)
            const fecha = emMinutos(janela.ate)
            if (fecha <= abre) continue

            /// Antes de abrir, o prazo começa na abertura; dentro, começa agora.
            const comeca = Math.max(minutosDoDia, abre)
            if (comeca >= fecha) continue

            const disponivel = fecha - comeca
            if (restante <= disponivel) return instanteDe(data, comeca + restante, cal.fuso)
            restante -= disponivel
        }

        data = proximaData(data)
        diaDaSemana = (diaDaSemana + 1) % 7
        minutosDoDia = 0
    }

    /**
     * Calendário sem nenhuma janela: devolve o prazo corrido.
     *
     * Acontece com configuração errada (todos os dias vazios), e devolver uma
     * data no ano 2028 esconderia o erro. Prazo corrido é visivelmente curto e
     * aparece como violação no mesmo dia, que é o sintoma que faz alguém olhar.
     */
    return new Date(inicio.getTime() + minutosUteis * 60_000)
}

/** Está dentro do horário de atendimento? Decide se o alerta acorda alguém. */
export function dentroDoHorario(instante: Date, cal: Calendario): boolean {
    const { data, diaDaSemana, minutosDoDia } = local(instante, cal.fuso)
    return janelasDoDia(cal, data, diaDaSemana).some(
        (j) => minutosDoDia >= emMinutos(j.de) && minutosDoDia < emMinutos(j.ate)
    )
}

/** Lê o calendário guardado em `sla_policies.calendario`, ou `null`. */
export function calendarioDaPolitica(valor: unknown): Calendario | null {
    if (typeof valor !== 'object' || valor === null) return null
    const c = valor as { fuso?: unknown; dias?: unknown }
    if (typeof c.fuso !== 'string' || typeof c.dias !== 'object' || c.dias === null) return null
    return valor as Calendario
}
