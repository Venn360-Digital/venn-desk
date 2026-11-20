import { importPKCS8, SignJWT } from 'jose'

import { ErroDeLeitura, type Buscador } from './github.ts'

/**
 * A credencial do GitHub App do Venn Desk.
 *
 * **Por que App e não token pessoal.** Token pessoal é de uma pessoa: vence,
 * segue a pessoa, e aparece nos logs como ela. O App é do Desk: a permissão é
 * declarada uma vez (`Contents: read`), a instalação diz em quais repositórios
 * vale, e cada acesso sai como "venn-desk[bot]". É o que a Fase 5 já previa; a
 * decisão do André em 20/11/2026 foi antecipá-lo, porque a organização passou
 * ao plano pago e nada mais o impedia.
 *
 * **Como funciona.** O App assina um JWT curto (RS256, 9 minutos) com a chave
 * privada; o GitHub troca esse JWT por um token de INSTALAÇÃO, que vale uma
 * hora e é o que vai no `Authorization` das leituras. O token fica em memória
 * do isolate e é renovado cinco minutos antes de vencer.
 *
 * **A chave é PKCS#8.** O GitHub entrega a chave em PKCS#1 ("RSA PRIVATE
 * KEY"), que o Web Crypto não importa. A conversão é um comando do openssl, na
 * máquina do André, antes de gravar o segredo — e o erro aqui diz isso.
 */

export interface CredenciaisDoApp {
    appId: string
    instalacaoId: string
    /** PEM PKCS#8 (`-----BEGIN PRIVATE KEY-----`). */
    chavePrivada: string
}

const API = 'https://api.github.com'
/** Renova com esta folga, para um job longo não cair no meio. */
const FOLGA_MS = 5 * 60 * 1000

export interface ObtentorDeToken {
    (): Promise<string>
}

export function credencialDoApp(c: CredenciaisDoApp, buscar: Buscador = fetch, agora: () => number = Date.now): ObtentorDeToken {
    if (!c.chavePrivada.includes('BEGIN PRIVATE KEY')) {
        throw new ErroDeLeitura(
            'token_invalido',
            'A chave do GitHub App precisa estar em PKCS#8 (BEGIN PRIVATE KEY). Converta com `openssl pkcs8 -topk8 -nocrypt`.'
        )
    }

    let guardado: { token: string; expiraEm: number } | null = null

    return async () => {
        if (guardado !== null && guardado.expiraEm - FOLGA_MS > agora()) return guardado.token

        const chave = await importPKCS8(c.chavePrivada, 'RS256')
        const segundos = Math.floor(agora() / 1000)
        /// `iat` um minuto no passado: o relógio do GitHub e o do Worker podem
        /// divergir, e um JWT "do futuro" é recusado.
        const jwt = await new SignJWT({})
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuer(c.appId)
            .setIssuedAt(segundos - 60)
            .setExpirationTime(segundos + 9 * 60)
            .sign(chave)

        const resposta = await buscar(`${API}/app/installations/${encodeURIComponent(c.instalacaoId)}/access_tokens`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'venn-desk',
            },
        })

        if (resposta.status === 401 || resposta.status === 403 || resposta.status === 404) {
            throw new ErroDeLeitura('token_invalido', `O GitHub recusou o App (${resposta.status}): confira APP_ID, INSTALACAO_ID e a chave.`)
        }
        if (!resposta.ok) {
            throw new ErroDeLeitura('resposta_invalida', `O GitHub respondeu ${resposta.status} ao pedir o token de instalação.`)
        }

        const corpo = (await resposta.json()) as { token?: string; expires_at?: string }
        if (typeof corpo.token !== 'string' || typeof corpo.expires_at !== 'string') {
            throw new ErroDeLeitura('resposta_invalida', 'O token de instalação veio sem token ou sem validade.')
        }

        guardado = { token: corpo.token, expiraEm: Date.parse(corpo.expires_at) }
        return guardado.token
    }
}

/**
 * A credencial a partir do ambiente do Worker: o App quando as três variáveis
 * existem, o token pessoal como alternativa, nada quando não há nenhum.
 *
 * As duas formas coexistem de propósito por um tempo: o App é o destino, e o
 * token é o que permite testar a sincronização antes de o App estar instalado.
 */
export function credencialDoAmbiente(env: {
    GITHUB_APP_ID?: string
    GITHUB_APP_INSTALACAO_ID?: string
    GITHUB_APP_CHAVE_PRIVADA?: string
    GITHUB_TOKEN_LEITURA?: string
}): ObtentorDeToken | undefined {
    const temApp = [env.GITHUB_APP_ID, env.GITHUB_APP_INSTALACAO_ID, env.GITHUB_APP_CHAVE_PRIVADA].every(
        (v) => v !== undefined && v !== ''
    )
    if (temApp) {
        return credencialDoApp({
            appId: env.GITHUB_APP_ID ?? '',
            instalacaoId: env.GITHUB_APP_INSTALACAO_ID ?? '',
            chavePrivada: env.GITHUB_APP_CHAVE_PRIVADA ?? '',
        })
    }
    if (env.GITHUB_TOKEN_LEITURA !== undefined && env.GITHUB_TOKEN_LEITURA !== '') {
        const token = env.GITHUB_TOKEN_LEITURA
        return async () => token
    }
    return undefined
}
