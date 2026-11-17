import { describe, expect, it } from 'vitest'

import { atualizar, postar, type Buscador } from './cliente.ts'
import { mensagemDeAbertura } from './mensagens.ts'

const MENSAGEM = mensagemDeAbertura({
    numero: 'ODB-1042',
    assunto: 'erro ao salvar',
    tipo: 'INCIDENTE',
    prioridade: 'ALTA',
    tenantNome: 'Clinica Sorriso',
    urlNoConsole: 'https://desk.venn360.com/app/odontobox/chamados/1042',
    chamadoId: 'chamado-1',
})

interface Chamada {
    url: string
    corpo: Record<string, unknown>
    cabecalhos: Record<string, string>
}

/** Um Slack falso que registra o que recebeu e devolve o que mandarmos. */
function slackFalso(resposta: unknown, status = 200) {
    const chamadas: Chamada[] = []

    const buscador = (async (url: unknown, init: unknown) => {
        const opcoes = init as { body: string; headers: Record<string, string> }
        chamadas.push({
            url: String(url),
            corpo: JSON.parse(opcoes.body) as Record<string, unknown>,
            cabecalhos: opcoes.headers,
        })
        return new Response(JSON.stringify(resposta), {
            status,
            headers: { 'Content-Type': 'application/json' },
        })
    }) as unknown as Buscador

    return { buscador, chamadas }
}

/**
 * Sem valor padrão para o token, de propósito.
 *
 * `(buscador, token = 'xoxb…')` engoliria um `undefined` explícito — é assim
 * que parâmetro padrão funciona em JavaScript — e a prova de "falha fechada
 * sem token" passaria testando o caminho COM token. Aconteceu em 17/11/2026,
 * e só apareceu porque a asserção era sobre o resultado, e não sobre não ter
 * explodido.
 */
const config = (buscador: Buscador, token: string | undefined) => ({ token, buscador })
const comToken = (buscador: Buscador) => config(buscador, 'xoxb-de-teste')

describe('postar no Slack', () => {
    it('manda texto, blocos e o token no cabeçalho', async () => {
        const { buscador, chamadas } = slackFalso({ ok: true, ts: '1700.0001', channel: 'C01' })

        const r = await postar(comToken(buscador), { canal: 'C01', mensagem: MENSAGEM })

        expect(r).toEqual({ ok: true, ts: '1700.0001', canal: 'C01' })
        expect(chamadas[0]?.url).toBe('https://slack.com/api/chat.postMessage')
        expect(chamadas[0]?.cabecalhos['Authorization']).toBe('Bearer xoxb-de-teste')
        expect(chamadas[0]?.corpo['channel']).toBe('C01')
        expect(chamadas[0]?.corpo['text']).toContain('ODB-1042')
        expect(Array.isArray(chamadas[0]?.corpo['blocks'])).toBe(true)
    })

    it('responde dentro da thread quando recebe o ts da raiz', async () => {
        const { buscador, chamadas } = slackFalso({ ok: true, ts: '1700.9', channel: 'C01' })

        await postar(comToken(buscador), {
            canal: 'C01',
            mensagem: MENSAGEM,
            naThread: '1700.0001',
        })

        expect(chamadas[0]?.corpo['thread_ts']).toBe('1700.0001')
    })

    it('sem thread, não manda thread_ts vazio', async () => {
        /// `thread_ts: undefined` serializado viraria ausência de qualquer
        /// forma, mas `thread_ts: ""` viraria erro do Slack. Melhor nem existir.
        const { buscador, chamadas } = slackFalso({ ok: true, ts: '1', channel: 'C01' })

        await postar(comToken(buscador), { canal: 'C01', mensagem: MENSAGEM })

        expect('thread_ts' in (chamadas[0]?.corpo ?? {})).toBe(false)
    })

    it('não deixa o Slack desdobrar os nossos links', async () => {
        /**
         * Desdobrar significa o Slack BUSCAR a URL — e as nossas apontam para o
         * Console, atrás de login. Não acrescenta nada e dá ao Slack um motivo
         * para visitar endereços nossos a cada mensagem.
         */
        const { buscador, chamadas } = slackFalso({ ok: true, ts: '1', channel: 'C01' })

        await postar(comToken(buscador), { canal: 'C01', mensagem: MENSAGEM })

        expect(chamadas[0]?.corpo['unfurl_links']).toBe(false)
        expect(chamadas[0]?.corpo['unfurl_media']).toBe(false)
    })

    it('200 com ok:false é FALHA — o defeito mais provável da camada', async () => {
        /**
         * A Web API responde 200 com `{"ok": false}` em quase toda falha de
         * aplicação: canal errado, bot fora do canal, token revogado. Um
         * cliente que só olha o status HTTP trata tudo isso como sucesso, e o
         * chamado fica "espelhado no Slack" sem nunca ter aparecido lá.
         */
        for (const erro of ['channel_not_found', 'not_in_channel', 'invalid_auth']) {
            const { buscador } = slackFalso({ ok: false, error: erro })

            expect(await postar(comToken(buscador), { canal: 'C01', mensagem: MENSAGEM })).toEqual({
                ok: false,
                erro,
            })
        }
    })

    it('ok:true sem ts também é falha', async () => {
        /// Sem `ts` não há thread, e toda sincronização posterior depende dele.
        /// Guardar um vínculo pela metade é pior que não guardar.
        const { buscador } = slackFalso({ ok: true, channel: 'C01' })

        expect(await postar(comToken(buscador), { canal: 'C01', mensagem: MENSAGEM })).toEqual({
            ok: false,
            erro: 'resposta_sem_ts',
        })
    })

    it('FALHA FECHADA sem token, sem nem tentar a rede', async () => {
        const { buscador, chamadas } = slackFalso({ ok: true, ts: '1', channel: 'C01' })

        expect(
            await postar(config(buscador, undefined), { canal: 'C01', mensagem: MENSAGEM })
        ).toEqual({ ok: false, erro: 'sem_token' })
        expect(await postar(config(buscador, ''), { canal: 'C01', mensagem: MENSAGEM })).toEqual({
            ok: false,
            erro: 'sem_token',
        })
        expect(chamadas.length).toBe(0)
    })

    it('erro de HTTP e corpo ilegível viram resultado, não exceção', async () => {
        const { buscador: cinco } = slackFalso({ ok: false }, 503)
        expect(await postar(comToken(cinco), { canal: 'C01', mensagem: MENSAGEM })).toEqual({
            ok: false,
            erro: 'http_503',
        })

        const ilegivel = (async () =>
            new Response('isto não é json', { status: 200 })) as unknown as Buscador
        expect(await postar(comToken(ilegivel), { canal: 'C01', mensagem: MENSAGEM })).toEqual({
            ok: false,
            erro: 'resposta_ilegivel',
        })
    })

    it('rede caída vira resultado, não exceção', async () => {
        /// Perder a postagem é ruim; perder o chamado porque o Slack caiu é
        /// pior. Quem chama decide o que fazer, e não precisa de try/catch.
        const caido = (async () => {
            throw new TypeError('network error')
        }) as unknown as Buscador

        expect(await postar(comToken(caido), { canal: 'C01', mensagem: MENSAGEM })).toEqual({
            ok: false,
            erro: 'TypeError',
        })
    })
})

describe('atualizar uma mensagem', () => {
    it('usa chat.update e devolve o mesmo ts', async () => {
        const { buscador, chamadas } = slackFalso({ ok: true, ts: '1700.0001', channel: 'C01' })

        const r = await atualizar(comToken(buscador), {
            canal: 'C01',
            ts: '1700.0001',
            mensagem: MENSAGEM,
        })

        expect(r).toEqual({ ok: true, ts: '1700.0001', canal: 'C01' })
        expect(chamadas[0]?.url).toBe('https://slack.com/api/chat.update')
        expect(chamadas[0]?.corpo['ts']).toBe('1700.0001')
    })

    it('message_not_found é falha', async () => {
        const { buscador } = slackFalso({ ok: false, error: 'message_not_found' })

        expect(
            await atualizar(comToken(buscador), { canal: 'C01', ts: '1', mensagem: MENSAGEM })
        ).toEqual({ ok: false, erro: 'message_not_found' })
    })
})
