import type { WorkersAi } from '../lib/ambiente.ts'

/**
 * O embedding da busca semântica, pelo Workers AI.
 *
 * **Por que o Workers AI.** A chave que o Desk tem é da Anthropic, que não
 * serve embedding. As alternativas eram abrir conta em outro provedor (Voyage,
 * OpenAI) e guardar mais um segredo, ou usar o binding que já vem com o plano
 * Workers Paid. Decisão do André em 19/11/2026: o binding. O `bge-m3` é
 * multilíngue, serve português sem ajuste, e devolve 1024 dimensões — a coluna
 * `embedding` foi redimensionada para isso.
 *
 * **Nunca lança.** Embedding é melhoria da busca, não condição dela: se o
 * binding falhar, quem chamou recebe `null` e a busca cai para palavra, que é o
 * que existia antes e funciona.
 */

export const MODELO_DE_EMBEDDING = '@cf/baai/bge-m3'
export const DIMENSOES = 1024

/**
 * Dois limites, medidos em produção em 20/11/2026: o `bge-m3` aceita 8.192
 * tokens por TEXTO e cerca de 60.000 por CHAMADA ("Max context reached 100908
 * tokens but model supports only 60000" foi a recusa do primeiro lote de 50
 * artigos). Então cada texto é cortado em caracteres — o que a busca precisa
 * está no começo: título três vezes, tags, primeiros parágrafos — e cada
 * chamada leva poucos textos. 2.000 caracteres de português são ~600 tokens;
 * oito por chamada ficam em ~5.000, longe do teto mesmo com texto denso.
 */
export const TAMANHO_MAXIMO = 2_000
export const TEXTOS_POR_CHAMADA = 8

/** O que `buscar_base` recebe: uma função, ou nada. */
export type Embutidor = (texto: string) => Promise<number[] | null>

export function embutidorDoWorkersAi(ai: WorkersAi): Embutidor
export function embutidorDoWorkersAi(ai: WorkersAi | undefined): Embutidor | undefined
export function embutidorDoWorkersAi(ai: WorkersAi | undefined): Embutidor | undefined {
    if (ai === undefined) return undefined

    return async (texto) => {
        const [vetor] = await embutirVarios(ai, [texto])
        return vetor ?? null
    }
}

/**
 * Vários textos numa chamada — é assim que a sincronização embute dezenas de
 * artigos sem dezenas de idas ao binding. Devolve `null` na posição de quem
 * falhou (dimensão errada, resposta vazia), nunca lança.
 */
export async function embutirVarios(ai: WorkersAi, textos: string[]): Promise<(number[] | null)[]> {
    const saida: (number[] | null)[] = []

    for (let i = 0; i < textos.length; i += TEXTOS_POR_CHAMADA) {
        const lote = textos.slice(i, i + TEXTOS_POR_CHAMADA)
        try {
            const resposta = await ai.run(MODELO_DE_EMBEDDING, {
                text: lote.map((t) => t.slice(0, TAMANHO_MAXIMO)),
                /// Rede de segurança: se um texto ainda passar do limite por
                /// token, o modelo corta em vez de recusar a chamada inteira.
                truncate_inputs: true,
            })
            for (let j = 0; j < lote.length; j++) {
                const vetor = resposta.data[j]
                saida.push(vetor !== undefined && vetor.length === DIMENSOES ? vetor : null)
            }
        } catch (erro) {
            console.error('[embedding] o Workers AI falhou; a busca segue por palavra:', erro)
            for (const _ of lote) saida.push(null)
        }
    }

    return saida
}
