import { rodape } from '../rotulos.ts'
import type { ArtigoRenderizado, ContextoDeRenderizacao } from '../tipos.ts'
import type { ItemDeNovidade } from '../extrair/novidades.ts'
import { resolverPlaceholders } from './vocabulario.ts'

export const CHAVE_NOVIDADES = 'derivado:novidades'

/**
 * "O que mudou" — um artigo rolante, agrupado por dia.
 *
 * Por dia porque é assim que a pergunta chega ("mudou algo ontem?"), e porque
 * um deploy costuma levar várias mudanças juntas. O sha de cada item fica só em
 * `dados`: serve para a próxima rodada não repetir o item, e não para o cliente
 * ler.
 */
export function renderizarNovidades(
    itens: ItemDeNovidade[],
    ctx: ContextoDeRenderizacao,
    ateCommit: string
): ArtigoRenderizado[] {
    const r = (t: string) => resolverPlaceholders(t, ctx.vocabulario)

    const porDia = new Map<string, ItemDeNovidade[]>()
    for (const item of itens) {
        const lista = porDia.get(item.data) ?? []
        lista.push(item)
        porDia.set(item.data, lista)
    }

    const dias = [...porDia.entries()].map(([dia, lista]) => {
        const [ano, mes, d] = dia.split('-')
        return [
            `## ${d}/${mes}/${ano}`,
            ...lista.map(
                (i) => `- **${i.tipo === 'novo' ? 'Novo' : 'Correção'}** · ${r(i.titulo)} — ${r(i.descricao)}`
            ),
        ].join('\n')
    })

    return [
        {
            chave: CHAVE_NOVIDADES,
            titulo: `O que mudou no ${ctx.app.nome}`,
            corpo: [
                itens.length === 0
                    ? 'Nenhuma mudança perceptível para quem usa o produto no período.'
                    : `As mudanças publicadas no ${ctx.app.nome}, da mais recente à mais antiga.`,
                '',
                ...dias,
                '',
                rodape({ descricao: 'o histórico de mudanças publicadas', caminhos: ['histórico do repositório'], commit: ateCommit }),
            ].join('\n'),
            tags: ['novidades', 'o que mudou', 'mudanças', 'versão', 'atualização'],
            dados: { itens, ateCommit },
            caminhos: [],
        },
    ]
}
