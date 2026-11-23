import { describe, expect, it } from 'vitest'

import { identidadeAnonima, limiteDeAnexos, limiteDeChamados, POLITICA_PADRAO } from './retencao.ts'

const AGORA = new Date('2026-11-23T12:00:00Z')

describe('limites da política', () => {
    it('anexos saem depois de 12 meses, chamados depois de 5 anos', () => {
        expect(limiteDeAnexos(AGORA).toISOString()).toBe('2025-11-23T12:00:00.000Z')
        expect(limiteDeChamados(AGORA).toISOString()).toBe('2021-11-23T12:00:00.000Z')
    })

    it('a política é trocável por app', () => {
        const curta = { anexosEmMeses: 1, chamadosEmAnos: 1 }
        expect(limiteDeAnexos(AGORA, curta).toISOString()).toBe('2026-10-23T12:00:00.000Z')
        expect(limiteDeChamados(AGORA, curta).getUTCFullYear()).toBe(2025)
    })

    it('o padrão é o da seção 10', () => {
        expect(POLITICA_PADRAO).toEqual({ anexosEmMeses: 12, chamadosEmAnos: 5 })
    })
})

describe('identidadeAnonima', () => {
    it('o e-mail anônimo continua ÚNICO por titular', () => {
        /**
         * A coluna é indexada e usada para achar o solicitante: dois titulares
         * anonimizados com o mesmo valor colidiriam. O id interno serve porque
         * não é dado pessoal e já é único.
         */
        const a = identidadeAnonima('req-1')
        const b = identidadeAnonima('req-2')
        expect(a.email).not.toBe(b.email)
        expect(a.email).toContain('req-1')
    })

    it('o domínio é inválido de propósito, para ninguém escrever para lá', () => {
        expect(identidadeAnonima('req-1').email).toMatch(/\.local$/)
    })

    it('o nome diz que havia uma pessoa e que ela pediu para sair', () => {
        /// Quem abre o chamado depois precisa entender o que aconteceu, e não
        /// achar que o dado se perdeu.
        expect(identidadeAnonima('req-1').nome).toContain('exclusão')
    })
})
