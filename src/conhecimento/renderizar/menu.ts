import { rodape } from '../rotulos.ts'
import type { ArtigoRenderizado, ContextoDeRenderizacao } from '../tipos.ts'
import type { Menu } from '../extrair/menu.ts'
import { resolverPlaceholders } from './vocabulario.ts'

/**
 * "Onde fica cada coisa" — um artigo só, com o menu inteiro.
 *
 * Um só porque a pergunta que ele responde é "onde fica X", e X pode ser
 * qualquer item: a busca precisa cair neste artigo para qualquer rótulo, e as
 * tags levam todos eles. O corpo é pequeno (o menu tem ~25 entradas), então
 * não há o custo que justificou um artigo por pergunta na FAQ.
 *
 * A seção final, "nomes das telas por endereço", é o que `obter_chamado` usa
 * para dizer em que tela o cliente estava quando abriu o chamado.
 */
export const CHAVE_MENU = 'derivado:menu'
export const CAMINHO_DO_MENU = 'packages/core/src/lib/nav.ts'

const PAPEL: Record<string, string> = {
    OWNER: 'proprietário',
    ADMIN: 'administrador',
    GESTOR: 'gestor',
    ATENDENTE: 'atendente',
}

function quemVe(papeis: string[] | undefined): string {
    if (papeis === undefined || papeis.length === 0) return ''
    return ` (só ${papeis.map((p) => PAPEL[p] ?? p.toLowerCase()).join(', ')})`
}

export function renderizarMenu(menu: Menu, ctx: ContextoDeRenderizacao): ArtigoRenderizado[] {
    const v = ctx.vocabulario
    const r = (texto: string) => resolverPlaceholders(texto, v)

    const secoes = menu.secoes.map((s) => {
        const cabeca = `## ${r(s.rotulo)}${s.href === undefined ? '' : ` — ${s.href}`}${quemVe(s.papeis)}`
        const itens = (s.itens ?? []).map(
            (i) => `- ${r(i.rotulo)} — ${i.href}${quemVe(i.papeis)}${i.desabilitado === true ? ' (em breve, ainda sem página)' : ''}`
        )
        return [cabeca, ...itens].join('\n')
    })

    const telas = Object.entries(menu.segmentos)
        .map(([seg, rot]) => `/…/${seg} → ${r(rot)}`)
        .join(' · ')

    const rotulos = [
        ...menu.secoes.map((s) => r(s.rotulo)),
        ...menu.secoes.flatMap((s) => (s.itens ?? []).map((i) => r(i.rotulo))),
    ]
    const tags = [...new Set(['menu', 'onde fica', ...rotulos.map((x) => x.toLowerCase())])].slice(0, 20)

    return [
        {
            chave: CHAVE_MENU,
            titulo: `Onde fica cada coisa no ${ctx.app.nome}`,
            corpo: [
                'Os caminhos do menu, como aparecem na tela. Use-os para dizer onde algo fica.',
                '',
                ...secoes,
                '',
                '## Nomes das telas por endereço',
                telas,
                '',
                rodape({ descricao: 'menu do produto', caminhos: [CAMINHO_DO_MENU], commit: ctx.commit }),
            ].join('\n'),
            tags,
            dados: menu,
            caminhos: [CAMINHO_DO_MENU],
        },
    ]
}
