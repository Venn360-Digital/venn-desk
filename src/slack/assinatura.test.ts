import { describe, expect, it } from 'vitest'

import { conferirAssinatura, JANELA_DE_REPETICAO_S } from './assinatura.ts'

const SEGREDO = 'segredo-de-teste-do-slack'
const CORPO = '{"type":"event_callback","event":{"type":"message","text":"oi"}}'
const AGORA = 1_700_000_000

/** Assina como o Slack assina, para a prova não depender de valor colado. */
async function assinarComo(segredo: string, carimbo: number, corpo: string): Promise<string> {
    const chave = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(segredo),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const bytes = await crypto.subtle.sign(
        'HMAC',
        chave,
        new TextEncoder().encode(`v0:${carimbo}:${corpo}`)
    )
    return `v0=${[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

const conferir = (sobrescrever: Record<string, unknown> = {}) =>
    conferirAssinatura({
        segredo: SEGREDO,
        carimbo: String(AGORA),
        corpoCru: CORPO,
        agoraEmSegundos: AGORA,
        assinatura: null,
        ...sobrescrever,
    })

describe('a assinatura do Slack', () => {
    it('aceita uma requisição verdadeira', async () => {
        const assinatura = await assinarComo(SEGREDO, AGORA, CORPO)
        expect(await conferir({ assinatura })).toEqual({ ok: true })
    })

    it('recusa quando o corpo mudou um único byte', async () => {
        const assinatura = await assinarComo(SEGREDO, AGORA, CORPO)
        const resultado = await conferir({ assinatura, corpoCru: `${CORPO} ` })
        expect(resultado).toEqual({ ok: false, motivo: 'assinatura' })
    })

    it('recusa assinatura de OUTRO segredo', async () => {
        const assinatura = await assinarComo('outro-segredo-qualquer', AGORA, CORPO)
        expect(await conferir({ assinatura })).toEqual({ ok: false, motivo: 'assinatura' })
    })

    it('recusa requisição repetida fora da janela', async () => {
        /**
         * A assinatura de uma requisição capturada continua CORRETA para
         * sempre — o segredo não mudou. O que a invalida é o carimbo, e é por
         * isso que ele entra na base assinada.
         */
        const velho = AGORA - JANELA_DE_REPETICAO_S - 1
        const assinatura = await assinarComo(SEGREDO, velho, CORPO)
        const resultado = await conferir({ assinatura, carimbo: String(velho) })
        expect(resultado).toEqual({ ok: false, motivo: 'velha' })
    })

    it('recusa carimbo do futuro pela mesma régua', async () => {
        const futuro = AGORA + JANELA_DE_REPETICAO_S + 1
        const assinatura = await assinarComo(SEGREDO, futuro, CORPO)
        const resultado = await conferir({ assinatura, carimbo: String(futuro) })
        expect(resultado).toEqual({ ok: false, motivo: 'velha' })
    })

    it('aceita na borda da janela', async () => {
        const borda = AGORA - JANELA_DE_REPETICAO_S
        const assinatura = await assinarComo(SEGREDO, borda, CORPO)
        expect(await conferir({ assinatura, carimbo: String(borda) })).toEqual({ ok: true })
    })

    it('FALHA FECHADA sem segredo configurado', async () => {
        /// Um deploy sem o segredo não pode virar porta aberta.
        const assinatura = await assinarComo(SEGREDO, AGORA, CORPO)
        expect(await conferir({ assinatura, segredo: undefined })).toEqual({
            ok: false,
            motivo: 'sem_segredo',
        })
        expect(await conferir({ assinatura, segredo: '' })).toEqual({
            ok: false,
            motivo: 'sem_segredo',
        })
    })

    it('recusa sem os cabeçalhos, e carimbo que não é número', async () => {
        expect(await conferir({ assinatura: null })).toEqual({ ok: false, motivo: 'sem_cabecalhos' })
        const assinatura = await assinarComo(SEGREDO, AGORA, CORPO)
        expect(await conferir({ assinatura, carimbo: null })).toEqual({
            ok: false,
            motivo: 'sem_cabecalhos',
        })
        expect(await conferir({ assinatura, carimbo: 'agora' })).toEqual({
            ok: false,
            motivo: 'sem_cabecalhos',
        })
    })
})
