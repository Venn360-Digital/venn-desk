import { rodape } from '../rotulos.ts'
import type { ArtigoRenderizado, ContextoDeRenderizacao } from '../tipos.ts'
import type { Planos } from '../extrair/planos.ts'
import { resolverPlaceholders } from './vocabulario.ts'

export const CHAVE_PLANOS = 'derivado:planos'
export const CAMINHOS_DOS_PLANOS = ['packages/core/src/lib/plan-limits.ts', 'packages/core/src/lib/plans.ts']

const reais = (n: number) => `R$ ${n.toLocaleString('pt-BR')}`
const milhar = (n: number) => n.toLocaleString('pt-BR')

/**
 * "Planos, preços e limites" — um artigo só, com a tabela.
 *
 * Tabela em markdown porque a pergunta real é comparativa ("o Prime tem quantos
 * números?") e uma tabela responde de relance o que três parágrafos obrigam a
 * somar de cabeça. As tags levam os nomes dos planos, para "Prime" achar.
 */
export function renderizarPlanos(planos: Planos, ctx: ContextoDeRenderizacao): ArtigoRenderizado[] {
    const r = (t: string) => resolverPlaceholders(t, ctx.vocabulario)
    const nomes = planos.planos.map((p) => p.nome)

    const cabecalho = `| | ${nomes.join(' | ')} |`
    const separador = `|---|${nomes.map(() => '---').join('|')}|`
    const linhas: [string, (p: Planos['planos'][number]) => string][] = [
        ['Preço mensal', (p) => reais(p.precoMensal)],
        ['Unidades', (p) => String(p.limites.unidades)],
        ['Agentes de IA', (p) => String(p.limites.agentes)],
        ['Números de WhatsApp', (p) => String(p.limites.numerosWhatsApp)],
        ['Créditos de IA por mês', (p) => milhar(p.limites.creditos)],
        ['Mensagens por mês', (p) => milhar(p.limites.mensagens)],
        ['Respostas faladas por mês', (p) => milhar(p.limites.respostasFaladas)],
        ['Destinatários de campanha por mês', (p) => milhar(p.limites.destinatariosBroadcastMes)],
        ['E-mails de campanha por mês', (p) => milhar(p.limites.emailsMes)],
    ]
    const tabela = [
        cabecalho,
        separador,
        ...linhas.map(([rotulo, f]) => `| ${rotulo} | ${planos.planos.map(f).join(' | ')} |`),
    ].join('\n')

    const porPlano = planos.planos.map((p) =>
        [`## ${p.nome} — ${reais(p.precoMensal)}/mês`, r(p.descricao), '', ...p.itens.map((i) => `- ${r(i)}`)].join('\n')
    )

    const adicional = `## Unidade adicional — ${reais(planos.unidadeAdicional.precoMensal)}/mês\nInclui: ${planos.unidadeAdicional.inclui.join(', ')}. Não traz créditos: o consumo continua saindo da franquia do plano e dos créditos avulsos.`
    const anual = `## Pagamento anual\n${Math.round(planos.descontoAnual * 100)}% de desconto sobre o valor mensal.`

    return [
        {
            chave: CHAVE_PLANOS,
            titulo: `Planos, preços e limites do ${ctx.app.nome}`,
            corpo: [
                `Os planos do ${ctx.app.nome}, com o que cada um inclui. Valores mensais.`,
                '',
                tabela,
                '',
                ...porPlano,
                '',
                adicional,
                '',
                anual,
                '',
                rodape({ descricao: 'tabela de planos do produto', caminhos: CAMINHOS_DOS_PLANOS, commit: ctx.commit }),
            ].join('\n'),
            tags: ['planos', 'preço', 'limites', 'créditos', ...nomes.map((n) => n.toLowerCase())].slice(0, 20),
            dados: planos,
            caminhos: CAMINHOS_DOS_PLANOS,
        },
    ]
}
