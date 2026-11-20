import type { IndiceTecnico, Tela } from './indice.ts'

/**
 * Quais arquivos descrevem uma tela — e quais ficam de fora.
 *
 * Entram: os arquivos da pasta da rota (a tela em si) e, como apoio, os
 * componentes de DOMÍNIO que ela importa e os handlers das APIs que ela chama.
 *
 * Ficam de fora os componentes de `components/shared/`: `DataTable`,
 * `IndexFrame`, `Pagination`, `ConfirmDialog` são o chassi, iguais em toda tela
 * de índice do produto. Mandá-los somaria 10 mil linhas por chamada para
 * ensinar ao modelo o que ele já infere do uso — e o que importa de um chassi
 * (que a lista tem busca e paginação) aparece na própria tela.
 */

const CHASSI = /\/components\/(?:shared|brand|layout)\//
const RAIZ = 'packages/core/src/'

export interface ArquivoEscolhido {
    caminho: string
    sha: string
    papel: 'tela' | 'apoio'
}

/** Quantos arquivos de apoio entram, por tamanho de fila. */
export const MAXIMO_DE_APOIO = 6

export function contextoDaTela(
    tela: Tela,
    indice: IndiceTecnico,
    arvore: Map<string, { sha: string; tamanho: number }>
): ArquivoEscolhido[] {
    const escolhidos: ArquivoEscolhido[] = []
    const vistos = new Set<string>()

    const por = (caminho: string, papel: 'tela' | 'apoio') => {
        if (vistos.has(caminho)) return
        const entrada = arvore.get(caminho)
        if (entrada === undefined) return
        vistos.add(caminho)
        escolhidos.push({ caminho, sha: entrada.sha, papel })
    }

    for (const caminho of tela.arquivos) por(caminho, 'tela')

    /// Componentes de domínio: o índice guarda o caminho sem extensão.
    const deDominio = tela.componentes
        .filter((c) => !CHASSI.test(c))
        .flatMap((c) => [`${c}.tsx`, `${c}.ts`, `${c}/index.tsx`])
        .filter((c) => arvore.has(c))

    /// Handlers das APIs que a tela chama, pelo índice.
    const handlers = tela.apis
        .map((rota) => indice.apis.find((a) => a.rota === rota)?.arquivo)
        .filter((a): a is string => a !== undefined)

    /// Os menores primeiro: cabem mais fontes no mesmo orçamento, e arquivo
    /// pequeno costuma ser o que define forma (Zod, painel) em vez de lógica.
    const apoio = [...new Set([...deDominio, ...handlers])]
        .filter((c) => c.startsWith(RAIZ) && !vistos.has(c))
        .sort((a, b) => (arvore.get(a)?.tamanho ?? 0) - (arvore.get(b)?.tamanho ?? 0))
        .slice(0, MAXIMO_DE_APOIO)

    for (const caminho of apoio) por(caminho, 'apoio')

    return escolhidos
}
