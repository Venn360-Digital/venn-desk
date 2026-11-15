import { jwtVerify, SignJWT } from 'jose'
import { z } from 'zod'

import { ErroDeToken } from '../lib/erros.ts'

/**
 * Login e sessão do Console interno.
 *
 * O Console tem login próprio, separado dos apps (seção 10): quem atende não é
 * usuário de app nenhum. A senha é guardada como PBKDF2-SHA256 em `senha_hash`,
 * e a sessão é um JWT HS256 assinado por um segredo do Worker.
 *
 * **100 000 iterações, e não mais.** É o teto que o Workers aplica ao PBKDF2; e
 * o fator de trabalho não é a única defesa — o Console é interno, com lista
 * explícita de agentes, limite de requisições e sem cadastro aberto.
 */

const ITERACOES = 100_000
const CODIFICADOR = new TextEncoder()

/** Oito horas: um turno. Depois disso, entra de novo. */
export const VALIDADE_DA_SESSAO_S = 8 * 60 * 60

function paraBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
}

function deBase64(texto: string): Uint8Array {
    return Uint8Array.from(atob(texto), (c) => c.charCodeAt(0))
}

async function derivar(senha: string, sal: Uint8Array): Promise<Uint8Array> {
    const material = await crypto.subtle.importKey(
        'raw',
        CODIFICADOR.encode(senha),
        'PBKDF2',
        false,
        ['deriveBits']
    )

    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: sal as BufferSource, iterations: ITERACOES },
        material,
        256
    )

    return new Uint8Array(bits)
}

export async function hashDeSenha(senha: string): Promise<string> {
    const sal = crypto.getRandomValues(new Uint8Array(16))
    const derivado = await derivar(senha, sal)
    return `pbkdf2$${ITERACOES}$${paraBase64(sal)}$${paraBase64(derivado)}`
}

export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
    const partes = hash.split('$')
    if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false

    const [, iteracoes, sal, esperado] = partes
    if (Number(iteracoes) !== ITERACOES || sal === undefined || esperado === undefined) return false

    const derivado = paraBase64(await derivar(senha, deBase64(sal)))

    if (derivado.length !== esperado.length) return false

    let diferenca = 0
    for (let i = 0; i < derivado.length; i++) {
        diferenca |= derivado.charCodeAt(i) ^ esperado.charCodeAt(i)
    }

    return diferenca === 0
}

export interface Agente {
    id: string
    nome: string
    papel: 'AGENTE' | 'GESTOR' | 'ADMIN'
}

const esquemaDaSessao = z.object({
    sub: z.string().min(1),
    nome: z.string().min(1),
    papel: z.enum(['AGENTE', 'GESTOR', 'ADMIN']),
})

export async function criarSessao(segredo: string, agente: Agente): Promise<string> {
    const agora = Math.floor(Date.now() / 1000)

    return new SignJWT({ nome: agente.nome, papel: agente.papel })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(agente.id)
        .setAudience('venn-desk-console')
        .setIssuedAt(agora)
        .setExpirationTime(agora + VALIDADE_DA_SESSAO_S)
        .sign(CODIFICADOR.encode(segredo))
}

export async function lerSessao(segredo: string, token: string): Promise<Agente> {
    let payload: unknown
    try {
        const verificado = await jwtVerify(token, CODIFICADOR.encode(segredo), {
            algorithms: ['HS256'],
            audience: 'venn-desk-console',
            requiredClaims: ['exp', 'sub'],
        })
        payload = verificado.payload
    } catch {
        throw new ErroDeToken('sessao_invalida', 'Sessão encerrada. Entre de novo.')
    }

    const claims = esquemaDaSessao.safeParse(payload)
    if (!claims.success) {
        throw new ErroDeToken('sessao_invalida', 'Sessão encerrada. Entre de novo.')
    }

    return { id: claims.data.sub, nome: claims.data.nome, papel: claims.data.papel }
}

/** Só gestor e admin aprovam. A lista de aprovadores por app é conferida à parte. */
export function podeAprovar(agente: Agente): boolean {
    return agente.papel === 'GESTOR' || agente.papel === 'ADMIN'
}
