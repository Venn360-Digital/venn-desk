import type { Context } from 'hono'

import type { Ambiente } from '../lib/ambiente.ts'
import { espelharAbertura } from './ponte.ts'

/**
 * Espelha a abertura do chamado no canal do Slack, fora do caminho da resposta.
 *
 * Mesmo desenho de `src/correio/avisar.ts`: o trabalho vai para `waitUntil`, e
 * nada do que acontece aqui pode atrasar ou derrubar a abertura. O cliente
 * acabou de clicar em "enviar" e o que ele espera é o número do chamado; que o
 * Slack receba a thread meio segundo depois não é problema dele.
 */
export function espelharNoSlack(
    c: Context<Ambiente>,
    chamado: { id: string; numero: number; assunto: string; tipo: string; prioridade: string; contexto: unknown }
): void {
    const escopo = c.get('escopo')
    const app = c.get('app')

    const trabalho = (async () => {
        try {
            const naFila = await escopo.chamados.listarParaFila({ numero: chamado.numero, limite: 1 })
            const tenant = naFila[0]?.tenant ?? null

            const contexto = (chamado.contexto ?? {}) as { modulo?: unknown }
            const modulo = typeof contexto.modulo === 'string' ? contexto.modulo : undefined

            const urlBase = c.env.URL_BASE ?? ''

            const resultado = await espelharAbertura({
                escopo,
                config: { token: c.env.SLACK_BOT_TOKEN },
                canal: app.canalSuporte,
                dados: {
                    numero: `${app.prefixo}-${chamado.numero}`,
                    assunto: chamado.assunto,
                    tipo: chamado.tipo.toLowerCase(),
                    prioridade: chamado.prioridade.toLowerCase(),
                    tenantNome: tenant?.nome ?? 'empresa não identificada',
                    ...(tenant?.plano === null || tenant?.plano === undefined ? {} : { plano: tenant.plano }),
                    ...(modulo === undefined ? {} : { modulo }),
                    urlNoConsole: `${urlBase}/app/${app.slug}/chamados/${chamado.numero}`,
                    chamadoId: chamado.id,
                    /**
                     * A menção só entra quando o app tem atendimento automático
                     * LIGADO: é ela que acorda o Claude no canal, e acordá-lo
                     * num app que decidiu atender à mão seria gastar sem
                     * ninguém ter pedido.
                     */
                    ...(app.atendimentoAutomatico && c.env.SLACK_MENCAO_DO_CLAUDE !== undefined
                        ? { mencaoDoClaude: c.env.SLACK_MENCAO_DO_CLAUDE }
                        : {}),
                },
            })

            if (!resultado.espelhou && resultado.motivo !== 'sem_canal' && resultado.motivo !== 'sem_token') {
                console.error('[slack] abertura não espelhada:', resultado.motivo)
            }
        } catch (erro) {
            console.error('[slack] falha ao espelhar a abertura:', erro)
        }
    })()

    c.executionCtx.waitUntil(trabalho)
}
