import type { App } from '#prisma'

import type { EscopoDoApp } from '../dados/escopo.ts'
import { abrirThreadDeEngenharia } from '../slack/ponte.ts'
import { anonimizar } from '../conhecimento/privacidade.ts'
import { postar, type Buscador } from '../slack/cliente.ts'
import { mensagemDePedidoDeAprovacao } from '../slack/mensagens.ts'

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
    app: Pick<App, 'id' | 'canalEngenharia' | 'slug'>,
    env: {
        SLACK_BOT_TOKEN?: string | undefined
        URL_BASE?: string | undefined
        CONHECIMENTO?: { send(mensagem: unknown): Promise<void> } | undefined
    },
    /// Injetável pela mesma razão do canal de alertas: sem isto, o teste de que
    /// o resumo sai anonimizado provaria apenas que `fetch` falha offline.
    buscador?: Buscador
): (p: { chamadoId: string; numero: string; resumo: string; ponteiros: string | null }) => Promise<void> {
    return async (p) => {
        /**
         * O diagnóstico vai para a FILA, não para esta requisição.
         *
         * Ler doze arquivos do GitHub e chamar o modelo leva dezenas de
         * segundos; fazer isso dentro da ferramenta `escalar` faria o agente de
         * atendimento esperar pelo trabalho do N2 — e o cliente esperar pelos
         * dois. A fila é a mesma do conhecimento porque é a fila de trabalho
         * longo que existe, e criar outra exige provisionamento que não se faz
         * num deploy.
         */
        if (env.CONHECIMENTO !== undefined) {
            try {
                await env.CONHECIMENTO.send({
                    tipo: 'diagnosticar-chamado',
                    appId: app.id,
                    chamadoId: p.chamadoId,
                    resumo: p.resumo,
                })
            } catch (erro) {
                console.error('[n2] não consegui enfileirar o diagnóstico:', erro)
            }
        }

        await abrirThreadDeEngenharia({
            escopo,
            config: { token: env.SLACK_BOT_TOKEN, ...(buscador === undefined ? {} : { buscador }) },
            canal: app.canalEngenharia,
            dados: {
                chamadoId: p.chamadoId,
                numero: p.numero,
                /**
                 * O resumo é anonimizado antes de sair (seção 10).
                 *
                 * Ele é escrito pela IA, não pelo cliente — e é justamente por
                 * isso que precisa passar por aqui: o modelo lê o chamado, que
                 * tem e-mail e telefone, e resume. "A cliente maria@x.com não
                 * consegue salvar" é um resumo correto e um dado pessoal no
                 * canal de engenharia, que tem o repositório ligado.
                 *
                 * Achado da revisão de segurança de 23/11/2026.
                 */
                resumo: anonimizar(p.resumo),
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
                    /// Mesma razão do resumo: o título do defeito sai do assunto
                    /// do chamado, que é texto de cliente.
                    titulo: anonimizar(p.titulo),
                    proposta: anonimizar(p.proposta),
                    urlNoConsole: `${env.URL_BASE ?? ''}/app/${app.slug}/chamados/${p.numero.split('-').pop() ?? ''}`,
                }),
            }
        )

        if (!r.ok) throw new Error(`Slack recusou o pedido de aprovação: ${r.erro}`)
    }
}
