const CODIFICADOR = new TextEncoder()

/**
 * A assinatura do webhook do GitHub (`X-Hub-Signature-256`).
 *
 * Parecida com a do Slack e diferente em dois pontos que importam: o GitHub
 * assina só o corpo (não há carimbo de tempo no cálculo) e o prefixo é
 * `sha256=`. Como não há carimbo, não existe janela de repetição a conferir
 * aqui — a defesa contra reentrega é a idempotência por `X-GitHub-Delivery`,
 * feita na rota.
 */

export type Veredito = { ok: true } | { ok: false; motivo: 'sem_segredo' | 'sem_cabecalho' | 'assinatura' }

function hex(bytes: ArrayBuffer): string {
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Tempo constante: as duas vêm do mesmo HMAC, então o tamanho é fixo. */
function igualEmTempoConstante(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diferenca = 0
    for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diferenca === 0
}

export async function conferirAssinaturaDoGitHub(entrada: {
    segredo: string | undefined
    assinatura: string | null
    corpoCru: string
}): Promise<Veredito> {
    /// Falha fechada, como no Slack: ambiente sem segredo não aceita evento
    /// nenhum. O contrário transformaria um deploy incompleto em porta aberta.
    if (entrada.segredo === undefined || entrada.segredo === '') return { ok: false, motivo: 'sem_segredo' }
    if (entrada.assinatura === null || !entrada.assinatura.startsWith('sha256=')) {
        return { ok: false, motivo: 'sem_cabecalho' }
    }

    const chave = await crypto.subtle.importKey(
        'raw',
        CODIFICADOR.encode(entrada.segredo),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )

    const calculada = `sha256=${hex(await crypto.subtle.sign('HMAC', chave, CODIFICADOR.encode(entrada.corpoCru)))}`

    return igualEmTempoConstante(calculada, entrada.assinatura) ? { ok: true } : { ok: false, motivo: 'assinatura' }
}
