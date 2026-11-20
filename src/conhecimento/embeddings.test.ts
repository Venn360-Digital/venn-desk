import { describe, expect, it } from 'vitest'

import { DIMENSOES, embutidorDoWorkersAi, embutirVarios } from './embeddings.ts'

const vetor = (n = DIMENSOES) => Array.from({ length: n }, () => 0.1)

describe('embutirVarios', () => {
    it('devolve um vetor por texto, na ordem', async () => {
        const ai = { run: async (_m: string, e: { text: string[] }) => ({ data: e.text.map(() => vetor()) }) }
        const r = await embutirVarios(ai, ['a', 'b'])
        expect(r).toHaveLength(2)
        expect(r[0]).toHaveLength(DIMENSOES)
    })

    it('vetor de dimensão errada vira null, não vai para o banco', async () => {
        /// Um vetor de 768 dimensões gravado numa coluna de 1024 falharia no
        /// Postgres no meio da sincronização. Melhor recusar aqui.
        const ai = { run: async () => ({ data: [vetor(768)] }) }
        expect(await embutirVarios(ai, ['a'])).toEqual([null])
    })

    it('binding que lança NÃO derruba quem chamou', async () => {
        const ai = {
            run: async () => {
                throw new Error('AI indisponível')
            },
        }
        expect(await embutirVarios(ai, ['a', 'b'])).toEqual([null, null])
    })

    it('corta texto longo antes de mandar', async () => {
        let recebido = ''
        const ai = {
            run: async (_m: string, e: { text: string[] }) => {
                recebido = e.text[0] ?? ''
                return { data: [vetor()] }
            },
        }
        await embutirVarios(ai, ['x'.repeat(20_000)])
        expect(recebido.length).toBe(8_000)
    })
})

describe('embutidorDoWorkersAi', () => {
    it('sem binding, não há embutidor — e a busca segue por palavra', () => {
        expect(embutidorDoWorkersAi(undefined)).toBeUndefined()
    })

    it('com binding, devolve o vetor do texto', async () => {
        const embutir = embutidorDoWorkersAi({ run: async () => ({ data: [vetor()] }) })
        expect(await embutir?.('senha')).toHaveLength(DIMENSOES)
    })
})
