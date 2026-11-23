import type { EstadoPublico } from './transicao-publica.ts'

export interface AvisoParaOCliente {
    /** `true` quando vale mostrar faixa no widget. */
    mostrar: boolean
    titulo: string
    detalhe: string
    desdeEm: string | null
}

/**
 * O aviso de incidente que o widget mostra (Fase 8).
 *
 * **Por que o texto é nosso e genérico.** O detalhe do episódio diz "HTTP 502",
 * que é verdade e não é informação para quem só quer marcar uma consulta. O
 * cliente precisa de três coisas: que nós sabemos, desde quando, e que ele não
 * precisa abrir chamado para isso.
 *
 * **Por que a última frase existe.** Sem ela, um app fora do ar gera dezenas de
 * chamados do mesmo incidente — e cada um consome atendimento que deveria estar
 * resolvendo a causa. Dizer "já estamos cuidando" é o que transforma trinta
 * chamados em zero.
 */
export function avisoDeIncidente(p: { estado: EstadoPublico; desdeEm: Date | null }): AvisoParaOCliente {
    /**
     * `desconhecido` NÃO mostra faixa.
     *
     * Ele significa "não verificamos há tempo demais", que é problema nosso, não
     * do cliente. Uma faixa de incidente por falta de dado assustaria sem
     * informar — e o estado só existe porque a página de status precisa
     * distinguir "está de pé" de "não sabemos".
     */
    if (p.estado !== 'fora_do_ar') {
        return { mostrar: false, titulo: '', detalhe: '', desdeEm: null }
    }

    return {
        mostrar: true,
        titulo: 'Estamos com uma indisponibilidade',
        detalhe:
            'Nossa equipe já está trabalhando nisso e não é preciso abrir chamado. ' +
            'Se o seu problema for outro, conte aqui.',
        desdeEm: p.desdeEm?.toISOString() ?? null,
    }
}

/** Quanto durou um episódio, em minutos. Nulo enquanto ele não terminou. */
export function duracaoEmMinutos(iniciadoEm: Date, terminadoEm: Date | null): number | null {
    if (terminadoEm === null) return null
    return Math.max(0, Math.round((terminadoEm.getTime() - iniciadoEm.getTime()) / 60_000))
}
