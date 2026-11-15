import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'

import {
    PUBLICO,
    validarTokenDoApp,
    veOsChamadosDaEmpresa,
    VALIDADE_MAXIMA_S,
} from './token-app.ts'

interface Par {
    privada: CryptoKey
    publicaJwk: JWK
}

async function gerarPar(): Promise<Par> {
    const { privateKey, publicKey } = await generateKeyPair('Ed25519', { extractable: true })
    return { privada: privateKey as CryptoKey, publicaJwk: await exportJWK(publicKey) }
}

const CLAIMS = {
    app: 'odontobox',
    tenant_id: 'clinica-123',
    user_id: 'usuario-456',
    nome: 'Ana Souza',
    email: 'ana@clinicaexemplo.com.br',
    papel: 'member',
    plano: 'pro',
}

async function assinar(
    par: Par,
    opcoes: { claims?: Record<string, unknown>; vidaS?: number; publico?: string } = {}
): Promise<string> {
    const agora = Math.floor(Date.now() / 1000)
    return new SignJWT({ ...CLAIMS, ...opcoes.claims })
        .setProtectedHeader({ alg: 'Ed25519' })
        .setAudience(opcoes.publico ?? PUBLICO)
        .setIssuedAt(agora)
        .setExpirationTime(agora + (opcoes.vidaS ?? 300))
        .sign(par.privada)
}

let odontobox: Par
let conecta: Par

beforeAll(async () => {
    odontobox = await gerarPar()
    conecta = await gerarPar()
})

describe('validação do token do app', () => {
    it('aceita o token do app e devolve a identidade do solicitante', async () => {
        const token = await assinar(odontobox)

        const identidade = await validarTokenDoApp(token, {
            slug: 'odontobox',
            chavePublicaJwk: odontobox.publicaJwk,
        })

        expect(identidade).toEqual({
            appSlug: 'odontobox',
            tenantExternalId: 'clinica-123',
            requesterExternalId: 'usuario-456',
            nome: 'Ana Souza',
            email: 'ana@clinicaexemplo.com.br',
            papelNoTenant: 'member',
            plano: 'pro',
        })
    })

    /**
     * O isolamento entre apps na camada de entrada. É o critério de aceite da
     * Fase 1 — "um token do app A não lê nada do app B" — provado antes de
     * existir consulta: o token nem chega ao banco.
     */
    it('recusa token de um app apresentado como de outro', async () => {
        const token = await assinar(odontobox)

        await expect(
            validarTokenDoApp(token, { slug: 'conecta', chavePublicaJwk: conecta.publicaJwk })
        ).rejects.toThrowError(/sessão expirada|não pertence/i)
    })

    it('recusa token válido na assinatura mas com a claim app de outro', async () => {
        const token = await assinar(odontobox, { claims: { app: 'conecta' } })

        await expect(
            validarTokenDoApp(token, { slug: 'odontobox', chavePublicaJwk: odontobox.publicaJwk })
        ).rejects.toThrowError(/não pertence a este app/i)
    })

    it('recusa token expirado', async () => {
        const agora = Math.floor(Date.now() / 1000)
        const token = await new SignJWT(CLAIMS)
            .setProtectedHeader({ alg: 'Ed25519' })
            .setAudience(PUBLICO)
            .setIssuedAt(agora - 3600)
            .setExpirationTime(agora - 60)
            .sign(odontobox.privada)

        await expect(
            validarTokenDoApp(token, { slug: 'odontobox', chavePublicaJwk: odontobox.publicaJwk })
        ).rejects.toThrowError(/sessão expirada/i)
    })

    it('recusa token de vida longa, mesmo dentro da validade', async () => {
        const token = await assinar(odontobox, { vidaS: VALIDADE_MAXIMA_S + 60 })

        await expect(
            validarTokenDoApp(token, { slug: 'odontobox', chavePublicaJwk: odontobox.publicaJwk })
        ).rejects.toThrowError(/mais tempo do que o permitido/i)
    })

    it('recusa token emitido para outro público', async () => {
        const token = await assinar(odontobox, { publico: 'outro-servico' })

        await expect(
            validarTokenDoApp(token, { slug: 'odontobox', chavePublicaJwk: odontobox.publicaJwk })
        ).rejects.toThrowError(/sessão expirada/i)
    })

    it('recusa token sem as claims que identificam o usuário', async () => {
        const agora = Math.floor(Date.now() / 1000)
        const token = await new SignJWT({ app: 'odontobox', tenant_id: 'clinica-123' })
            .setProtectedHeader({ alg: 'Ed25519' })
            .setAudience(PUBLICO)
            .setIssuedAt(agora)
            .setExpirationTime(agora + 300)
            .sign(odontobox.privada)

        await expect(
            validarTokenDoApp(token, { slug: 'odontobox', chavePublicaJwk: odontobox.publicaJwk })
        ).rejects.toThrowError(/não identifica o usuário/i)
    })

    it('recusa token adulterado', async () => {
        const token = await assinar(odontobox)
        const adulterado = `${token.slice(0, -4)}AAAA`

        await expect(
            validarTokenDoApp(adulterado, {
                slug: 'odontobox',
                chavePublicaJwk: odontobox.publicaJwk,
            })
        ).rejects.toThrowError(/sessão expirada/i)
    })
})

describe('chave cadastrada', () => {
    it('recusa chave que não é Ed25519, em vez de aceitar algoritmo mais fraco', async () => {
        const token = await assinar(odontobox)

        await expect(
            validarTokenDoApp(token, {
                slug: 'odontobox',
                chavePublicaJwk: { kty: 'RSA', n: 'xxxx', e: 'AQAB' },
            })
        ).rejects.toThrowError(/configuração do app está incompleta/i)
    })

    it('aceita a chave exportada sem o campo alg, derivando pela curva', async () => {
        const { alg: _descartado, ...semAlg } = { ...odontobox.publicaJwk, alg: 'Ed25519' }
        const token = await assinar(odontobox)

        await expect(
            validarTokenDoApp(token, { slug: 'odontobox', chavePublicaJwk: semAlg })
        ).resolves.toMatchObject({ appSlug: 'odontobox' })
    })
})

describe('papel no tenant', () => {
    const base = {
        appSlug: 'odontobox',
        tenantExternalId: 't',
        requesterExternalId: 'u',
        nome: 'Ana',
        email: 'ana@exemplo.com',
    }

    it('administrador do tenant vê os chamados da empresa', () => {
        expect(veOsChamadosDaEmpresa({ ...base, papelNoTenant: 'admin' })).toBe(true)
    })

    it('membro vê só os próprios', () => {
        expect(veOsChamadosDaEmpresa({ ...base, papelNoTenant: 'member' })).toBe(false)
    })
})
