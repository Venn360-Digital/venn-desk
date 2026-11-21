import { describe, expect, it } from 'vitest'

import { escopoDoApp } from '../dados/escopo.ts'
import { conexaoFalsa } from '../dados/testes/conexao-falsa.ts'
import { aplicarReacao, espelharAbertura, notaDaThread } from './ponte.ts'

const ABERTURA = {
    numero: 'ODB-1042',
    assunto: 'erro ao salvar agendamento',
    tipo: 'incidente',
    prioridade: 'alta',
    tenantNome: 'Clínica Sorriso',
    urlNoConsole: 'https://desk.venn360.com/app/odontobox/chamados/1042',
    chamadoId: 'tkt-1',
}

const AGENTE = { id: 'ag-1', nome: 'Rita' }

function slackFalso(resposta: Record<string, unknown> = { ok: true, ts: '171.1', channel: 'C1' }) {
    const chamadas: { metodo: string; corpo: unknown }[] = []
    const buscador = (async (url: string, init?: { body?: string }) => {
        chamadas.push({ metodo: String(url).split('/').pop() ?? '', corpo: JSON.parse(init?.body ?? '{}') })
        return new Response(JSON.stringify(resposta), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    return { chamadas, config: { token: 'xoxb-teste', buscador } }
}

describe('espelharAbertura', () => {
    it('posta no canal do app e registra a thread', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'slackThread.create': { id: 'th-1' } })
        const slack = slackFalso()

        const r = await espelharAbertura({
            escopo: escopoDoApp(conexao, 'app-1'),
            config: slack.config,
            canal: 'C-DESK',
            dados: ABERTURA,
        })

        expect(r).toEqual({ espelhou: true })
        expect(slack.chamadas[0]?.metodo).toBe('chat.postMessage')
        expect((slack.chamadas[0]?.corpo as { channel: string }).channel).toBe('C-DESK')
        const criada = chamadas.find((c) => c.delegado === 'slackThread' && c.metodo === 'create')
        expect(criada?.args.data).toMatchObject({ appId: 'app-1', ticketId: 'tkt-1', canal: 'C1', threadTs: '171.1' })
    })

    it('não cria a segunda thread do mesmo chamado', async () => {
        /**
         * Duas threads dividiriam a conversa em duas: o atendente responderia
         * numa e o cliente leria a outra. Acontece de verdade com reentrega de
         * fila e com clique duplo no widget.
         */
        const { conexao } = conexaoFalsa({ 'slackThread.findFirst': { id: 'th-1', ticketId: 'tkt-1' } })
        const slack = slackFalso()

        const r = await espelharAbertura({
            escopo: escopoDoApp(conexao, 'app-1'),
            config: slack.config,
            canal: 'C-DESK',
            dados: ABERTURA,
        })

        expect(r).toEqual({ espelhou: false, motivo: 'ja_existia' })
        expect(slack.chamadas).toHaveLength(0)
    })

    it('app sem canal cadastrado não chama o Slack', async () => {
        const { conexao } = conexaoFalsa()
        const slack = slackFalso()

        expect(
            await espelharAbertura({ escopo: escopoDoApp(conexao, 'app-1'), config: slack.config, canal: null, dados: ABERTURA })
        ).toEqual({ espelhou: false, motivo: 'sem_canal' })
        expect(slack.chamadas).toHaveLength(0)
    })

    it('falha do Slack não vira exceção, e a thread não é registrada', async () => {
        /// Registrar sem postar deixaria o chamado com thread fantasma: toda
        /// mensagem futura iria para um `ts` que não existe.
        const { conexao, chamadas } = conexaoFalsa()
        const slack = slackFalso({ ok: false, error: 'channel_not_found' })

        const r = await espelharAbertura({
            escopo: escopoDoApp(conexao, 'app-1'),
            config: slack.config,
            canal: 'C-APAGADO',
            dados: ABERTURA,
        })

        expect(r.espelhou).toBe(false)
        expect(chamadas.some((c) => c.delegado === 'slackThread' && c.metodo === 'create')).toBe(false)
    })
})

const MENSAGEM = {
    canal: 'C1',
    threadTs: '171.1',
    ts: '171.2',
    usuario: 'U1',
    texto: 'o cliente mandou o print por e-mail, já respondi',
    doBot: false,
}

describe('notaDaThread', () => {
    it('vira nota INTERNA, com o autor e o id do Slack', async () => {
        /**
         * Interna, nunca pública. O caminho mais curto não pode ser o que
         * alcança quem está do lado de fora: um comentário entre colegas
         * publicado por engano é irreversível.
         */
        const { conexao, chamadas } = conexaoFalsa({
            'slackThread.findFirst': { id: 'th-1', ticketId: 'tkt-1', canal: 'C1', threadTs: '171.1' },
            'ticket.findFirst': { id: 'tkt-1', appId: 'app-1', status: 'ABERTO' },
            'ticketMessage.create': { id: 'msg-1', criadoEm: new Date() },
        })

        const r = await notaDaThread({ escopo: escopoDoApp(conexao, 'app-1'), mensagem: MENSAGEM, agente: AGENTE })

        expect(r.destino).toBe('nota-interna')
        const criada = chamadas.find((c) => c.delegado === 'ticketMessage' && c.metodo === 'create')
        expect(criada?.args.data).toMatchObject({
            appId: 'app-1',
            ticketId: 'tkt-1',
            autor: 'HUMANO',
            visibilidade: 'INTERNA',
            origem: 'SLACK',
            autorId: 'ag-1',
            externoId: '171.2',
        })
    })

    it('a reentrega do Slack não vira segunda nota', async () => {
        /// O Events API reentrega por desenho. O índice único `(appId,
        /// externoId)` recusa, e a recusa é tratada como sucesso silencioso.
        const { conexao } = conexaoFalsa({
            'slackThread.findFirst': { id: 'th-1', ticketId: 'tkt-1' },
            'ticket.findFirst': { id: 'tkt-1', appId: 'app-1' },
            'ticketMessage.create': () => {
                throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
            },
        })

        const r = await notaDaThread({ escopo: escopoDoApp(conexao, 'app-1'), mensagem: MENSAGEM, agente: AGENTE })
        expect(r).toEqual({ destino: 'ignorada', motivo: 'reentrega' })
    })

    it('ignora o eco do próprio bot, mensagem vazia, thread sem chamado e autor de fora', async () => {
        const escopoCom = (respostas: Record<string, unknown>) => escopoDoApp(conexaoFalsa(respostas).conexao, 'app-1')
        const comThread = { 'slackThread.findFirst': { id: 'th-1', ticketId: 'tkt-1' } }

        /// Eco do bot: cada postagem nossa geraria uma nota, que geraria outra
        /// postagem.
        expect(
            (await notaDaThread({ escopo: escopoCom(comThread), mensagem: { ...MENSAGEM, doBot: true }, agente: AGENTE })).motivo
        ).toBe('do_bot')
        expect(
            (await notaDaThread({ escopo: escopoCom(comThread), mensagem: { ...MENSAGEM, texto: '   ' }, agente: AGENTE })).motivo
        ).toBe('vazia')
        expect((await notaDaThread({ escopo: escopoCom({}), mensagem: MENSAGEM, agente: AGENTE })).motivo).toBe(
            'thread_sem_chamado'
        )
        /// Sem cadastro em `agents`, qualquer convidado do canal escreveria na
        /// trilha de um chamado com autoria de ninguém.
        expect((await notaDaThread({ escopo: escopoCom(comThread), mensagem: MENSAGEM, agente: null })).motivo).toBe(
            'autor_nao_cadastrado'
        )
    })
})

describe('aplicarReacao', () => {
    const comRaiz = {
        'slackThread.findFirst': { id: 'th-1', ticketId: 'tkt-1', canal: 'C1', threadTs: '171.1' },
        'ticket.findFirst': { id: 'tkt-1', appId: 'app-1', status: 'NOVO' },
        'ticket.updateMany': { count: 1 },
    }

    it('👀 assume e ✅ resolve', async () => {
        const olhos = conexaoFalsa(comRaiz)
        expect(
            await aplicarReacao({
                escopo: escopoDoApp(olhos.conexao, 'app-1'),
                canal: 'C1',
                ts: '171.1',
                reacao: 'eyes',
                agente: AGENTE,
            })
        ).toEqual({ acao: 'assumir' })
        expect(
            olhos.chamadas.some((c) => c.delegado === 'ticketEvent' && JSON.stringify(c.args).includes('assumir'))
        ).toBe(true)

        const check = conexaoFalsa(comRaiz)
        expect(
            await aplicarReacao({
                escopo: escopoDoApp(check.conexao, 'app-1'),
                canal: 'C1',
                ts: '171.1',
                reacao: 'white_check_mark',
                agente: AGENTE,
            })
        ).toEqual({ acao: 'resolver' })
    })

    it('reação em mensagem do MEIO da thread não mexe no chamado', async () => {
        /**
         * Reagir dentro da thread é gesto comum ("vi", "concordo"). Se isso
         * resolvesse o chamado, o Desk fecharia chamados por educação alheia.
         * Só a mensagem-raiz, que é a que tem `ts` igual ao da thread, conta.
         */
        const { conexao, chamadas } = conexaoFalsa({ 'slackThread.findFirst': null })
        const r = await aplicarReacao({
            escopo: escopoDoApp(conexao, 'app-1'),
            canal: 'C1',
            ts: '171.9',
            reacao: 'eyes',
            agente: AGENTE,
        })

        expect(r).toEqual({ acao: null, motivo: 'nao_e_a_raiz' })
        expect(chamadas.some((c) => c.delegado === 'ticket' && c.metodo === 'updateMany')).toBe(false)
    })

    it('emoji sem efeito e autor de fora não mexem em nada', async () => {
        const { conexao, chamadas } = conexaoFalsa(comRaiz)
        const escopo = escopoDoApp(conexao, 'app-1')

        expect((await aplicarReacao({ escopo, canal: 'C1', ts: '171.1', reacao: 'tada', agente: AGENTE })).motivo).toBe(
            'reacao_sem_efeito'
        )
        expect((await aplicarReacao({ escopo, canal: 'C1', ts: '171.1', reacao: 'eyes', agente: null })).motivo).toBe(
            'autor_nao_cadastrado'
        )
        expect(chamadas).toHaveLength(0)
    })

    it('transição recusada pela máquina de estados não derruba a ponte', async () => {
        /// O gesto no Slack não manda no ciclo do chamado: resolver o que já
        /// está fechado continua sendo recusado, e a thread segue.
        const { conexao } = conexaoFalsa({
            ...comRaiz,
            'ticket.findFirst': { id: 'tkt-1', appId: 'app-1', status: 'FECHADO' },
        })

        const r = await aplicarReacao({
            escopo: escopoDoApp(conexao, 'app-1'),
            canal: 'C1',
            ts: '171.1',
            reacao: 'white_check_mark',
            agente: AGENTE,
        })
        expect(r.acao).toBe(null)
    })
})
