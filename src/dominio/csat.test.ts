import { describe, expect, it } from 'vitest'

import { atendidoPelaIa, ehBaixa, podeAvaliar, resumirCsat } from './csat.ts'

describe('podeAvaliar', () => {
    it('só chamado encerrado', () => {
        expect(podeAvaliar('RESOLVIDO')).toBe(true)
        expect(podeAvaliar('FECHADO')).toBe(true)
        expect(podeAvaliar('ABERTO')).toBe(false)
        expect(podeAvaliar('AGUARDANDO_USUARIO')).toBe(false)
    })
})

describe('ehBaixa', () => {
    it('1 e 2 entram na revisão semanal; 3 não', () => {
        expect(ehBaixa(1)).toBe(true)
        expect(ehBaixa(2)).toBe(true)
        expect(ehBaixa(3)).toBe(false)
    })
})

describe('atendidoPelaIa', () => {
    const publica = (autor: string, rascunho = false) => ({
        autor,
        visibilidade: 'PUBLICA',
        rascunho,
    })

    it('a resposta aprovada no modo sombra CONTA como da IA', () => {
        /**
         * O texto é do modelo, e é o texto que o cliente avaliou. Quem aprovou
         * leu; quem escreveu foi a IA. Contar como humano inflaria o CSAT de
         * humano justamente no período em que a IA está sendo avaliada.
         */
        expect(atendidoPelaIa([publica('IA')])).toBe(true)
    })

    it('rascunho não conta: ninguém avaliou o que não saiu', () => {
        expect(atendidoPelaIa([publica('IA', true)])).toBe(false)
    })

    it('nota interna da IA não conta — o cliente não a leu', () => {
        expect(atendidoPelaIa([{ autor: 'IA', visibilidade: 'INTERNA', rascunho: false }])).toBe(
            false
        )
    })

    it('chamado só com humano não vira da IA', () => {
        expect(atendidoPelaIa([publica('HUMANO'), publica('USUARIO')])).toBe(false)
    })
})

describe('resumirCsat', () => {
    it('separa IA de humano, que é a comparação que decide o modo automático', () => {
        const resumo = resumirCsat([
            { nota: 5, atendidoPelaIa: true },
            { nota: 4, atendidoPelaIa: true },
            { nota: 2, atendidoPelaIa: false },
        ])

        expect(resumo.respostas).toBe(3)
        expect(resumo.daIa).toEqual({ respostas: 2, media: 4.5 })
        expect(resumo.deHumano).toEqual({ respostas: 1, media: 2 })
        expect(resumo.baixas).toBe(1)
    })

    it('sem respostas devolve média nula, não zero', () => {
        /// Zero seria uma nota péssima; nulo é "ninguém avaliou". Confundir os
        /// dois faria um app sem uso parecer um app odiado.
        const resumo = resumirCsat([])

        expect(resumo.media).toBeNull()
        expect(resumo.daIa.media).toBeNull()
    })
})
