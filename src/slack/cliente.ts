import type { MensagemDoSlack } from './mensagens.ts'

/**
 * O cliente da Web API do Slack — a metade que POSTA.
 *
 * `fetch` é injetável para a prova rodar sem rede e sem token: o que importa
 * testar aqui não é se o Slack responde, é o que NÓS mandamos e como lidamos
 * com o que volta.
 *
 * **O erro do Slack não é o código HTTP.** A Web API responde 200 com
 * `{"ok": false, "error": "..."}` em praticamente toda falha de aplicação —
 * canal errado, bot fora do canal, token revogado, thread inexistente. Um
 * cliente que só olha `response.ok` trata tudo isso como sucesso, e o chamado
 * fica "espelhado no Slack" sem nunca ter aparecido lá. É o defeito mais
 * provável desta camada, e é o que as provas cercam.
 *
 * **Nunca derruba o atendimento.** Falhar em postar no Slack é ruim; perder o
 * chamado porque o Slack falhou é pior. Quem chama recebe um resultado, não uma
 * exceção — a decisão de registrar e seguir fica com a camada de cima, como no
 * correio (`src/correio/enviar.ts`).
 */

const API = 'https://slack.com/api'

/** O que o Workers entrega; `globalThis.fetch` em produção. */
export type Buscador = typeof fetch

export interface ConfigDoSlack {
    token: string | undefined
    buscador?: Buscador
}

export interface Postagem {
    canal: string
    mensagem: MensagemDoSlack
    /** `ts` da mensagem-raiz, para responder dentro da thread. */
    naThread?: string | undefined
}

export type Resultado =
    | { ok: true; ts: string; canal: string }
    | { ok: false; erro: string }

async function chamar(
    config: ConfigDoSlack,
    metodo: string,
    corpo: Record<string, unknown>
): Promise<{ ok: true; dados: Record<string, unknown> } | { ok: false; erro: string }> {
    /// Falha fechada, como na assinatura: sem token, nada sai. O contrário
    /// transformaria um deploy incompleto em "espelhado" silencioso.
    if (config.token === undefined || config.token === '') {
        return { ok: false, erro: 'sem_token' }
    }

    const buscador = config.buscador ?? fetch

    let resposta: Response
    try {
        resposta = await buscador(`${API}/${metodo}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(corpo),
        })
    } catch (erro) {
        /// Só o nome: a mensagem de um `fetch` que falhou pode carregar a URL,
        /// e a URL do Slack não leva segredo, mas o hábito é o que protege.
        return { ok: false, erro: erro instanceof Error ? erro.name : 'erro_de_rede' }
    }

    if (!resposta.ok) return { ok: false, erro: `http_${resposta.status}` }

    let dados: Record<string, unknown>
    try {
        dados = (await resposta.json()) as Record<string, unknown>
    } catch {
        return { ok: false, erro: 'resposta_ilegivel' }
    }

    /**
     * Aqui está o ponto. 200 com `ok: false` é como o Slack reporta quase
     * tudo: `channel_not_found`, `not_in_channel`, `invalid_auth`,
     * `thread_not_found`. Confiar no status HTTP daria sucesso em todos.
     */
    if (dados['ok'] !== true) {
        return { ok: false, erro: String(dados['error'] ?? 'erro_desconhecido') }
    }

    return { ok: true, dados }
}

export async function postar(config: ConfigDoSlack, postagem: Postagem): Promise<Resultado> {
    const resposta = await chamar(config, 'chat.postMessage', {
        channel: postagem.canal,
        text: postagem.mensagem.text,
        blocks: postagem.mensagem.blocks,
        ...(postagem.naThread === undefined ? {} : { thread_ts: postagem.naThread }),
        /**
         * `unfurl_links: false`. O Slack, ao desdobrar um link, BUSCA a URL —
         * e as nossas apontam para o Console, atrás de login. O desdobramento
         * não acrescenta nada e dá ao Slack um motivo para visitar endereços
         * nossos a cada mensagem.
         */
        unfurl_links: false,
        unfurl_media: false,
    })

    if (!resposta.ok) return resposta

    const ts = resposta.dados['ts']
    const canal = resposta.dados['channel']
    if (typeof ts !== 'string' || typeof canal !== 'string') {
        /// Sem `ts` não há thread: toda sincronização posterior depende dele,
        /// e guardar um vínculo pela metade seria pior que não guardar.
        return { ok: false, erro: 'resposta_sem_ts' }
    }

    return { ok: true, ts, canal }
}

/**
 * Atualiza uma mensagem já postada — os botões depois de alguém clicar.
 *
 * Separado de `postar` porque o método é outro e porque o `ts` aqui é
 * obrigatório: atualizar sem saber o quê não existe.
 */
export async function atualizar(
    config: ConfigDoSlack,
    alvo: { canal: string; ts: string; mensagem: MensagemDoSlack }
): Promise<Resultado> {
    const resposta = await chamar(config, 'chat.update', {
        channel: alvo.canal,
        ts: alvo.ts,
        text: alvo.mensagem.text,
        blocks: alvo.mensagem.blocks,
    })

    if (!resposta.ok) return resposta

    return { ok: true, ts: alvo.ts, canal: alvo.canal }
}
