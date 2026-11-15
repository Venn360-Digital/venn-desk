import { describe, expect, it } from 'vitest'

import { assinar, conferir, VALIDADE_DO_LINK_S } from './assinatura.ts'

const SEGREDO = 'segredo-de-teste'
const AGORA = 1_800_000_000

const PERMISSAO = {
    appId: 'app-a',
    chave: 'app-a/chamado-1/captura.png',
    expiraEm: AGORA + VALIDADE_DO_LINK_S,
}

describe('link assinado de anexo', () => {
    it('aceita o link que ele mesmo assinou', async () => {
        const token = await assinar(SEGREDO, PERMISSAO)

        await expect(
            conferir(SEGREDO, { appId: PERMISSAO.appId, chave: PERMISSAO.chave, token }, AGORA)
        ).resolves.toBe(true)
    })

    it('recusa depois de expirar', async () => {
        const token = await assinar(SEGREDO, PERMISSAO)

        await expect(
            conferir(
                SEGREDO,
                { appId: PERMISSAO.appId, chave: PERMISSAO.chave, token },
                PERMISSAO.expiraEm + 1
            )
        ).resolves.toBe(false)
    })

    /** O ponto do desenho: o appId está DENTRO do que é assinado. */
    it('recusa link de um app usado para pedir anexo de outro', async () => {
        const token = await assinar(SEGREDO, PERMISSAO)

        await expect(
            conferir(SEGREDO, { appId: 'app-b', chave: PERMISSAO.chave, token }, AGORA)
        ).resolves.toBe(false)
    })

    it('recusa quando a chave do objeto é trocada', async () => {
        const token = await assinar(SEGREDO, PERMISSAO)

        await expect(
            conferir(
                SEGREDO,
                { appId: PERMISSAO.appId, chave: 'app-a/chamado-9/outro.png', token },
                AGORA
            )
        ).resolves.toBe(false)
    })

    it('recusa assinatura de outro segredo', async () => {
        const token = await assinar('outro-segredo', PERMISSAO)

        await expect(
            conferir(SEGREDO, { appId: PERMISSAO.appId, chave: PERMISSAO.chave, token }, AGORA)
        ).resolves.toBe(false)
    })

    it('recusa token malformado sem explodir', async () => {
        for (const token of ['', '.', 'abc', '123', `${AGORA}.`, `.${AGORA}`]) {
            await expect(
                conferir(SEGREDO, { appId: PERMISSAO.appId, chave: PERMISSAO.chave, token }, AGORA)
            ).resolves.toBe(false)
        }
    })
})
