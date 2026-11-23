import { describe, expect, it } from 'vitest'

import { escopoDoApp } from '../dados/escopo.ts'
import { conexaoFalsa } from '../dados/testes/conexao-falsa.ts'
import {
    abrirThreadDeEngenharia,
    aplicarBotao,
    decidirPortaoDaIssue,
    aplicarReacao,
    avisarNaThread,
    espelharAbertura,
    notaDaThread,
    responderPelaThread,
} from './ponte.ts'

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

describe('aplicarBotao', () => {
    const comChamado = {
        'ticket.findFirst': { id: 'tkt-1', appId: 'app-1', status: 'NOVO', numero: 1042 },
        'ticket.updateMany': { count: 1 },
    }

    it('assumir, escalar e resolver aplicam o evento e a trilha', async () => {
        for (const [acao, evento] of [
            ['assumir', 'assumir'],
            ['escalar_engenharia', 'escalar_engenharia'],
            ['resolver', 'resolver'],
        ] as const) {
            const { conexao, chamadas } = conexaoFalsa(comChamado)
            const r = await aplicarBotao({
                escopo: escopoDoApp(conexao, 'app-1'),
                acao,
                chamadoId: 'tkt-1',
                agente: AGENTE,
            })
            expect(r).toEqual({ feito: true })
            expect(chamadas.some((c) => c.delegado === 'ticketEvent' && JSON.stringify(c.args).includes(evento))).toBe(true)
        }
    })

    it('chamado de OUTRO app não vira escrita', async () => {
        /**
         * O `value` do botão fomos nós que montamos, mas ele volta pela rede.
         * Conferir contra o escopo é o que impede um payload remontado de
         * escrever no chamado de outro produto.
         */
        const { conexao, chamadas } = conexaoFalsa({ 'ticket.findFirst': null })
        const r = await aplicarBotao({
            escopo: escopoDoApp(conexao, 'app-1'),
            acao: 'resolver',
            chamadoId: 'tkt-de-outro',
            agente: AGENTE,
        })

        expect(r).toEqual({ feito: false, motivo: 'chamado_de_outro_app' })
        expect(chamadas.some((c) => c.metodo === 'updateMany' || c.metodo === 'create')).toBe(false)
    })

    it('quem não está em agents não clica por ninguém', async () => {
        const { conexao, chamadas } = conexaoFalsa(comChamado)
        expect(
            await aplicarBotao({ escopo: escopoDoApp(conexao, 'app-1'), acao: 'assumir', chamadoId: 'tkt-1', agente: null })
        ).toEqual({ feito: false, motivo: 'autor_nao_cadastrado' })
        expect(chamadas).toHaveLength(0)
    })
})

describe('responderPelaThread', () => {
    const comChamado = {
        'ticket.findFirst': { id: 'tkt-1', appId: 'app-1', status: 'ABERTO', numero: 1042 },
        'ticketMessage.create': { id: 'msg-1', criadoEm: new Date() },
        'ticket.updateMany': { count: 1 },
    }

    it('a resposta do modal é PÚBLICA, ao contrário da mensagem de thread', async () => {
        const { conexao, chamadas } = conexaoFalsa(comChamado)
        const r = await responderPelaThread({
            escopo: escopoDoApp(conexao, 'app-1'),
            chamadoId: 'tkt-1',
            texto: 'Abra Vendas e clique em Novo item.',
            agente: AGENTE,
            modoSombra: false,
        })

        expect(r).toEqual({ enviada: true })
        const criada = chamadas.find((c) => c.delegado === 'ticketMessage' && c.metodo === 'create')
        expect(criada?.args.data).toMatchObject({ visibilidade: 'PUBLICA', origem: 'SLACK', rascunho: false })
    })

    it('em modo sombra fica RASCUNHO, e nada sai', async () => {
        /**
         * O modo sombra não é sobre quem escreve: é sobre o app ainda não ter
         * autorizado saída automática pela ponte. Quem aprova é o Console.
         */
        const { conexao, chamadas } = conexaoFalsa(comChamado)
        const r = await responderPelaThread({
            escopo: escopoDoApp(conexao, 'app-1'),
            chamadoId: 'tkt-1',
            texto: 'resposta',
            agente: AGENTE,
            modoSombra: true,
        })

        expect(r).toEqual({ enviada: false })
        const criada = chamadas.find((c) => c.delegado === 'ticketMessage' && c.metodo === 'create')
        expect(criada?.args.data).toMatchObject({ rascunho: true, visibilidade: 'PUBLICA' })
    })

    it('texto vazio e autor de fora não escrevem', async () => {
        const { conexao, chamadas } = conexaoFalsa(comChamado)
        const escopo = escopoDoApp(conexao, 'app-1')
        expect((await responderPelaThread({ escopo, chamadoId: 'tkt-1', texto: '  ', agente: AGENTE, modoSombra: false })).motivo).toBe('vazia')
        expect((await responderPelaThread({ escopo, chamadoId: 'tkt-1', texto: 'oi', agente: null, modoSombra: false })).motivo).toBe('autor_nao_cadastrado')
        expect(chamadas).toHaveLength(0)
    })
})

describe('avisarNaThread', () => {
    it('posta DENTRO da thread do chamado, sem o conteúdo', async () => {
        /**
         * O que vai é que algo aconteceu e o convite a ler pela ferramenta. O
         * conteúdo não vai nem quando é nosso: o canal é lido por modelo, e
         * quem precisa do texto tem o Console ou o MCP.
         */
        const { conexao } = conexaoFalsa({
            'slackThread.findFirst': { id: 'th-1', ticketId: 'tkt-1', canal: 'C1', threadTs: '171.1' },
        })
        const slack = slackFalso()

        const r = await avisarNaThread({
            escopo: escopoDoApp(conexao, 'app-1'),
            config: slack.config,
            chamadoId: 'tkt-1',
            numero: 'ODB-1042',
            novidade: 'o cliente respondeu',
        })

        expect(r).toEqual({ postou: true })
        const corpo = slack.chamadas[0]?.corpo as { channel: string; thread_ts: string; text: string }
        expect(corpo.channel).toBe('C1')
        expect(corpo.thread_ts).toBe('171.1')
        expect(corpo.text).toContain('o cliente respondeu')
        expect(corpo.text).toContain('obter_chamado("ODB-1042")')
    })

    it('chamado sem thread não é erro', async () => {
        /// Chamado aberto antes de o Slack existir, ou app sem canal. Nada a
        /// reportar: o Console segue sendo a verdade.
        const { conexao } = conexaoFalsa({ 'slackThread.findFirst': null })
        const slack = slackFalso()

        expect(
            await avisarNaThread({
                escopo: escopoDoApp(conexao, 'app-1'),
                config: slack.config,
                chamadoId: 'tkt-1',
                numero: 'ODB-1042',
                novidade: 'x',
            })
        ).toEqual({ postou: false, motivo: 'sem_thread' })
        expect(slack.chamadas).toHaveLength(0)
    })
})

describe('abrirThreadDeEngenharia', () => {
    const DADOS = {
        chamadoId: 'tkt-1',
        numero: 'ODB-1042',
        resumo: 'o salvamento de agendamento recorrente falha quando a data final cai num feriado',
        ponteiros: 'agenda/recorrencia.ts:88',
        urlNoConsole: 'https://desk.venn360.com/app/odontobox/chamados/1042',
    }

    it('posta no canal de ENGENHARIA e guarda o vínculo', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'slackThread.findFirst': { id: 'th-1', ticketId: 'tkt-1', canal: 'C-DESK', threadTs: '171.1', threadTsEngenharia: null },
        })
        const slack = slackFalso({ ok: true, ts: '200.1', channel: 'C-ENG' })

        const r = await abrirThreadDeEngenharia({
            escopo: escopoDoApp(conexao, 'app-1'),
            config: slack.config,
            canal: 'C-ENG',
            dados: DADOS,
        })

        expect(r).toEqual({ abriu: true })
        const corpo = slack.chamadas[0]?.corpo as { channel: string; text: string }
        expect(corpo.channel).toBe('C-ENG')
        /// O resumo do N1 atravessa; o relato do cliente não. É a separação
        /// entre os dois canais, que é a defesa principal contra instrução
        /// maliciosa dentro de um chamado.
        expect(corpo.text).toContain('o salvamento de agendamento recorrente falha')
        expect(corpo.text).toContain('agenda/recorrencia.ts:88')
        const vinculo = chamadas.find((c) => c.delegado === 'slackThread' && c.metodo === 'updateMany')
        expect(vinculo?.args.data).toMatchObject({ canalEngenharia: 'C-ENG', threadTsEngenharia: '200.1' })
    })

    it('escalar duas vezes não abre a segunda thread', async () => {
        /// Duas threads dividiriam o diagnóstico. Acontece quando o N1 insiste
        /// e quando um humano repete pelo Console.
        const { conexao } = conexaoFalsa({
            'slackThread.findFirst': { id: 'th-1', ticketId: 'tkt-1', threadTsEngenharia: '200.1' },
        })
        const slack = slackFalso()

        expect(
            await abrirThreadDeEngenharia({
                escopo: escopoDoApp(conexao, 'app-1'),
                config: slack.config,
                canal: 'C-ENG',
                dados: DADOS,
            })
        ).toEqual({ abriu: false, motivo: 'ja_existia' })
        expect(slack.chamadas).toHaveLength(0)
    })

    it('chamado sem thread de suporte ganha as duas de uma vez', async () => {
        /**
         * App sem canal de suporte, ou chamado anterior à ponte. O vínculo é
         * uma linha por chamado, então sem registrar a de suporte o caminho de
         * volta (reação, nota) não funcionaria na thread de engenharia.
         */
        const { conexao, chamadas } = conexaoFalsa({
            'slackThread.findFirst': null,
            'slackThread.create': { id: 'th-2' },
        })
        const slack = slackFalso({ ok: true, ts: '200.1', channel: 'C-ENG' })

        expect(
            await abrirThreadDeEngenharia({
                escopo: escopoDoApp(conexao, 'app-1'),
                config: slack.config,
                canal: 'C-ENG',
                dados: DADOS,
            })
        ).toEqual({ abriu: true })

        const criada = chamadas.find((c) => c.delegado === 'slackThread' && c.metodo === 'create')
        expect(criada?.args.data).toMatchObject({ canal: 'C-ENG', threadTs: '200.1' })
    })

    it('app sem canal de engenharia não posta nada', async () => {
        const { conexao } = conexaoFalsa()
        const slack = slackFalso()
        expect(
            await abrirThreadDeEngenharia({
                escopo: escopoDoApp(conexao, 'app-1'),
                config: slack.config,
                canal: null,
                dados: DADOS,
            })
        ).toEqual({ abriu: false, motivo: 'sem_canal' })
        expect(slack.chamadas).toHaveLength(0)
    })
})

describe('decidirPortaoDaIssue', () => {
    const GESTOR = { id: 'ag-9', nome: 'Ana', papel: 'GESTOR' }
    const comDefeito = {
        'problem.findFirst': { id: 'pb-1', appId: 'app-1', titulo: 'agenda recorrente', etapa: 'ISSUE_CRIADA' },
        'approval.findMany': [],
        'problem.updateMany': { count: 1 },
        'approval.create': { id: 'ap-1' },
    }

    it('gestor aprova: registra a decisão e avança a etapa', async () => {
        const { conexao, chamadas } = conexaoFalsa(comDefeito)

        const r = await decidirPortaoDaIssue({
            escopo: escopoDoApp(conexao, 'app-1'),
            problemaId: 'pb-1',
            decisao: 'APROVADO',
            agente: GESTOR,
        })

        expect(r).toEqual({ decidido: true })
        const decisao = chamadas.find((c) => c.delegado === 'approval' && c.metodo === 'create')
        expect(decisao?.args.data).toMatchObject({ portao: 'ISSUE', decisao: 'APROVADO', aprovadorId: 'ag-9' })
        const etapa = chamadas.find((c) => c.delegado === 'problem' && c.metodo === 'updateMany')
        expect(etapa?.args.data).toMatchObject({ etapa: 'APROVADO_PELO_GESTOR' })
    })

    it('AGENTE de nível 1 não aprova — seria a IA se aprovando por outro caminho', async () => {
        /**
         * A trava central do projeto: nenhuma credencial usada pela IA aprova
         * issue, faz merge ou publica. Um atendente clicando em "Aprovar"
         * contornaria a regra sem violá-la na letra.
         */
        const { conexao, chamadas } = conexaoFalsa(comDefeito)

        const r = await decidirPortaoDaIssue({
            escopo: escopoDoApp(conexao, 'app-1'),
            problemaId: 'pb-1',
            decisao: 'APROVADO',
            agente: { id: 'ag-1', nome: 'Rita', papel: 'AGENTE' },
        })

        expect(r).toEqual({ decidido: false, motivo: 'sem_papel_de_aprovador' })
        expect(chamadas).toHaveLength(0)
    })

    it('recusa é estado final do defeito', async () => {
        const { conexao, chamadas } = conexaoFalsa(comDefeito)

        expect(
            await decidirPortaoDaIssue({
                escopo: escopoDoApp(conexao, 'app-1'),
                problemaId: 'pb-1',
                decisao: 'RECUSADO',
                agente: GESTOR,
            })
        ).toEqual({ decidido: true })

        const etapa = chamadas.find((c) => c.delegado === 'problem' && c.metodo === 'updateMany')
        expect(etapa?.args.data).toMatchObject({ etapa: 'RECUSADO_PELO_GESTOR' })
    })

    it('o segundo clique não decide de novo', async () => {
        /// Dois gestores clicam ao mesmo tempo, ou alguém clica duas vezes. A
        /// primeira decisão é a que vale, e a trilha fica com uma linha.
        const { conexao, chamadas } = conexaoFalsa({
            ...comDefeito,
            'approval.findMany': [{ portao: 'ISSUE', decisao: 'APROVADO', aprovadorId: 'ag-9', criadoEm: new Date() }],
        })

        const r = await decidirPortaoDaIssue({
            escopo: escopoDoApp(conexao, 'app-1'),
            problemaId: 'pb-1',
            decisao: 'RECUSADO',
            agente: GESTOR,
        })

        expect(r).toEqual({ decidido: false, motivo: 'ja_decidido' })
        expect(chamadas.some((c) => c.delegado === 'approval' && c.metodo === 'create')).toBe(false)
    })

    it('defeito de outro app não é decidido aqui', async () => {
        const { conexao } = conexaoFalsa({ 'problem.findFirst': null })
        expect(
            await decidirPortaoDaIssue({
                escopo: escopoDoApp(conexao, 'app-1'),
                problemaId: 'pb-de-outro',
                decisao: 'APROVADO',
                agente: GESTOR,
            })
        ).toEqual({ decidido: false, motivo: 'defeito_de_outro_app' })
    })
})

describe('o que sai para o canal de engenharia é anonimizado', () => {
    it('e-mail e telefone no resumo do N1 não chegam ao Slack', async () => {
        /**
         * Achado da revisão de segurança de 23/11/2026. O resumo é escrito pela
         * IA, não pelo cliente — e é por isso mesmo que precisa passar pelo
         * anonimizador: o modelo lê o chamado, que tem e-mail e telefone, e
         * resume. "A cliente maria@x.com não consegue salvar" é um resumo
         * correto e um dado pessoal num canal que tem o repositório ligado.
         *
         * A prova é sobre o que vai À REDE, com o buscador injetado.
         */
        const { conexao } = conexaoFalsa({
            'slackThread.findFirst': { id: 'th-1', ticketId: 'tkt-1', threadTsEngenharia: null },
        })
        const slack = slackFalso({ ok: true, ts: '200.1', channel: 'C-ENG' })
        const { saidaDeEngenharia } = await import('../engenharia/ao-escalar.ts')

        const sair = saidaDeEngenharia(
            escopoDoApp(conexao, 'app-1'),
            { id: 'app-1', slug: 'odontobox', canalEngenharia: 'C-ENG' },
            { SLACK_BOT_TOKEN: 'xoxb-t', URL_BASE: 'https://desk.venn360.com' },
            slack.config.buscador
        )

        await sair({
            chamadoId: 'tkt-1',
            numero: 'ODB-1042',
            resumo: 'a cliente maria@exemplo.com, fone (11) 98765-4321, não consegue salvar o agendamento',
            ponteiros: 'agenda/recorrencia.ts:88',
        })

        const corpo = slack.chamadas[0]?.corpo as { text: string }
        expect(corpo.text).not.toMatch(/maria@exemplo|98765/)
        expect(corpo.text).toContain('[e-mail]')
        expect(corpo.text).toContain('[telefone]')
        /// E o que importa para quem corrige sobrevive.
        expect(corpo.text).toContain('não consegue salvar o agendamento')
        expect(corpo.text).toContain('agenda/recorrencia.ts:88')
    })
})
