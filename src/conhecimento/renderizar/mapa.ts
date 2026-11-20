import { rodape } from '../rotulos.ts'
import type { ArtigoRenderizado, ContextoDeRenderizacao } from '../tipos.ts'
import type { IndiceTecnico } from '../mapa/indice.ts'
import { MODULOS } from '../mapa/modulos.ts'

/**
 * "Mapa técnico: <módulo>" — um artigo por módulo, com a tag `tecnico`.
 *
 * É a camada técnica do documento de referência: tela → componentes → APIs →
 * tabelas, com os caminhos dos arquivos. O N1 não o repete ao cliente (a
 * instrução diz isso, e a bateria confere); ele o usa para ENTENDER o que o
 * cliente descreve e, ao escalar, apontar ao N2 onde olhar.
 *
 * Aviso no corpo, e não só na tag: um artigo é lido inteiro por `obter_artigo`,
 * e a tag fica fora do texto que o modelo recebe.
 */
export const PREFIXO_MAPA = 'derivado:mapa:'
export const AVISO_INTERNO =
    'USO INTERNO — este mapa é para você entender o produto e apontar ao time de engenharia onde olhar. Não repita nomes de arquivo, tabela ou rota de API ao cliente.'

export function renderizarMapa(indice: IndiceTecnico, ctx: ContextoDeRenderizacao): ArtigoRenderizado[] {
    return MODULOS.filter((m) => (indice.arquivosPorModulo[m.slug] ?? []).length > 0).map((modulo) => {
        const telas = indice.telas.filter((t) => t.modulo === modulo.slug)
        const apis = indice.apis.filter((a) => a.modulo === modulo.slug)
        const arquivos = indice.arquivosPorModulo[modulo.slug] ?? []

        const blocoTelas = telas.map((t) =>
            [
                `### ${t.rota}`,
                `- Arquivos: ${t.arquivos.map(curto).join(', ')}`,
                t.componentes.length > 0 ? `- Componentes: ${t.componentes.map(curto).join(', ')}` : null,
                t.apis.length > 0 ? `- Chama: ${t.apis.join(', ')}` : null,
                t.modelos.length > 0 ? `- Tabelas: ${t.modelos.join(', ')}` : null,
            ]
                .filter((l) => l !== null)
                .join('\n')
        )

        const blocoApis = apis.map(
            (a) => `- ${a.metodos.join('/') || '—'} ${a.rota} — ${curto(a.arquivo)}${a.modelos.length > 0 ? ` · tabelas: ${a.modelos.join(', ')}` : ''}${a.zod ? ' · valida entrada' : ''}`
        )

        return {
            chave: `${PREFIXO_MAPA}${modulo.slug}`,
            titulo: `Mapa técnico: ${modulo.nome}`,
            corpo: [
                AVISO_INTERNO,
                '',
                modulo.resumo,
                '',
                `## Telas (${telas.length})`,
                ...(blocoTelas.length > 0 ? blocoTelas : ['(nenhuma tela neste módulo)']),
                '',
                `## APIs (${apis.length})`,
                ...(blocoApis.length > 0 ? blocoApis : ['(nenhuma)']),
                '',
                rodape({ descricao: `mapa técnico derivado do código (${arquivos.length} arquivos)`, caminhos: [`packages/core/src/…/${modulo.slug}`], commit: ctx.commit }),
            ].join('\n'),
            tags: ['tecnico', 'mapa', modulo.slug, ...telas.map((t) => t.rota)].slice(0, 20),
            dados: { modulo: modulo.slug, telas, apis },
            caminhos: arquivos,
        }
    })
}

function curto(caminho: string): string {
    return caminho.replace(/^packages\/core\/src\//, '')
}
