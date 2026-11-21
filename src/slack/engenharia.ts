import type { App } from '#prisma'

import type { EscopoDoApp } from '../dados/escopo.ts'
import { abrirThreadDeEngenharia } from './ponte.ts'
import { postar } from './cliente.ts'
import { mensagemDePedidoDeAprovacao } from './mensagens.ts'

/**
 * O ponto de saída que o MCP recebe para abrir a thread de engenharia.
 *
 * Existe para que `executar.ts` não conheça o Slack: a ferramenta `escalar`
 * recebe uma função e a chama, e quem monta o contexto decide se há Slack. Pelo
 * MCP de fora não há token e a função não é passada; o escalonamento acontece
 * igual, porque o Slack é superfície de trabalho e não a verdade.
 */
export function saidaDeEngenharia(
    escopo: EscopoDoApp,
    app: Pick<App, 'canalEngenharia' | 'slug'>,
    env: { SLACK_BOT_TOKEN?: string | undefined; URL_BASE?: string | undefined }
): (p: { chamadoId: string; numero: string; resumo: string; ponteiros: string | null }) => Promise<void> {
    return async (p) => {
        await abrirThreadDeEngenharia({
            escopo,
            config: { token: env.SLACK_BOT_TOKEN },
            canal: app.canalEngenharia,
            dados: {
                chamadoId: p.chamadoId,
                numero: p.numero,
                resumo: p.resumo,
                ...(p.ponteiros === null ? {} : { ponteiros: p.ponteiros }),
                urlNoConsole: `${env.URL_BASE ?? ''}/app/${app.slug}/chamados/${p.numero.split('-').pop() ?? ''}`,
            },
        })
    }
}

/**
 * O ponto de saída do pedido de aprovação (Portão 1).
 *
 * Posta em `#desk-aprovacoes`, que é um canal para os três apps: quem aprova
 * decide sobre a plataforma, e um canal por produto espalharia a decisão em três
 * lugares que ninguém acompanha junto. Só o Bridge posta ali (seção 8).
 */
export function saidaDeAprovacao(
    app: Pick<App, 'slug'>,
    env: { SLACK_BOT_TOKEN?: string | undefined; SLACK_CANAL_DE_APROVACOES?: string | undefined; URL_BASE?: string | undefined }
): (p: { problemaId: string; titulo: string; proposta: string; numero: string }) => Promise<void> {
    return async (p) => {
        const canal = env.SLACK_CANAL_DE_APROVACOES
        if (canal === undefined || canal === '') throw new Error('canal de aprovações não configurado')

        const r = await postar(
            { token: env.SLACK_BOT_TOKEN },
            {
                canal,
                mensagem: mensagemDePedidoDeAprovacao({
                    numero: p.numero,
                    problemaId: p.problemaId,
                    titulo: p.titulo,
                    proposta: p.proposta,
                    urlNoConsole: `${env.URL_BASE ?? ''}/app/${app.slug}/chamados/${p.numero.split('-').pop() ?? ''}`,
                }),
            }
        )

        if (!r.ok) throw new Error(`Slack recusou o pedido de aprovação: ${r.erro}`)
    }
}
