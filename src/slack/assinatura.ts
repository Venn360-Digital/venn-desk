/**
 * A verificação da assinatura do Slack — a porta de entrada do Bridge.
 *
 * Tudo o que chega do Slack (Events API, botões, modais, `/desk`) entra pela
 * internet aberta, numa URL pública que qualquer um descobre. A única coisa que
 * separa um evento verdadeiro de alguém se passando pelo Slack é esta função.
 * Por isso ela é módulo próprio, com prova, e falha FECHADA: sem segredo
 * configurado, nada é aceito.
 *
 * O protocolo (documentação do Slack):
 *
 *   base = `v0:${timestamp}:${corpo cru}`
 *   assinatura = `v0=` + HMAC-SHA256(segredo, base) em hexadecimal
 *
 * **O corpo tem de ser o CRU.** Reserializar o JSON muda espaços e ordem, e a
 * assinatura deixa de bater — por isso quem chama lê o texto antes de parsear.
 */

const CODIFICADOR = new TextEncoder()

/**
 * Cinco minutos, que é o que o Slack recomenda.
 *
 * Sem janela, uma requisição legítima capturada uma vez valeria para sempre:
 * a assinatura dela continua correta, porque o segredo não mudou. O carimbo de
 * tempo entra na base assinada justamente para ter validade.
 */
export const JANELA_DE_REPETICAO_S = 60 * 5

export type Veredito =
    | { ok: true }
    | { ok: false; motivo: 'sem_segredo' | 'sem_cabecalhos' | 'velha' | 'assinatura' }

function hex(bytes: ArrayBuffer): string {
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Comparação de tempo constante. As duas vêm do mesmo HMAC, então o tamanho é fixo. */
function igualEmTempoConstante(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diferenca = 0
    for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diferenca === 0
}

export async function conferirAssinatura(entrada: {
    segredo: string | undefined
    assinatura: string | null
    carimbo: string | null
    corpoCru: string
    agoraEmSegundos?: number
}): Promise<Veredito> {
    /// Falha fechada: ambiente sem o segredo não aceita evento nenhum. O
    /// contrário — "sem segredo, deixa passar" — transformaria um deploy
    /// incompleto em porta aberta.
    if (entrada.segredo === undefined || entrada.segredo === '') {
        return { ok: false, motivo: 'sem_segredo' }
    }

    if (entrada.assinatura === null || entrada.carimbo === null) {
        return { ok: false, motivo: 'sem_cabecalhos' }
    }

    const carimbo = Number(entrada.carimbo)
    if (!Number.isFinite(carimbo)) return { ok: false, motivo: 'sem_cabecalhos' }

    const agora = entrada.agoraEmSegundos ?? Math.floor(Date.now() / 1000)
    /// `Math.abs`: relógio adiantado do outro lado também é suspeito, e aceitar
    /// carimbo do futuro alargaria a janela de repetição sem necessidade.
    if (Math.abs(agora - carimbo) > JANELA_DE_REPETICAO_S) return { ok: false, motivo: 'velha' }

    const chave = await crypto.subtle.importKey(
        'raw',
        CODIFICADOR.encode(entrada.segredo),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )

    const calculada = `v0=${hex(
        await crypto.subtle.sign(
            'HMAC',
            chave,
            CODIFICADOR.encode(`v0:${entrada.carimbo}:${entrada.corpoCru}`)
        )
    )}`

    return igualEmTempoConstante(calculada, entrada.assinatura)
        ? { ok: true }
        : { ok: false, motivo: 'assinatura' }
}
