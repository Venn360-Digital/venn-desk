import { z } from 'zod'

/**
 * A nota de satisfação (seção 12).
 *
 * **Para que ela existe aqui, e não como enfeite de relatório.** A seção 13
 * nomeia o risco que ela cobre: "resposta errada ao cliente — perda de
 * confiança", mitigado por "modo sombra, CSAT, revisão semanal das respostas
 * com nota baixa". A nota é o único sinal que chega de quem recebeu a resposta;
 * tudo o mais que medimos é o que NÓS achamos do atendimento.
 *
 * **Separada entre IA e humano, e a separação não pode vir do cliente.** O
 * painel compara as duas (seção 12), e é dessa comparação que sai a decisão de
 * ligar ou não o envio automático num app. Se `atendidoPelaIa` viesse no corpo
 * da requisição, a métrica que decide isso seria editável por quem responde o
 * formulário.
 */

/**
 * Um a cinco.
 *
 * Binário ("resolveu? sim/não") teria resposta maior e mediria outra coisa: a
 * seção 13 pede "revisão semanal das respostas com NOTA BAIXA", e num binário
 * não existe nota baixa — existe "não", que mistura "não resolveu" com
 * "resolveu mal". São os dois casos que a revisão precisa separar.
 */
export const NOTA_MINIMA = 1
export const NOTA_MAXIMA = 5

/** Abaixo disto a resposta entra na revisão semanal. */
export const NOTA_DE_ALERTA = 3

export const esquemaDaNota = z.object({
    nota: z.number().int().min(NOTA_MINIMA).max(NOTA_MAXIMA),
    /**
     * Opcional, e curto de propósito.
     *
     * Campo grande convida a escrever um chamado novo dentro da avaliação — e
     * aí a reclamação fica num lugar que ninguém atende. Quem tem mais a dizer
     * reabre o chamado, que é o caminho que responde.
     */
    comentario: z.string().trim().max(600).optional(),
})

export type DadosDaNota = z.infer<typeof esquemaDaNota>

/**
 * Só chamado encerrado recebe nota.
 *
 * Avaliar o que ainda está em andamento mede a ansiedade, não o atendimento —
 * e a nota ficaria presa à primeira impressão de um caso que talvez acabe bem.
 */
const ENCERRADOS = ['RESOLVIDO', 'FECHADO']

export function podeAvaliar(status: string): boolean {
    return ENCERRADOS.includes(status)
}

export function ehBaixa(nota: number): boolean {
    return nota < NOTA_DE_ALERTA
}

/**
 * Quem atendeu, deduzido do que aconteceu no chamado.
 *
 * `true` quando houve ao menos uma resposta pública da IA que não ficou em
 * rascunho. Uma resposta de IA aprovada no modo sombra CONTA como da IA: o
 * texto é dela, e é o texto que o cliente avaliou. Quem aprovou leu; quem
 * escreveu foi o modelo.
 *
 * Deduzir aqui, e não receber do cliente, é o que impede a métrica de decisão
 * de ser editável por quem responde o formulário.
 */
export function atendidoPelaIa(
    mensagens: { autor: string; visibilidade: string; rascunho: boolean }[]
): boolean {
    return mensagens.some(
        (m) => m.autor === 'IA' && m.visibilidade === 'PUBLICA' && !m.rascunho
    )
}

export interface ResumoDeCsat {
    respostas: number
    media: number | null
    baixas: number
    /** A média só da IA e só de humano, para a comparação da seção 12. */
    daIa: { respostas: number; media: number | null }
    deHumano: { respostas: number; media: number | null }
}

function media(notas: number[]): number | null {
    if (notas.length === 0) return null
    return Number((notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(2))
}

/**
 * O resumo, calculado aqui e não em SQL.
 *
 * São dezenas ou centenas de linhas por app, e a conta é uma média. Fazê-la no
 * banco exigiria `groupBy` com filtro por app em três agregações — e este
 * cálculo precisa ser lido e conferido por gente, porque é ele que sustenta a
 * decisão de ligar o atendimento automático.
 */
export function resumirCsat(
    respostas: { nota: number; atendidoPelaIa: boolean }[]
): ResumoDeCsat {
    const daIa = respostas.filter((r) => r.atendidoPelaIa).map((r) => r.nota)
    const deHumano = respostas.filter((r) => !r.atendidoPelaIa).map((r) => r.nota)

    return {
        respostas: respostas.length,
        media: media(respostas.map((r) => r.nota)),
        baixas: respostas.filter((r) => ehBaixa(r.nota)).length,
        daIa: { respostas: daIa.length, media: media(daIa) },
        deHumano: { respostas: deHumano.length, media: media(deHumano) },
    }
}
