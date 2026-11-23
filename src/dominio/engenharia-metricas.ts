import type { Etapa } from './engenharia.ts'

export interface MarcoDeEngenharia {
    /** O chamado que originou, para contar do começo. */
    abertoEm: Date
    /** Quando cada etapa foi alcançada. Etapa não alcançada não aparece. */
    etapas: Partial<Record<Etapa, Date>>
    /** Houve reversão depois de chegar à produção? */
    revertido: boolean
    /** PR aprovado sem nenhuma alteração pedida. Nulo quando não houve PR. */
    prAprovadoSemAlteracao: boolean | null
}

export interface MetricasDeEngenharia {
    defeitos: number
    /** Medianas em horas. Nulo quando ninguém completou o trecho. */
    chamadoAteIssueH: number | null
    issueAteStagingH: number | null
    stagingAteProducaoH: number | null
    reversao: { casos: number; deQuantos: number; percentual: number | null }
    prSemAlteracao: { casos: number; deQuantos: number; percentual: number | null }
}

const HORA_MS = 60 * 60 * 1000

/**
 * A mediana, e não a média.
 *
 * Um defeito que ficou três semanas esperando decisão de produto desloca a
 * média e some com a informação: a mediana diz quanto tempo o caso TÍPICO leva,
 * que é o número que se compara de um mês para o outro.
 */
function medianaEmHoras(valores: number[]): number | null {
    if (valores.length === 0) return null
    const ordenado = [...valores].sort((a, b) => a - b)
    const meio = Math.floor(ordenado.length / 2)
    const ms =
        ordenado.length % 2 === 1
            ? (ordenado[meio] as number)
            : ((ordenado[meio - 1] as number) + (ordenado[meio] as number)) / 2
    return Number((ms / HORA_MS).toFixed(1))
}

function entre(marco: MarcoDeEngenharia, de: Etapa | 'abertura', ate: Etapa): number | null {
    const inicio = de === 'abertura' ? marco.abertoEm : marco.etapas[de]
    const fim = marco.etapas[ate]
    if (inicio === undefined || fim === undefined) return null
    /**
     * Trecho negativo é descartado, não zerado.
     *
     * Acontece quando um evento chega fora de ordem e a etapa foi alcançada
     * antes do marco anterior ser registrado. Zerar contaria como "instantâneo"
     * e puxaria a mediana para baixo; descartar apenas tira aquele caso da
     * conta, que é o honesto.
     */
    const ms = fim.getTime() - inicio.getTime()
    return ms < 0 ? null : ms
}

/**
 * Os indicadores de engenharia da seção 12.
 *
 * Mede o CAMINHO, não o esforço: quanto tempo um defeito confirmado leva de
 * chamado a issue, de issue a staging e de staging a produção. É o que diz se o
 * gargalo está em decidir, em corrigir ou em publicar — três problemas
 * diferentes, com soluções diferentes.
 */
export function medirEngenharia(marcos: MarcoDeEngenharia[]): MetricasDeEngenharia {
    const trecho = (de: Etapa | 'abertura', ate: Etapa) =>
        medianaEmHoras(marcos.map((m) => entre(m, de, ate)).filter((v): v is number => v !== null))

    const chegaramAProducao = marcos.filter((m) => m.etapas.EM_PRODUCAO !== undefined)
    const comPr = marcos.filter((m) => m.prAprovadoSemAlteracao !== null)
    const semAlteracao = comPr.filter((m) => m.prAprovadoSemAlteracao === true)
    const revertidos = chegaramAProducao.filter((m) => m.revertido)

    const percentual = (parte: number, total: number) =>
        total === 0 ? null : Number(((parte / total) * 100).toFixed(1))

    return {
        defeitos: marcos.length,
        chamadoAteIssueH: trecho('abertura', 'ISSUE_CRIADA'),
        issueAteStagingH: trecho('ISSUE_CRIADA', 'EM_STAGING'),
        stagingAteProducaoH: trecho('EM_STAGING', 'EM_PRODUCAO'),
        /// A taxa de reversão só faz sentido sobre o que chegou à produção:
        /// dividir pelo total de defeitos diluiria o indicador com os que nem
        /// foram publicados.
        reversao: {
            casos: revertidos.length,
            deQuantos: chegaramAProducao.length,
            percentual: percentual(revertidos.length, chegaramAProducao.length),
        },
        prSemAlteracao: {
            casos: semAlteracao.length,
            deQuantos: comPr.length,
            percentual: percentual(semAlteracao.length, comPr.length),
        },
    }
}
