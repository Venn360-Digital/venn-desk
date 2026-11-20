import { describe, expect, it } from 'vitest'

import {
    distribuir,
    MINIMO_PARA_PERCENTIL,
    MINIMO_PARA_TAXA,
    montarRelatorio,
    taxa,
    type ChamadoMedido,
} from './relatorio.ts'

const chamado = (dados: Partial<ChamadoMedido> = {}): ChamadoMedido => ({
    tipo: 'DUVIDA',
    prioridade: 'NORMAL',
    status: 'RESOLVIDO',
    minutosAteResposta: 10,
    minutosAteResolver: 60,
    respondidoPelaIa: false,
    respondidoPorHumano: true,
    reaberto: false,
    custoDaIa: 0,
    ...dados,
})

describe('distribuir', () => {
    it('cala a boca com amostra pequena, e diz quantos casos tinha', () => {
        /**
         * O defeito que este teste existe para impedir: "p90 4h12" medido sobre
         * cinco chamados. O número tem casa decimal, convence, e leva alguém a
         * calibrar SLA com ruído. Nulo com a contagem ao lado é honesto.
         */
        const poucos = distribuir([1, 2, 3, 4, 5])

        expect(poucos.casos).toBe(5)
        expect(poucos.mediana).toBeNull()
        expect(poucos.p90).toBeNull()
    })

    it('a partir do mínimo, mede', () => {
        const minutos = Array.from({ length: MINIMO_PARA_PERCENTIL }, (_, i) => i + 1)
        const d = distribuir(minutos)

        expect(d.mediana).toBe(5)
        expect(d.p90).toBe(9)
    })

    it('o percentil é um valor OBSERVADO, nunca interpolado', () => {
        /// Interpolar inventaria um tempo que nenhum chamado teve — e aqui o
        /// número é lido como "um chamado demorou isso".
        const minutos = [1, 1, 1, 1, 1, 1, 1, 1, 1, 999]
        expect(distribuir(minutos).p90).toBe(1)
        expect([1, 999]).toContain(distribuir(minutos).p90)
    })

    it('não altera a lista que recebeu', () => {
        const original = [5, 3, 9, 1, 7, 2, 8, 4, 6, 10]
        const copia = [...original]
        distribuir(original)
        expect(original).toEqual(copia)
    })
})

describe('taxa', () => {
    it('recusa porcentagem de amostra pequena', () => {
        /// "100% de resolução pela IA" com dois casos é verdadeiro e inútil —
        /// e some no mês seguinte sem ninguém entender por quê.
        expect(taxa(2, 2)).toBeNull()
        expect(taxa(1, MINIMO_PARA_TAXA - 1)).toBeNull()
    })

    it('sem denominador devolve nulo, nunca zero', () => {
        /// Zero por cento e "não houve oportunidade" são coisas diferentes.
        expect(taxa(0, 0)).toBeNull()
    })

    it('mede quando pode', () => {
        expect(taxa(3, 10)).toBe(30)
    })
})

describe('montarRelatorio', () => {
    it('só conta como resolvido pela IA quando NENHUM humano respondeu', () => {
        /**
         * Chamado em que a IA escreveu e uma pessoa precisou escrever depois
         * foi resolvido pela PESSOA, com rascunho. Contá-lo como vitória da IA
         * é o jeito mais fácil de o indicador subir sem o atendimento melhorar.
         */
        const chamados = [
            ...Array.from({ length: 4 }, () =>
                chamado({ respondidoPelaIa: true, respondidoPorHumano: false })
            ),
            ...Array.from({ length: 4 }, () =>
                chamado({ respondidoPelaIa: true, respondidoPorHumano: true })
            ),
        ]

        const r = montarRelatorio(chamados, [])

        expect(r.resolucaoPelaIa.casos).toBe(4)
        expect(r.resolucaoPelaIa.deQuantos).toBe(8)
        expect(r.resolucaoPelaIa.percentual).toBe(50)
    })

    it('chamado aberto não entra no denominador de resolução nem de reabertura', () => {
        const r = montarRelatorio(
            [chamado({ status: 'ABERTO' }), chamado({ status: 'ABERTO' })],
            []
        )

        expect(r.chamados).toBe(2)
        expect(r.resolucaoPelaIa.deQuantos).toBe(0)
        expect(r.resolucaoPelaIa.percentual).toBeNull()
    })

    it('o custo por chamado divide pelos que a IA ATENDEU, não por todos', () => {
        /**
         * Com o atendimento em manual a maioria tem custo zero. Dividir por
         * todos faria o custo por chamado despencar conforme o produto cresce
         * sem a IA ser usada — e o número que interessa é quanto custa um
         * atendimento dela.
         */
        const r = montarRelatorio(
            [
                chamado({ custoDaIa: 0.2 }),
                chamado({ custoDaIa: 0.1 }),
                ...Array.from({ length: 50 }, () => chamado({ custoDaIa: 0 })),
            ],
            []
        )

        expect(r.custo.total).toBeCloseTo(0.3, 4)
        expect(r.custo.porChamado).toBeCloseTo(0.15, 4)
    })

    it('sem atendimento da IA, o custo por chamado é nulo e não zero', () => {
        const r = montarRelatorio([chamado(), chamado()], [])
        expect(r.custo.total).toBe(0)
        expect(r.custo.porChamado).toBeNull()
    })

    it('o SLA conta relógio encerrado, e ignora o que ainda corre', () => {
        const agora = new Date()
        const r = montarRelatorio(
            [],
            [
                ...Array.from({ length: 6 }, () => ({ violadoEm: null, cumpridoEm: agora })),
                { violadoEm: agora, cumpridoEm: null },
                /// Ainda correndo: não é cumprido nem violado.
                { violadoEm: null, cumpridoEm: null },
            ]
        )

        expect(r.sla.cumpridos).toBe(6)
        expect(r.sla.violados).toBe(1)
        expect(r.sla.percentual).toBeCloseTo(85.7, 1)
    })

    it('agrupa por tipo, prioridade e status', () => {
        const r = montarRelatorio(
            [
                chamado({ tipo: 'DUVIDA', prioridade: 'ALTA', status: 'ABERTO' }),
                chamado({ tipo: 'DUVIDA', prioridade: 'NORMAL', status: 'RESOLVIDO' }),
                chamado({ tipo: 'INCIDENTE', prioridade: 'ALTA', status: 'RESOLVIDO' }),
            ],
            []
        )

        expect(r.porTipo).toEqual({ DUVIDA: 2, INCIDENTE: 1 })
        expect(r.porPrioridade).toEqual({ ALTA: 2, NORMAL: 1 })
        expect(r.porStatus).toEqual({ ABERTO: 1, RESOLVIDO: 2 })
    })
})
