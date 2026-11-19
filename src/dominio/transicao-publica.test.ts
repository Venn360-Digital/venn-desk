import { describe, expect, it } from 'vitest'

import { estadoPublico, VALIDADE_MS } from './transicao-publica.ts'

describe('estadoPublico', () => {
    const agora = new Date('2026-11-19T15:00:00Z')
    const em = (atras: number) => new Date(agora.getTime() - atras)

    it('verificação recente fala por si', () => {
        expect(estadoPublico({ saudavel: true, verificadoEm: em(60_000) }, agora)).toBe(
            'operacional'
        )
        expect(estadoPublico({ saudavel: false, verificadoEm: em(60_000) }, agora)).toBe(
            'fora_do_ar'
        )
    })

    it('verificação velha vira DESCONHECIDO, mesmo sendo saudável', () => {
        /**
         * O caso que motivou tudo: em 19/11/2026 a página disse "operacional"
         * por dezenove horas com o cron sem nada para sondar. Verde desatualizado
         * responde com confiança a pergunta errada, e ninguém desconfia de verde.
         */
        expect(estadoPublico({ saudavel: true, verificadoEm: em(19 * 3600_000) }, agora)).toBe(
            'desconhecido'
        )
    })

    it('a borda de dez minutos: dentro vale, fora não', () => {
        expect(estadoPublico({ saudavel: true, verificadoEm: em(VALIDADE_MS - 1) }, agora)).toBe(
            'operacional'
        )
        expect(estadoPublico({ saudavel: true, verificadoEm: em(VALIDADE_MS + 1) }, agora)).toBe(
            'desconhecido'
        )
    })

    it('nunca verificado e verificado há muito tempo dizem a MESMA coisa', () => {
        /// A diferença entre os dois é problema nosso, não de quem lê.
        expect(estadoPublico(null, agora)).toBe('desconhecido')
    })
})
