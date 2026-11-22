import type { EscopoDoApp } from '../dados/escopo.ts'

/**
 * Os arquivos que o mapa técnico aponta para uma tela.
 *
 * O mapa já existe na base viva, derivado do repositório: ele diz, para cada
 * rota, quais arquivos a desenham, quais APIs ela chama e quais tabelas elas
 * tocam. É o que transforma "a agenda está errada" em uma lista de doze
 * arquivos para ler — sem ele, o diagnóstico automático começaria procurando no
 * produto inteiro.
 *
 * Devolve na ordem do mapa (tela, depois API, depois modelo), porque o teto de
 * arquivos corta o fim da lista: o que desenha a tela é mais provável de
 * explicar o que o cliente viu do que a tabela no fim do caminho.
 */
export async function arquivosDaTela(escopo: EscopoDoApp, rota: string): Promise<string[]> {
    if (rota === '') return []

    const mapas = await escopo.artigos.listar({ origem: 'DERIVADO' })
    for (const artigo of mapas) {
        if (artigo.chave === null || !artigo.chave.startsWith('derivado:mapa:')) continue

        const dados = artigo.dados as {
            telas?: { rota: string; arquivos?: string[]; apis?: string[] }[]
            apis?: { caminho: string; arquivo?: string }[]
        } | null

        const tela = dados?.telas?.find((t) => t.rota === rota)
        if (tela === undefined) continue

        /// Os arquivos dos handlers das APIs que a tela chama: é lá que mora a
        /// regra, e é a regra que costuma estar errada quando a tela "mostra
        /// errado".
        const dosHandlers = (tela.apis ?? [])
            .map((caminho) => dados?.apis?.find((a) => a.caminho === caminho)?.arquivo)
            .filter((a): a is string => typeof a === 'string')

        return [...new Set([...(tela.arquivos ?? []), ...dosHandlers])]
    }

    return []
}
