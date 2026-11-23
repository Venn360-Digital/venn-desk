import { describe, expect, it } from 'vitest'

import { medirEngenharia, type MarcoDeEngenharia } from './engenharia-metricas.ts'

const H = 60 * 60 * 1000
const base = new Date('2026-11-01T09:00:00Z')
const horas = (n: number) => new Date(base.getTime() + n * H)

function marco(ajustes: Partial<MarcoDeEngenharia> = {}): MarcoDeEngenharia {
    return {
        abertoEm: base,
        etapas: { ISSUE_CRIADA: horas(2), EM_STAGING: horas(10), EM_PRODUCAO: horas(26) },
        revertido: false,
        prAprovadoSemAlteracao: true,
        ...ajustes,
    }
}

describe('medirEngenharia', () => {
    it('mede os três trechos do caminho', () => {
        /**
         * Os trechos separados dizem onde está o gargalo: decidir, corrigir ou
         * publicar são três problemas diferentes, com soluções diferentes. Um
         * número só ("tempo até produção") não distingue.
         */
        const m = medirEngenharia([marco()])
        expect(m.chamadoAteIssueH).toBe(2)
        expect(m.issueAteStagingH).toBe(8)
        expect(m.stagingAteProducaoH).toBe(16)
    })

    it('usa MEDIANA, não média', () => {
        /// Um defeito que ficou três semanas esperando decisão de produto
        /// deslocaria a média e sumiria com a informação.
        const normais = [marco(), marco()]
        const monstro = marco({ etapas: { ISSUE_CRIADA: horas(500), EM_STAGING: horas(510) } })

        expect(medirEngenharia([...normais, monstro]).chamadoAteIssueH).toBe(2)
    })

    it('trecho não percorrido não entra na conta', () => {
        const soIssue = marco({ etapas: { ISSUE_CRIADA: horas(3) } })
        const m = medirEngenharia([soIssue])

        expect(m.chamadoAteIssueH).toBe(3)
        expect(m.issueAteStagingH).toBe(null)
        expect(m.stagingAteProducaoH).toBe(null)
    })

    it('evento fora de ordem é descartado, não zerado', () => {
        /**
         * O GitHub entrega fora de ordem. Zerar contaria como "instantâneo" e
         * puxaria a mediana para baixo; descartar tira só aquele caso da conta.
         */
        const invertido = marco({ etapas: { ISSUE_CRIADA: horas(10), EM_STAGING: horas(4) } })
        expect(medirEngenharia([invertido]).issueAteStagingH).toBe(null)
    })

    it('a reversão é medida sobre o que CHEGOU à produção', () => {
        /// Dividir pelo total de defeitos diluiria o indicador com os que nem
        /// foram publicados.
        const naProducao = marco({ revertido: true })
        const paradoNoStaging = marco({ etapas: { ISSUE_CRIADA: horas(1), EM_STAGING: horas(5) } })

        const m = medirEngenharia([naProducao, paradoNoStaging])
        expect(m.reversao).toEqual({ casos: 1, deQuantos: 1, percentual: 100 })
    })

    it('PR sem alteração conta só onde houve PR', () => {
        const comPr = [marco({ prAprovadoSemAlteracao: true }), marco({ prAprovadoSemAlteracao: false })]
        const semPr = marco({ prAprovadoSemAlteracao: null })

        const m = medirEngenharia([...comPr, semPr])
        expect(m.prSemAlteracao).toEqual({ casos: 1, deQuantos: 2, percentual: 50 })
        expect(m.defeitos).toBe(3)
    })

    it('sem defeito nenhum, tudo nulo e nada de dividir por zero', () => {
        const m = medirEngenharia([])
        expect(m).toMatchObject({
            defeitos: 0,
            chamadoAteIssueH: null,
            reversao: { casos: 0, deQuantos: 0, percentual: null },
            prSemAlteracao: { casos: 0, deQuantos: 0, percentual: null },
        })
    })
})
