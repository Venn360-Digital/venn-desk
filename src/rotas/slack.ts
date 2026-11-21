import { Hono, type Context } from 'hono'

import { registrarEntrada } from '../dados/entradas.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import { comCliente } from '../auth/middleware.ts'
import { conferirAssinatura } from '../slack/assinatura.ts'
import { appPorCanal } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { agentePorSlackId } from '../dados/agentes.ts'
import { aplicarReacao, notaDaThread } from '../slack/ponte.ts'

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
rotasDoSlack.post('/slack/comandos', async (c) => {
    if (!(await conferido(c)).ok) return c.json({ erro: 'não autorizado' }, 401)

    return c.json({
        response_type: 'ephemeral',
        text: 'Os comandos do Venn Desk ainda não estão no ar. Use o Console por enquanto.',
    })
})

rotasDoSlack.post('/slack/interativo', async (c) => {
    if (!(await conferido(c)).ok) return c.json({ erro: 'não autorizado' }, 401)

    /// O Slack trata 200 com corpo vazio como "recebido, nada a mostrar".
    console.log('[slack] interação recebida antes da ponte estar no ar')
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
