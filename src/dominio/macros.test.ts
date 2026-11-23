import { describe, expect, it } from 'vitest'

import { definicaoDaMacro, eventoDaMacro, normalizarTag, tagsNormalizadas } from './macros.ts'

describe('definicaoDaMacro', () => {
    it('aceita texto, tags e status juntos ou separados', () => {
        expect(definicaoDaMacro({ texto: 'Pedimos os dados.', status: 'responder_usuario' })).toMatchObject({
            status: 'responder_usuario',
        })
        expect(definicaoDaMacro({ tags: ['cobrança'] })?.tags).toEqual(['cobrança'])
    })

    it('recusa macro que não faz nada', () => {
        /// Uma macro vazia aparece na lista, é clicada e não acontece nada —
        /// o pior tipo de botão.
        expect(definicaoDaMacro({})).toBe(null)
        expect(definicaoDaMacro({ visibilidade: 'INTERNA' })).toBe(null)
    })

    it('recusa transição que tem efeito próprio', () => {
        /**
         * `escalar_engenharia` abre thread no canal de engenharia e
         * `mensagem_do_usuario` reabre o chamado. Esconder isso atrás de um
         * atalho de texto faria o atendente disparar o efeito sem saber.
         */
        expect(definicaoDaMacro({ texto: 'oi', status: 'escalar_engenharia' })).toBe(null)
        expect(definicaoDaMacro({ texto: 'oi', status: 'mensagem_do_usuario' })).toBe(null)
    })

    it('recusa campo desconhecido', () => {
        /// `strict`: um campo com erro de digitação viraria ação silenciosamente
        /// ignorada.
        expect(definicaoDaMacro({ texto: 'oi', statuss: 'resolver' })).toBe(null)
    })

    it('o evento sai da definição, ou nulo', () => {
        expect(eventoDaMacro({ texto: 'oi', status: 'resolver' })).toBe('resolver')
        expect(eventoDaMacro({ texto: 'oi' })).toBe(null)
    })
})

describe('normalizarTag', () => {
    it('baixa a caixa e colapsa espaço, PRESERVANDO acento', () => {
        /**
         * Dobrar o acento criaria tags que ninguém reconhece na lista
         * ("cobranca"). O que se evita é a duplicata por caixa e por espaço,
         * que é o caso real de quem digita com pressa.
         */
        expect(normalizarTag('  Cobrança   Atrasada ')).toBe('cobrança atrasada')
        expect(normalizarTag('COBRANÇA')).toBe('cobrança')
    })

    it('corta no limite, para a tag caber na tela', () => {
        expect(normalizarTag('a'.repeat(60))).toHaveLength(40)
    })
})

describe('tagsNormalizadas', () => {
    it('remove repetida e vazia, mantendo a ordem de quem digitou', () => {
        expect(tagsNormalizadas(['Cobrança', '  ', 'cobrança', 'agenda'])).toEqual(['cobrança', 'agenda'])
    })
})
