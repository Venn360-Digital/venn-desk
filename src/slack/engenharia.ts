import type { App } from '#prisma'

import type { EscopoDoApp } from '../dados/escopo.ts'
import { abrirThreadDeEngenharia } from './ponte.ts'

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
