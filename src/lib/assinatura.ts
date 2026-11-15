/**
 * Links assinados de curta duração, para anexo.
 *
 * **Por que HMAC do próprio Worker e não URL pré-assinada do R2.** A URL
 * pré-assinada exige a API S3 do R2 e, com ela, um par de credenciais guardado
 * em segredo — mais uma chave para rodar, vazar e revogar. O binding do R2 não
 * emite URL assinada, mas o Worker já está no caminho da requisição: ele assina
 * o par (chave, validade) com um segredo que nunca sai daqui, e serve o arquivo
 * ele mesmo. O bucket continua privado, sem nenhuma credencial de S3 existir.
 *
 * O que a assinatura cobre: a chave do objeto E o `appId`. Sem o `appId` dentro
 * do que é assinado, um link válido de um app serviria para pedir anexo de
 * outro — a verificação precisa recusar isso, não só a expiração.
 */

const CODIFICADOR = new TextEncoder()

export interface Permissao {
    appId: string
    chave: string
    /** Epoch em segundos. */
    expiraEm: number
}

async function chaveHmac(segredo: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        CODIFICADOR.encode(segredo),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    )
}

function base64Url(bytes: ArrayBuffer): string {
    const binario = String.fromCharCode(...new Uint8Array(bytes))
    return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function corpo(permissao: Permissao): string {
    return `${permissao.appId}:${permissao.chave}:${permissao.expiraEm}`
}

export async function assinar(segredo: string, permissao: Permissao): Promise<string> {
    const assinatura = await crypto.subtle.sign(
        'HMAC',
        await chaveHmac(segredo),
        CODIFICADOR.encode(corpo(permissao))
    )

    return `${permissao.expiraEm}.${base64Url(assinatura)}`
}

/**
 * Confere assinatura e validade. Devolve booleano em vez de lançar porque quem
 * chama responde 404, e não 401: a existência do anexo não é confirmada a quem
 * não tem link válido.
 */
export async function conferir(
    segredo: string,
    entrada: { appId: string; chave: string; token: string },
    agoraEmSegundos = Math.floor(Date.now() / 1000)
): Promise<boolean> {
    const separador = entrada.token.indexOf('.')
    if (separador <= 0) return false

    const expiraEm = Number(entrada.token.slice(0, separador))
    if (!Number.isInteger(expiraEm) || expiraEm < agoraEmSegundos) return false

    const esperada = await assinar(segredo, {
        appId: entrada.appId,
        chave: entrada.chave,
        expiraEm,
    })

    /// Comparação de tamanho fixo: as duas vêm do mesmo HMAC, então basta o
    /// comprimento ser igual para o XOR percorrer tudo.
    if (esperada.length !== entrada.token.length) return false

    let diferenca = 0
    for (let i = 0; i < esperada.length; i++) {
        diferenca |= esperada.charCodeAt(i) ^ entrada.token.charCodeAt(i)
    }

    return diferenca === 0
}

/** A validade do link, em segundos. Curta de propósito (seção 10). */
export const VALIDADE_DO_LINK_S = 300
