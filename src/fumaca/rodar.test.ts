import { describe, expect, it } from 'vitest'

import { rodarFumaca, resumoDaFumaca, VERIFICACOES, type SondaDeFumaca } from './rodar.ts'

function sondaFalsa(porCaminho: Record<string, number | null>): { sonda: SondaDeFumaca; pedidas: string[] } {
    const pedidas: string[] = []
    return {
        pedidas,
        sonda: async (url) => {
            pedidas.push(url)
            const caminho = new URL(url).pathname
            const status = porCaminho[caminho]
            return status === undefined || status === null ? { status: null, erro: 'TypeError' } : { status }
        },
    }
}

const TUDO_BEM = { '/': 200, '/entrar': 200, '/api/me': 401, '/favicon.ico': 200 }

describe('rodarFumaca', () => {
    it('passa quando as portas abrem e a API recusa', async () => {
        const { sonda, pedidas } = sondaFalsa(TUDO_BEM)
        const r = await rodarFumaca({ urlBase: 'https://staging.odontobox360.com', sonda })

        expect(r).toMatchObject({ passou: true, falharam: 0, total: VERIFICACOES.length })
        expect(pedidas).toContain('https://staging.odontobox360.com/api/me')
        expect(r.linhas.every((l) => l.startsWith('✓'))).toBe(true)
    })

    it('API que RESPONDE 200 sem credencial reprova', async () => {
        /**
         * É a verificação mais importante da lista, e a razão de a sonda
         * devolver status em vez de "ok": um endpoint aberto é pior que um
         * endpoint com erro, e este é o único lugar em que isso apareceria
         * antes de um cliente achar.
         */
        const { sonda } = sondaFalsa({ ...TUDO_BEM, '/api/me': 200 })
        const r = await rodarFumaca({ urlBase: 'https://staging.odontobox360.com', sonda })

        expect(r.passou).toBe(false)
        expect(r.linhas.find((l) => l.includes('API'))).toContain('✗')
    })

    it('redirecionamento para o login conta como porta aberta', async () => {
        /// A raiz de um app autenticado manda para o login, e tratar 302 como
        /// falha reprovaria todo deploy correto.
        const { sonda } = sondaFalsa({ ...TUDO_BEM, '/': 302, '/entrar': 200 })
        expect((await rodarFumaca({ urlBase: 'https://x.com', sonda })).passou).toBe(true)
    })

    it('uma verificação sem resposta não derruba as outras', async () => {
        /// Saber que três portas abriram e uma não é mais útil que um erro só.
        const { sonda } = sondaFalsa({ ...TUDO_BEM, '/entrar': null })
        const r = await rodarFumaca({ urlBase: 'https://x.com', sonda })

        expect(r).toMatchObject({ passou: false, falharam: 1 })
        expect(r.linhas).toHaveLength(VERIFICACOES.length)
        expect(r.linhas.find((l) => l.includes('login'))).toContain('TypeError')
    })

    it('a barra no fim da base não duplica no caminho', async () => {
        const { sonda, pedidas } = sondaFalsa(TUDO_BEM)
        await rodarFumaca({ urlBase: 'https://x.com/', sonda })
        expect(pedidas).toContain('https://x.com/entrar')
    })

    it('o resumo diz o que aconteceu em uma linha', async () => {
        const { sonda } = sondaFalsa(TUDO_BEM)
        expect(resumoDaFumaca(await rodarFumaca({ urlBase: 'https://x.com', sonda }))).toContain('passaram')

        const { sonda: ruim } = sondaFalsa({ ...TUDO_BEM, '/': 500 })
        expect(resumoDaFumaca(await rodarFumaca({ urlBase: 'https://x.com', sonda: ruim }))).toBe(
            'testes de fumaça: 1 de 4 falharam'
        )
    })
})
