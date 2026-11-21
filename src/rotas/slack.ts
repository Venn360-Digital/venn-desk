import { Hono, type Context } from 'hono'

import { registrarEntrada } from '../dados/entradas.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import { comCliente } from '../auth/middleware.ts'
import { conferirAssinatura } from '../slack/assinatura.ts'
import { appPorCanal } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { agentePorEmail, agentePorSlackId, vincularSlackId } from '../dados/agentes.ts'
import {
    aplicarBotao,
    aplicarReacao,
    decidirPortaoDaIssue,
    notaDaThread,
    responderPelaThread,
} from '../slack/ponte.ts'
import { abrirModal, emailDoUsuario } from '../slack/cliente.ts'
import { modalDeResposta } from '../slack/mensagens.ts'
import { appsAtivos } from '../dados/apps.ts'

/**
 * A ponte com o Slack (seção 8) — por ora, só a metade que recebe.
 *
 * O que está aqui: a verificação de assinatura em toda requisição, o
 * handshake de URL, e a trava de idempotência. O que falta é o que precisa do
 * token do bot: postar o chamado na thread, os botões, as reações e o chat ao
 * vivo.
 *
 * **Esta metade foi escrita primeiro de propósito.** É a que decide se um
 * evento é mesmo do Slack, e é a única parte da ponte que pode ser provada sem
 * credencial nenhuma — as oito provas de `src/slack/assinatura.test.ts` rodam
 * no portão, offline. Ela também é o que faz o cadastro do app funcionar de
 * primeira: o Slack confere a URL no instante em que o app é criado.
 */
export const rotasDoSlack = new Hono<Ambiente>()

/** O Slack desiste em 3 s e reentrega. Nada aqui espera o que pode esperar. */
const OK = { ok: true }

/**
 * A conferência comum às três rotas. Devolve o corpo cru — quem chama precisa
 * dele de volta, porque lê-lo uma segunda vez não é possível.
 */
async function conferido(
    c: Context<Ambiente>
): Promise<{ ok: true; corpoCru: string } | { ok: false }> {
    const corpoCru = await c.req.text()
    const veredito = await conferirAssinatura({
        segredo: c.env.SLACK_SIGNING_SECRET,
        assinatura: c.req.header('X-Slack-Signature') ?? null,
        carimbo: c.req.header('X-Slack-Request-Timestamp') ?? null,
        corpoCru,
    })

    if (!veredito.ok) {
        console.warn('[slack] requisição recusada:', veredito.motivo)
        return { ok: false }
    }

    return { ok: true, corpoCru }
}

/**
 * `/desk` e os botões existem no manifesto porque o cadastro do app é feito
 * uma vez só — mas as ações por trás deles dependem do token do bot e ainda não
 * existem. Então eles respondem dizendo isso, em vez de 404.
 *
 * Um 404 aqui apareceria para o atendente como "falha ao enviar", que é a
 * mensagem errada: não houve falha, a função não está no ar.
 */
rotasDoSlack.post('/slack/comandos', comCliente, async (c) => {
    const conferencia = await conferido(c)
    if (!conferencia.ok) return c.json({ erro: 'não autorizado' }, 401)

    const campos = new URLSearchParams(conferencia.corpoCru)
    const texto = (campos.get('text') ?? '').trim().toLowerCase()
    const usuario = campos.get('user_id') ?? ''

    /// Efêmero sempre: a resposta de um comando é para quem digitou. No canal,
    /// ela viraria uma linha que o Claude leria como se fosse do chamado.
    const resposta = (text: string) => c.json({ response_type: 'ephemeral', text })

    if (texto === 'vincular') {
        /**
         * O vínculo entre a conta do Slack e `agents` (seção 8).
         *
         * Sem ele, nada que uma pessoa faz no Slack tem autoria: a nota interna
         * fica sem autor, o botão não age e a reação não resolve. Por isso é
         * auto-serviço, e não um cadastro que alguém precisa pedir.
         *
         * A identidade vem do e-mail verificado pelo Slack num workspace
         * privado e sem convidados, não de texto digitado.
         */
        if (usuario === '') return resposta('Não consegui identificar você no Slack.')

        const email = await emailDoUsuario({ token: c.env.SLACK_BOT_TOKEN }, usuario)
        if (!email.ok) {
            console.error('[slack] vínculo sem e-mail:', email.erro)
            return resposta('Não consegui ler o seu e-mail do Slack. Fale com quem administra o Desk.')
        }

        const agente = await agentePorEmail(c.get('cliente'), email.email)
        if (agente === null) {
            /// Não dizemos se o e-mail existe no Desk: a resposta é a mesma
            /// para quem não é agente e para quem está inativo.
            return resposta('Esse e-mail não está cadastrado como agente ativo no Venn Desk.')
        }

        const vinculo = await vincularSlackId(c.get('cliente'), agente.id, usuario)
        if (!vinculo.ok) return resposta('Esta conta do Slack já está vinculada a outro agente.')

        return resposta(`Pronto, ${agente.nome}. Suas ações no Slack agora valem no Venn Desk.`)
    }

    return resposta(
        'Comandos: `/desk vincular` liga a sua conta do Slack ao seu usuário do Venn Desk. ' +
            'Para assumir, responder ou resolver, use os botões da mensagem do chamado.'
    )
})

/**
 * Os botões e o modal (seção 8).
 *
 * O corpo vem como formulário com um campo `payload` contendo JSON — formato do
 * Slack, não nosso. A assinatura cobre os bytes crus, então ela é conferida
 * antes de qualquer parse.
 *
 * **Tudo responde 200 depressa.** O Slack desiste em três segundos e reentrega;
 * uma resposta lenta vira ação dobrada. Por isso o trabalho que fala com o
 * banco vai em `waitUntil`, menos a abertura do modal, que precisa acontecer
 * dentro da requisição porque o `trigger_id` vale três segundos.
 */
rotasDoSlack.post('/slack/interativo', comCliente, async (c) => {
    const conferencia = await conferido(c)
    if (!conferencia.ok) return c.json({ erro: 'não autorizado' }, 401)

    const campos = new URLSearchParams(conferencia.corpoCru)
    let payload: Record<string, unknown>
    try {
        payload = JSON.parse(campos.get('payload') ?? '{}') as Record<string, unknown>
    } catch {
        return c.json({ erro: 'payload inválido' }, 400)
    }

    const usuario = ((payload['user'] ?? {}) as { id?: unknown }).id
    const agenteDoSlack =
        typeof usuario === 'string' ? await agentePorSlackId(c.get('cliente'), usuario) : null
    const agente = agenteDoSlack === null ? null : { id: agenteDoSlack.id, nome: agenteDoSlack.nome }

    const canal = ((payload['channel'] ?? {}) as { id?: unknown }).id
    const app = typeof canal === 'string' ? await appPorCanal(c.get('cliente'), canal) : null

    if (payload['type'] === 'block_actions') {
        const acao = ((payload['actions'] ?? []) as { action_id?: unknown; value?: unknown }[])[0] ?? {}
        const actionId = typeof acao.action_id === 'string' ? acao.action_id : ''
        const chamadoId = typeof acao.value === 'string' ? acao.value : ''

        if (actionId === 'aprovar_issue' || actionId === 'recusar_issue') {
            /**
             * O Portão 1. O `value` é o id do DEFEITO, não do chamado — o
             * defeito é o que tem etapa e é o que agrupa os incidentes.
             *
             * O app vem do canal de aprovações, que é um só para os três
             * produtos; então o defeito é procurado em cada app até achar, e é
             * o escopo que garante que a decisão caia no produto certo.
             */
            const cliente = c.get('cliente')
            const decisao = actionId === 'aprovar_issue' ? ('APROVADO' as const) : ('RECUSADO' as const)
            const comPapel =
                agenteDoSlack === null
                    ? null
                    : { id: agenteDoSlack.id, nome: agenteDoSlack.nome, papel: String(agenteDoSlack.papel) }

            c.executionCtx.waitUntil(
                (async () => {
                    try {
                        for (const candidato of await appsAtivos(cliente)) {
                            const escopo = escopoDoApp(cliente, candidato.id)
                            if ((await escopo.problemas.porId(chamadoId)) === null) continue
                            const r = await decidirPortaoDaIssue({
                                escopo,
                                problemaId: chamadoId,
                                decisao,
                                agente: comPapel,
                            })
                            console.log('[slack] portão da issue:', JSON.stringify({ app: candidato.slug, decisao, ...r }))
                            return
                        }
                        console.log('[slack] portão sobre defeito inexistente')
                    } catch (erro) {
                        console.error('[slack] portão da issue falhou:', erro)
                    }
                })()
            )
            return c.json(OK)
        }

        /**
         * Daqui para baixo tudo age sobre um CHAMADO, e chamado tem app. O
         * canal de aprovações é a exceção já tratada acima: ele é um só para os
         * três produtos, então não pertence a app nenhum.
         */
        if (app === null) return c.json(OK)
        const escopo = escopoDoApp(c.get('cliente'), app.id)

        if (actionId === 'responder_usuario') {
            /**
             * O modal abre DENTRO da requisição: o `trigger_id` expira em três
             * segundos, e mandá-lo para `waitUntil` o perderia.
             */
            const chamado = chamadoId === '' ? null : await escopo.chamados.porId(chamadoId)
            const triggerId = payload['trigger_id']
            if (chamado === null || typeof triggerId !== 'string') return c.json(OK)

            const aberto = await abrirModal(
                { token: c.env.SLACK_BOT_TOKEN },
                { triggerId, view: modalDeResposta({ chamadoId, numero: `${app.prefixo}-${chamado.numero}` }) }
            )
            if (!aberto.ok) console.error('[slack] modal não abriu:', aberto.erro)
            return c.json(OK)
        }


        if (actionId === 'assumir' || actionId === 'escalar_engenharia' || actionId === 'resolver') {
            c.executionCtx.waitUntil(
                aplicarBotao({ escopo, acao: actionId, chamadoId, agente })
                    .then((r) => {
                        if (!r.feito) console.log('[slack] botão sem efeito:', JSON.stringify({ actionId, motivo: r.motivo }))
                    })
                    .catch((erro: unknown) => console.error('[slack] botão falhou:', erro))
            )
            return c.json(OK)
        }

        /// `abrir_no_console` é só um link: o Slack manda o clique, e não há
        /// nada a fazer deste lado.
        return c.json(OK)
    }

    if (payload['type'] === 'view_submission') {
        const view = (payload['view'] ?? {}) as Record<string, unknown>
        if (view['callback_id'] !== 'responder_usuario') return c.json(OK)

        /**
         * O id do chamado vem de `private_metadata`, que fomos nós que
         * preenchemos ao abrir o modal. O `view_submission` chega sem canal e
         * sem thread, então o app é descoberto pelo próprio chamado — e a
         * escrita só acontece se ele existir no escopo daquele app.
         */
        const chamadoId = typeof view['private_metadata'] === 'string' ? view['private_metadata'] : ''
        const valores = (view['state'] ?? {}) as { values?: Record<string, Record<string, { value?: unknown }>> }
        const texto = valores.values?.['resposta']?.['texto']?.value
        if (chamadoId === '' || typeof texto !== 'string') return c.json(OK)

        const cliente = c.get('cliente')
        c.executionCtx.waitUntil(
            (async () => {
                try {
                    for (const candidato of await appsAtivos(cliente)) {
                        const escopo = escopoDoApp(cliente, candidato.id)
                        if ((await escopo.chamados.porId(chamadoId)) === null) continue
                        const r = await responderPelaThread({
                            escopo,
                            chamadoId,
                            texto,
                            agente,
                            modoSombra: candidato.modoSombra,
                        })
                        console.log('[slack] resposta pelo modal:', JSON.stringify({ app: candidato.slug, ...r }))
                        return
                    }
                    console.log('[slack] modal de chamado inexistente')
                } catch (erro) {
                    console.error('[slack] resposta pelo modal falhou:', erro)
                }
            })()
        )

        /// Corpo vazio fecha o modal. Qualquer outra coisa o Slack mostra como
        /// erro de validação ao atendente.
        return c.body(null, 200)
    }

    return c.json(OK)
})

rotasDoSlack.post('/slack/eventos', comCliente, async (c) => {
    /// O corpo CRU, antes de parsear: a assinatura cobre os bytes exatos, e
    /// reserializar o JSON muda espaços e ordem.
    const corpoCru = await c.req.text()

    let corpo: Record<string, unknown>
    try {
        corpo = JSON.parse(corpoCru) as Record<string, unknown>
    } catch {
        return c.json({ erro: 'corpo inválido' }, 400)
    }

    /**
     * O handshake de URL responde SEM assinatura, e isso é deliberado e
     * delimitado.
     *
     * O Slack confere a URL no instante em que o app é criado — antes de
     * existir um signing secret para configurar aqui. Exigir assinatura neste
     * passo criaria um nó: a URL não verifica sem o segredo, e o segredo não
     * existe sem o app.
     *
     * O que isso abre é devolver ao chamador um texto que ele mesmo mandou.
     * Nada é lido, nada é escrito, nada é revelado. E mesmo esse eco é
     * restringido a alfanumérico curto — o formato do desafio do Slack — para
     * a rota não poder servir conteúdo arbitrário hospedado no nosso domínio.
     */
    if (corpo['type'] === 'url_verification') {
        const desafio = corpo['challenge']
        if (typeof desafio !== 'string' || !/^[A-Za-z0-9]{1,200}$/.test(desafio)) {
            return c.json({ erro: 'desafio inválido' }, 400)
        }
        return c.json({ challenge: desafio })
    }

    const veredito = await conferirAssinatura({
        segredo: c.env.SLACK_SIGNING_SECRET,
        assinatura: c.req.header('X-Slack-Signature') ?? null,
        carimbo: c.req.header('X-Slack-Request-Timestamp') ?? null,
        corpoCru,
    })

    if (!veredito.ok) {
        /// O motivo vai para o log, nunca para a resposta: dizer a quem bateu
        /// se o problema foi a assinatura ou o carimbo o ajuda a acertar.
        console.warn('[slack] requisição recusada:', veredito.motivo)
        return c.json({ erro: 'não autorizado' }, 401)
    }

    const idDoEvento = corpo['event_id']
    if (typeof idDoEvento !== 'string') {
        /// Sem id não há como garantir idempotência. Responder 200 mesmo
        /// assim: reclamar faria o Slack reentregar o que não sabemos tratar.
        console.warn('[slack] evento sem event_id, ignorado')
        return c.json(OK)
    }

    const inedito = await registrarEntrada(c.get('cliente'), 'slack', idDoEvento)
    if (!inedito) return c.json(OK)

    const evento = (corpo['event'] ?? {}) as Record<string, unknown>
    const tipo = evento['type']

    /**
     * O canal diz o app, e o app diz o escopo.
     *
     * Canal que não pertence a app nenhum é o caso comum de alguém convidar o
     * Bridge para outro lugar: responde 200 e não faz nada. Reclamar faria o
     * Slack reentregar para sempre um evento que nunca vamos tratar.
     */
    const canal = typeof evento['channel'] === 'string' ? evento['channel'] : ''
    const app = await appPorCanal(c.get('cliente'), canal)
    if (app === null) {
        console.log('[slack] evento em canal sem app:', JSON.stringify({ tipo, canal }))
        return c.json(OK)
    }

    const escopo = escopoDoApp(c.get('cliente'), app.id)
    const usuario = typeof evento['user'] === 'string' ? evento['user'] : ''
    const agente = usuario === '' ? null : await agentePorSlackId(c.get('cliente'), usuario)

    if (tipo === 'message') {
        /**
         * Só mensagem DENTRO de thread, e só a de texto simples.
         *
         * `subtype` presente é edição, remoção, entrada no canal, arquivo
         * compartilhado — coisas que não são alguém falando sobre o chamado. E
         * mensagem fora de thread não tem chamado a que pertencer: o canal
         * recebe uma thread por chamado, e conversa solta no canal é conversa
         * do time.
         */
        const threadTs = typeof evento['thread_ts'] === 'string' ? evento['thread_ts'] : null
        if (evento['subtype'] !== undefined || threadTs === null) return c.json(OK)

        const r = await notaDaThread({
            escopo,
            agente: agente === null ? null : { id: agente.id, nome: agente.nome },
            mensagem: {
                canal,
                threadTs,
                ts: typeof evento['ts'] === 'string' ? evento['ts'] : '',
                usuario,
                texto: typeof evento['text'] === 'string' ? evento['text'] : '',
                doBot: typeof evento['bot_id'] === 'string',
            },
        })
        if (r.destino === 'ignorada') console.log('[slack] mensagem ignorada:', r.motivo)
        return c.json(OK)
    }

    if (tipo === 'reaction_added') {
        const item = (evento['item'] ?? {}) as Record<string, unknown>
        const r = await aplicarReacao({
            escopo,
            canal: typeof item['channel'] === 'string' ? item['channel'] : canal,
            ts: typeof item['ts'] === 'string' ? item['ts'] : '',
            reacao: typeof evento['reaction'] === 'string' ? evento['reaction'] : '',
            agente: agente === null ? null : { id: agente.id, nome: agente.nome },
        })
        if (r.acao === null) console.log('[slack] reação sem efeito:', r.motivo)
        else console.log('[slack] reação aplicada:', JSON.stringify({ acao: r.acao, app: app.slug }))
        return c.json(OK)
    }

    console.log('[slack] tipo de evento sem tratamento:', JSON.stringify({ tipo, idDoEvento }))
    return c.json(OK)
})
