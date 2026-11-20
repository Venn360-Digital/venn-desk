import { rodape } from '../rotulos.ts'
import type { ArtigoRenderizado, ContextoDeRenderizacao } from '../tipos.ts'
import type { Papeis } from '../extrair/papeis.ts'

export const CHAVE_PAPEIS = 'derivado:papeis'
export const CAMINHO_DOS_PAPEIS = 'packages/core/src/hooks/usePermissions.ts'

/**
 * "Quem pode fazer o quê" — tabela de capacidade por papel.
 *
 * Tabela porque a pergunta real é comparativa ("o gestor pode transferir?") e
 * uma matriz responde de relance. A `evidencia` fica só em `dados`: é nome de
 * variável, e a ADR 0012 mantém isso longe do texto que chega ao cliente.
 */
export function renderizarPapeis(papeis: Papeis, ctx: ContextoDeRenderizacao): ArtigoRenderizado[] {
    const nomes = new Map(papeis.papeis.map((p) => [p.chave, p.nome]))
    const colunas = papeis.papeis.map((p) => p.nome)

    const tabela = [
        `| O que faz | ${colunas.join(' | ')} |`,
        `|---|${colunas.map(() => '---').join('|')}|`,
        ...papeis.capacidades.map(
            (c) => `| ${c.nome} | ${papeis.papeis.map((p) => (c.papeis.includes(p.chave) ? 'sim' : '—')).join(' | ')} |`
        ),
    ].join('\n')

    return [
        {
            chave: CHAVE_PAPEIS,
            titulo: `Quem pode fazer o quê no ${ctx.app.nome}`,
            corpo: [
                'Os papéis da equipe e o que cada um alcança. Quem administra a conta muda o papel de alguém na tela de usuários.',
                '',
                tabela,
                '',
                '## O que cada permissão significa',
                ...papeis.capacidades.map(
                    (c) =>
                        `- **${c.nome}** — ${c.oQuePermite} (${c.papeis.map((p) => nomes.get(p) ?? p.toLowerCase()).join(', ')})`
                ),
                '',
                'Esconder um item do menu não é permissão: o servidor recusa a ação de quem não pode, mesmo que a pessoa chegue à tela por um link.',
                '',
                rodape({ descricao: 'as permissões por papel do produto', caminhos: [CAMINHO_DOS_PAPEIS], commit: ctx.commit }),
            ].join('\n'),
            tags: ['papéis', 'permissões', 'equipe', 'acesso', ...papeis.papeis.map((p) => p.nome.toLowerCase())].slice(0, 20),
            dados: papeis,
            caminhos: [CAMINHO_DOS_PAPEIS],
        },
    ]
}
