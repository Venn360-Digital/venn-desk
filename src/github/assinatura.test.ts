import { describe, expect, it } from 'vitest'

import { conferirAssinaturaDoGitHub } from './assinatura.ts'

const SEGREDO = 'segredo-de-teste'
const CORPO = '{"action":"opened","number":31}'

async function assinar(corpo: string, segredo = SEGREDO): Promise<string> {
    const chave = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(segredo),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const bytes = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo))
    return `sha256=${[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

describe('conferirAssinaturaDoGitHub', () => {
    it('aceita a assinatura certa', async () => {
        expect(
            await conferirAssinaturaDoGitHub({ segredo: SEGREDO, assinatura: await assinar(CORPO), corpoCru: CORPO })
        ).toEqual({ ok: true })
    })

    it('recusa corpo alterado por um caractere', async () => {
        const assinatura = await assinar(CORPO)
        const r = await conferirAssinaturaDoGitHub({
            segredo: SEGREDO,
            assinatura,
            corpoCru: CORPO.replace('31', '32'),
        })
        expect(r).toEqual({ ok: false, motivo: 'assinatura' })
    })

    it('recusa assinatura de outro segredo', async () => {
        const deOutro = await assinar(CORPO, 'outro-segredo')
        expect(await conferirAssinaturaDoGitHub({ segredo: SEGREDO, assinatura: deOutro, corpoCru: CORPO })).toEqual({
            ok: false,
            motivo: 'assinatura',
        })
    })

    it('sem segredo falha FECHADA', async () => {
        /// Ambiente sem o segredo não aceita evento nenhum. O contrário
        /// transformaria um deploy incompleto em porta aberta.
        expect(
            await conferirAssinaturaDoGitHub({ segredo: undefined, assinatura: await assinar(CORPO), corpoCru: CORPO })
        ).toEqual({ ok: false, motivo: 'sem_segredo' })
        expect(await conferirAssinaturaDoGitHub({ segredo: '', assinatura: 'sha256=x', corpoCru: CORPO })).toEqual({
            ok: false,
            motivo: 'sem_segredo',
        })
    })

    it('recusa cabeçalho ausente ou com outro prefixo', async () => {
        /// `sha1=` é a assinatura antiga do GitHub, e aceitá-la aceitaria um
        /// algoritmo que não é o que calculamos.
        expect(await conferirAssinaturaDoGitHub({ segredo: SEGREDO, assinatura: null, corpoCru: CORPO })).toEqual({
            ok: false,
            motivo: 'sem_cabecalho',
        })
        expect(await conferirAssinaturaDoGitHub({ segredo: SEGREDO, assinatura: 'sha1=abc', corpoCru: CORPO })).toEqual({
            ok: false,
            motivo: 'sem_cabecalho',
        })
    })
})
