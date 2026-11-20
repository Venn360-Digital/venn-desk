import { slug, rodape } from '../rotulos.ts'
import type { ArtigoRenderizado, ContextoDeRenderizacao } from '../tipos.ts'
import type { Faq } from '../extrair/faq.ts'

/**
 * Um artigo por pergunta da FAQ.
 *
 * Por pergunta, e não por grupo, porque é assim que a busca acha e o agente
 * lê: "o agente parou de responder" tem de devolver aquela resposta, curta,
 * e não um bloco com seis perguntas em que a certa está no meio. E porque o
 * laço do agente reenvia o contexto a cada passo — artigo pequeno é
 * atendimento barato.
 *
 * O título é a pergunta como o produto a escreve. As tags levam o grupo, para
 * o Console agrupar e para a busca alcançar "créditos" quando a pergunta diz
 * "franquia".
 */
export const PREFIXO_FAQ = 'derivado:faq:'

export function renderizarFaq(faq: Faq, ctx: ContextoDeRenderizacao, caminho: string): ArtigoRenderizado[] {
    return faq.grupos.flatMap((grupo) =>
        grupo.itens.map((item) => ({
            chave: `${PREFIXO_FAQ}${slug(item.p)}`,
            titulo: item.p,
            corpo: [
                item.r,
                '',
                `Tópico: ${grupo.grupo}${grupo.resumo === '' ? '' : ` — ${grupo.resumo}`}`,
                '',
                rodape({
                    descricao: `perguntas frequentes do ${ctx.app.nome}`,
                    caminhos: [caminho],
                    commit: ctx.commit,
                }),
            ].join('\n'),
            tags: ['faq', slug(grupo.grupo)].slice(0, 20),
            dados: { grupo: grupo.grupo, p: item.p, r: item.r },
            caminhos: [caminho],
        }))
    )
}
