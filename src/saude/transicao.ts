/**
 * A transição de estado da verificação de saúde — função pura, sem banco e sem
 * rede, de propósito.
 *
 * O que decide se um app "caiu" é a parte que não pode errar: ela abre problema
 * urgente, acorda gente e publica incidente na página de status. Separada
 * assim, ela é provável em milissegundos, nos casos que importam (o soluço
 * isolado, a queda confirmada, a volta, a queda longa) sem subir banco nem
 * simular rede.
 */

/**
 * Falhas consecutivas antes de declarar a queda.
 *
 * Duas, não uma: uma sondagem sozinha não distingue "o app caiu" de "esta
 * requisição caiu" — reinício de isolate, deploy em andamento, perda de pacote.
 * Com a verificação a cada minuto, o custo de exigir a segunda é no máximo um
 * minuto de atraso no alerta; o custo de não exigir é alerta falso, e alerta
 * falso treina quem recebe a ignorá-lo.
 */
export const LIMITE_DE_FALHAS = 2

/** Quanto a sondagem espera antes de chamar de queda. */
export const TEMPO_LIMITE_MS = 8_000

export interface Sondagem {
    ok: boolean
    latenciaMs: number
    /** Status HTTP ou nome do erro. NUNCA corpo da resposta. */
    detalhe: string
}

export interface Estado {
    saudavel: boolean
    falhasSeguidas: number
    desdeEm: Date
}

export interface Transicao extends Estado {
    /**
     * `caiu` e `voltou` são os únicos momentos em que algo acontece fora do
     * banco — problema, e-mail, Slack, página de status. `null` é o regime
     * normal, e também a primeira falha de uma possível queda: nada sai ainda.
     */
    mudanca: 'caiu' | 'voltou' | null
}

export function transicionarSaude(
    anterior: Estado | null,
    sondagem: Sondagem,
    agora: Date
): Transicao {
    /**
     * Sem estado anterior é app recém-cadastrado, ou verificação recém-ligada.
     * A primeira sondagem ESTABELECE o estado e nunca anuncia mudança: anunciar
     * "voltou" de um app que nunca se soube fora, ou "caiu" de um app que ainda
     * não foi visto de pé uma única vez, é ruído na estreia.
     */
    if (anterior === null) {
        return {
            saudavel: sondagem.ok,
            falhasSeguidas: sondagem.ok ? 0 : 1,
            desdeEm: agora,
            mudanca: null,
        }
    }

    if (sondagem.ok) {
        if (anterior.saudavel) {
            /// Regime normal: o contador zera e `desdeEm` NÃO se move — é ele
            /// que responde "de pé desde quando".
            return { saudavel: true, falhasSeguidas: 0, desdeEm: anterior.desdeEm, mudanca: null }
        }

        return { saudavel: true, falhasSeguidas: 0, desdeEm: agora, mudanca: 'voltou' }
    }

    const falhasSeguidas = anterior.falhasSeguidas + 1

    /// Já estava fora: segue fora, e `desdeEm` continua marcando o início da
    /// queda. O contador cresce porque ele é o que o alerta mostra.
    if (!anterior.saudavel) {
        return { saudavel: false, falhasSeguidas, desdeEm: anterior.desdeEm, mudanca: null }
    }

    if (falhasSeguidas >= LIMITE_DE_FALHAS) {
        return { saudavel: false, falhasSeguidas, desdeEm: agora, mudanca: 'caiu' }
    }

    /// A primeira falha. Conta, mas não declara nada.
    return { saudavel: true, falhasSeguidas, desdeEm: anterior.desdeEm, mudanca: null }
}
