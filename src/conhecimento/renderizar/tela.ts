import { rodape, slug } from '../rotulos.ts'
import type { ArtigoRenderizado, ContextoDeRenderizacao } from '../tipos.ts'
import type { Tela } from '../extrair/tela.ts'
import { resolverPlaceholders } from './vocabulario.ts'

/**
 * Um artigo por tela: "Tela: Procedimentos (Vendas → Procedimentos)".
 *
 * O caminho do menu vem do artigo do menu, não do modelo — é o mesmo que o
 * cliente vê na tela, e derivá-lo de novo seria uma segunda fonte de verdade
 * para a mesma coisa.
 *
 * A `evidencia` de cada ação NÃO entra no corpo: ela existe para a verificação
 * (toda afirmação precisa citar o código) e é trecho de código, que a ADR 0012
 * proíbe no texto que chega perto do cliente. Fica em `dados`, para auditoria.
 */
export const PREFIXO_TELA = 'derivado:tela:'

export function chaveDaTela(rota: string): string {
    return `${PREFIXO_TELA}${slug(rota)}`
}

export function renderizarTela(
    tela: Tela,
    rota: string,
    ctx: ContextoDeRenderizacao,
    caminhos: string[],
    caminhoNoMenu: string | null
): ArtigoRenderizado[] {
    const r = (t: string) => resolverPlaceholders(t, ctx.vocabulario)
    const nome = r(tela.nome)

    const bloco = (titulo: string, linhas: string[]): string[] =>
        linhas.length === 0 ? [] : ['', `## ${titulo}`, ...linhas]

    const corpo = [
        r(tela.paraQueServe),
        '',
        caminhoNoMenu === null ? `Endereço: ${rota}` : `Onde fica: ${caminhoNoMenu}`,
        ...bloco(
            'O que se vê na tela',
            tela.oQueSeVe.map((x) => `- ${r(x)}`)
        ),
        ...bloco(
            'O que se pode fazer',
            tela.acoes.map((a) => `- **${r(a.nome)}** — ${r(a.oQueFaz)}`)
        ),
        ...bloco(
            'Campos',
            tela.campos.map((c) => {
                /// Travessão só quando há o que vir depois dele: o modelo
                /// devolve `oQueAceita` em branco quando o arquivo não diz, e
                /// "**Nome** — " solto parece texto faltando.
                const aceita = (c.oQueAceita ?? '').trim()
                return `- **${r(c.nome)}**${c.obrigatorio === true ? ' (obrigatório)' : ''}${aceita === '' ? '' : ` — ${r(aceita)}`}`
            })
        ),
        ...bloco(
            'Avisos que o sistema dá',
            tela.avisos.map((a) => `- ${r(a.quando)}: "${r(a.texto)}"`)
        ),
        ...bloco(
            'Por que algo pode não aparecer',
            tela.porQuePodeNaoAparecer.map((p) => `- ${r(p.situacao)}`)
        ),
        '',
        rodape({ descricao: `a tela ${nome} do produto`, caminhos, commit: ctx.commit }),
    ].join('\n')

    const tags = [
        ...new Set([
            'tela',
            nome.toLowerCase(),
            ...(caminhoNoMenu ?? '').split(' → ').map((x) => x.trim().toLowerCase()).filter((x) => x !== ''),
            ...tela.acoes.slice(0, 8).map((a) => r(a.nome).toLowerCase()),
        ]),
    ]
        .filter((t) => t !== '')
        .slice(0, 20)

    return [
        {
            chave: chaveDaTela(rota),
            titulo: caminhoNoMenu === null ? `Tela: ${nome}` : `Tela: ${nome} (${caminhoNoMenu})`,
            corpo,
            tags,
            dados: { rota, ...tela },
            caminhos,
        },
    ]
}
