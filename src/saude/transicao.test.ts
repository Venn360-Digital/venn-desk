import { describe, expect, it } from 'vitest'

import { LIMITE_DE_FALHAS, transicionarSaude, type Sondagem } from './transicao.ts'

const BOA: Sondagem = { ok: true, latenciaMs: 40, detalhe: '200' }
const RUIM: Sondagem = { ok: false, latenciaMs: 8000, detalhe: 'TimeoutError' }

const AGORA = new Date('2026-11-17T12:00:00.000Z')
const ANTES = new Date('2026-11-17T09:00:00.000Z')

describe('transicionarSaude', () => {
    it('a primeira sondagem estabelece o estado e não anuncia mudança', () => {
        const dePe = transicionarSaude(null, BOA, AGORA)
        expect(dePe.saudavel).toBe(true)
        expect(dePe.mudanca).toBe(null)

        /// App nunca visto de pé não "cai" na estreia: anunciar queda de algo
        /// que nunca respondeu é ruído de cadastro, não incidente.
        const fora = transicionarSaude(null, RUIM, AGORA)
        expect(fora.falhasSeguidas).toBe(1)
        expect(fora.mudanca).toBe(null)
    })

    it('uma falha isolada NÃO declara queda', () => {
        const t = transicionarSaude({ saudavel: true, falhasSeguidas: 0, desdeEm: ANTES }, RUIM, AGORA)

        expect(t.mudanca).toBe(null)
        expect(t.saudavel).toBe(true)
        expect(t.falhasSeguidas).toBe(1)
        expect(t.desdeEm).toEqual(ANTES)
    })

    it('a segunda falha seguida declara a queda', () => {
        const t = transicionarSaude(
            { saudavel: true, falhasSeguidas: LIMITE_DE_FALHAS - 1, desdeEm: ANTES },
            RUIM,
            AGORA
        )

        expect(t.mudanca).toBe('caiu')
        expect(t.saudavel).toBe(false)
        expect(t.desdeEm).toEqual(AGORA)
    })

    it('a queda é declarada UMA vez, não a cada minuto', () => {
        const t = transicionarSaude({ saudavel: false, falhasSeguidas: 37, desdeEm: ANTES }, RUIM, AGORA)

        expect(t.mudanca).toBe(null)
        expect(t.falhasSeguidas).toBe(38)
        expect(t.desdeEm).toEqual(ANTES)
    })

    it('a primeira resposta boa encerra a queda', () => {
        const t = transicionarSaude({ saudavel: false, falhasSeguidas: 12, desdeEm: ANTES }, BOA, AGORA)

        expect(t.mudanca).toBe('voltou')
        expect(t.saudavel).toBe(true)
        expect(t.falhasSeguidas).toBe(0)
        expect(t.desdeEm).toEqual(AGORA)
    })

    it('o soluço resolvido zera o contador sem anunciar nada', () => {
        const t = transicionarSaude({ saudavel: true, falhasSeguidas: 1, desdeEm: ANTES }, BOA, AGORA)

        expect(t.mudanca).toBe(null)
        expect(t.falhasSeguidas).toBe(0)
        expect(t.desdeEm).toEqual(ANTES)
    })

    it('regime normal não mexe em nada', () => {
        const t = transicionarSaude({ saudavel: true, falhasSeguidas: 0, desdeEm: ANTES }, BOA, AGORA)

        expect(t).toEqual({ saudavel: true, falhasSeguidas: 0, desdeEm: ANTES, mudanca: null })
    })

    it('uma queda longa seguida de volta devolve o intervalo inteiro', () => {
        /// A sequência que a página de status precisa acertar: o `desdeEm` da
        /// queda é o que vira `iniciadoEm` do episódio, e ele não pode ter sido
        /// reescrito pelos 40 minutos de falha que vieram depois.
        let estado = { saudavel: true, falhasSeguidas: 0, desdeEm: ANTES }
        const caiuEm = new Date('2026-11-17T10:00:00.000Z')

        estado = transicionarSaude(estado, RUIM, new Date('2026-11-17T09:59:00.000Z'))
        const queda = transicionarSaude(estado, RUIM, caiuEm)
        expect(queda.mudanca).toBe('caiu')

        estado = queda
        for (let minuto = 1; minuto <= 40; minuto += 1) {
            estado = transicionarSaude(estado, RUIM, new Date(caiuEm.getTime() + minuto * 60_000))
        }
        expect(estado.desdeEm).toEqual(caiuEm)
        expect(estado.falhasSeguidas).toBe(42)

        const volta = transicionarSaude(estado, BOA, AGORA)
        expect(volta.mudanca).toBe('voltou')
    })
})
