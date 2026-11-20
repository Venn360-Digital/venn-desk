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
 * O bge-m3 aceita até 8.192 tokens; cortar o texto em caracteres aqui é
 * grosseiro e suficiente — o que a busca precisa está no começo do artigo
 * (título três vezes, tags, primeiros parágrafos).
 */
const TAMANHO_MAXIMO = 8_000

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
    if (textos.length === 0) return []

    try {
        const resposta = await ai.run(MODELO_DE_EMBEDDING, {
            text: textos.map((t) => t.slice(0, TAMANHO_MAXIMO)),
        })

        return textos.map((_, i) => {
            const vetor = resposta.data[i]
            return vetor !== undefined && vetor.length === DIMENSOES ? vetor : null
        })
    } catch (erro) {
        console.error('[embedding] o Workers AI falhou; a busca segue por palavra:', erro)
        return textos.map(() => null)
    }
}
