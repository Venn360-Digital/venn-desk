import { describe, expect, it } from 'vitest'

import {
    conferirTeto,
    custoEstimado,
    paraATrilha,
    somar,
    TETO_PADRAO,
    totalDeTokens,
    ZERO,
    type Consumo,
} from './orcamento.ts'

const TARIFA = { entradaPorMilhao: 3, saidaPorMilhao: 15 }
const consumo = (p: number, e: number, s: number): Consumo => ({
    passos: p,
    tokensDeEntrada: e,
    tokensDeSaida: s,
})

describe('o teto de gasto', () => {
    it('soma sem perder nada', () => {
        expect(somar(ZERO, { passos: 1, tokensDeEntrada: 10 })).toEqual(consumo(1, 10, 0))
        expect(totalDeTokens(consumo(2, 100, 50))).toBe(150)
    })

    it('deixa passar enquanto está dentro', () => {
        expect(conferirTeto(consumo(1, 1_000, 500))).toEqual({ dentro: true })
    })

    it('corta por PASSOS — o estouro que indica laço', () => {
        /// Um agente em laço chama ferramenta sem parar e gasta poucos tokens:
        /// um teto só de tokens o deixaria rodar muito tempo.
        const emLaco = consumo(TETO_PADRAO.passos, 500, 100)

        expect(conferirTeto(emLaco)).toEqual({ dentro: false, motivo: 'passos' })
    })

    it('corta por TOKENS — o estouro de um chamado enorme', () => {
        /// E este estoura no primeiro passo, que um teto de passos não pega.
        const gigante = consumo(1, TETO_PADRAO.tokens, 0)

        expect(conferirTeto(gigante)).toEqual({ dentro: false, motivo: 'tokens' })
    })

    it('passos vem antes de tokens quando os dois estouram', () => {
        const ambos = consumo(TETO_PADRAO.passos, TETO_PADRAO.tokens, 0)

        expect(conferirTeto(ambos)).toEqual({ dentro: false, motivo: 'passos' })
    })

    it('o teto é alcançado NO limite, não depois dele', () => {
        /// `>=` e não `>`: o passo de número 12 já não acontece.
        expect(conferirTeto(consumo(TETO_PADRAO.passos - 1, 0, 0)).dentro).toBe(true)
        expect(conferirTeto(consumo(TETO_PADRAO.passos, 0, 0)).dentro).toBe(false)
    })

    it('o custo é estimado a partir da tarifa, e não de preço no código', () => {
        /**
         * Preço de modelo muda. Um número de dólares escrito no código vira
         * mentira silenciosa no dia em que a tabela mudar — pior que não ter
         * teto, porque parece que tem.
         */
        const estimado = custoEstimado(consumo(3, 1_000_000, 100_000), TARIFA)

        expect(estimado).toBeCloseTo(3 + 1.5, 5)
    })

    it('a trilha guarda tokens e o custo com quatro casas', () => {
        const trilha = paraATrilha(consumo(4, 12_345, 678), TARIFA)

        expect(trilha['passos']).toBe(4)
        expect(trilha['tokensDeEntrada']).toBe(12_345)
        expect(typeof trilha['custoEstimadoUsd']).toBe('number')
        expect(String(trilha['custoEstimadoUsd']).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4)
    })

    it('teto próprio sobrepõe o padrão', () => {
        expect(conferirTeto(consumo(3, 0, 0), { passos: 3, tokens: 999 })).toEqual({
            dentro: false,
            motivo: 'passos',
        })
    })
})

describe('o teto de tokens é uma decisão de custo, e está amarrado aqui', () => {
    it('150 mil tokens por chamado: o medido passa, o exagerado para', () => {
        /**
         * André baixou de 1 milhão para 150 mil em 21/11/2026, depois de um dia
         * de US$ 229 em rodadas de bateria. O atendimento real medido (ODB-0122)
         * usou 49 mil tokens em 6 passos, então há cerca de três vezes de folga.
         *
         * Este teste existe para que subir o teto seja uma decisão, e não um
         * número trocado de passagem: 150 mil são cerca de US$ 0,45 por chamado
         * no pior caso, e 1 milhão eram US$ 3.
         */
        expect(TETO_PADRAO.tokens).toBe(150_000)
        expect(conferirTeto({ passos: 6, tokensDeEntrada: 46_900, tokensDeSaida: 2_078 })).toEqual({ dentro: true })
        expect(conferirTeto({ passos: 12, tokensDeEntrada: 150_000, tokensDeSaida: 4_000 })).toEqual({
            dentro: false,
            motivo: 'tokens',
        })
    })
})
