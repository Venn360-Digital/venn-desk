import { rodape, slug } from '../rotulos.ts'
import type { ArtigoRenderizado, ContextoDeRenderizacao } from '../tipos.ts'
import type { Produto } from '../extrair/produto.ts'
import { substituirVocabulario } from './vocabulario.ts'

/**
 * Um artigo por seção de regra de produto.
 *
 * O `PRODUCT.md` é escrito no vocabulário do Odontobox (fala em clínica e
 * paciente), porque foi o primeiro produto. Para os outros dois, as palavras
 * são trocadas por fronteira de palavra — e o artigo registra que houve troca,
 * porque concordância de gênero pode sair torta ("a clínica" → "a agência" vai;
 * frases mais longas podem precisar de revisão).
 */
export const PREFIXO_PRODUTO = 'derivado:produto:'
export const CAMINHO_DO_PRODUTO = 'PRODUCT.md'

export function renderizarProduto(produto: Produto, ctx: ContextoDeRenderizacao): ArtigoRenderizado[] {
    const traduzir = ctx.vocabulario.pessoa !== produto.vocabularioDaFonte.pessoa

    return produto.secoes.map((secao) => {
        const corpo = traduzir ? substituirVocabulario(secao.corpo, produto.vocabularioDaFonte, ctx.vocabulario) : secao.corpo

        return {
            chave: `${PREFIXO_PRODUTO}${secao.numero}-${slug(secao.titulo)}`,
            titulo: `Regra: ${secao.titulo}`,
            corpo: [
                corpo,
                '',
                traduzir
                    ? '(As palavras do nicho foram trocadas automaticamente a partir do texto original; a regra é a mesma.)'
                    : '',
                rodape({ descricao: 'as regras de produto da Venn360', caminhos: [CAMINHO_DO_PRODUTO], commit: ctx.commit }),
            ]
                .filter((l) => l !== '')
                .join('\n'),
            tags: ['regra', 'produto', slug(secao.titulo).replace(/-/g, ' ')].slice(0, 20),
            dados: { numero: secao.numero, titulo: secao.titulo, vocabularioSubstituido: traduzir },
            caminhos: [CAMINHO_DO_PRODUTO],
        }
    })
}
