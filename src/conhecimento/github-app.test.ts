import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'

import { credencialDoAmbiente, credencialDoApp } from './github-app.ts'

async function chave() {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
    return { pem: await exportPKCS8(privateKey), publica: publicKey }
}

describe('credencialDoApp', () => {
    it('assina um JWT do App e troca por token de instalação, que fica em cache até perto de vencer', async () => {
        const { pem, publica } = await chave()
        const pedidos: { url: string; auth: string }[] = []
        let relogio = Date.parse('2026-11-20T10:00:00Z')
        const buscar = async (url: string, init: RequestInit) => {
            pedidos.push({ url, auth: (init.headers as Record<string, string>)['Authorization'] ?? '' })
            return new Response(JSON.stringify({ token: 'ghs_instalacao', expires_at: '2026-11-20T11:00:00Z' }), { status: 201 })
        }

        const obter = credencialDoApp({ appId: '12345', instalacaoId: '678', chavePrivada: pem }, buscar, () => relogio)

        expect(await obter()).toBe('ghs_instalacao')
        expect(pedidos[0]?.url).toBe('https://api.github.com/app/installations/678/access_tokens')

        /// O JWT é do App: emissor = App ID, assinado com a chave.
        const jwt = pedidos[0]?.auth.replace('Bearer ', '') ?? ''
        const { payload } = await jwtVerify(jwt, publica, { issuer: '12345', currentDate: new Date(relogio) })
        expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(10 * 60)

        /// Dez minutos depois, o mesmo token: nada de novo pedido.
        relogio += 10 * 60 * 1000
        expect(await obter()).toBe('ghs_instalacao')
        expect(pedidos).toHaveLength(1)

        /// A 56 minutos, dentro da folga de cinco: renova.
        relogio = Date.parse('2026-11-20T10:56:00Z')
        await obter()
        expect(pedidos).toHaveLength(2)
    })

    it('recusa chave PKCS#1 com a orientação de converter', async () => {
        expect(() =>
            credencialDoApp({ appId: '1', instalacaoId: '2', chavePrivada: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----' })
        ).toThrow('openssl pkcs8')
    })

    it('App recusado pelo GitHub é token_invalido, com o status', async () => {
        const { pem } = await chave()
        const obter = credencialDoApp({ appId: '1', instalacaoId: '2', chavePrivada: pem }, async () => new Response('', { status: 401 }))
        await expect(obter()).rejects.toMatchObject({ codigoDeLeitura: 'token_invalido' })
    })
})

describe('credencialDoAmbiente', () => {
    it('prefere o App; cai para o token pessoal; sem nenhum, não há credencial', async () => {
        const { pem } = await chave()
        expect(credencialDoAmbiente({})).toBeUndefined()
        const soToken = credencialDoAmbiente({ GITHUB_TOKEN_LEITURA: 'ghp_x' })
        expect(await soToken?.()).toBe('ghp_x')
        const app = credencialDoAmbiente({ GITHUB_APP_ID: '1', GITHUB_APP_INSTALACAO_ID: '2', GITHUB_APP_CHAVE_PRIVADA: pem, GITHUB_TOKEN_LEITURA: 'ghp_x' })
        expect(app).toBeDefined()
    })

    it('App com variável faltando não vale como App', () => {
        expect(credencialDoAmbiente({ GITHUB_APP_ID: '1', GITHUB_APP_INSTALACAO_ID: '2' })).toBeUndefined()
    })
})
