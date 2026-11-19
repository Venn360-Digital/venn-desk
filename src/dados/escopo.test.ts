import { describe, expect, it } from 'vitest'

import { ErroDeDominio } from '../lib/erros.ts'

import { escopoDoApp, type Conexao } from './escopo.ts'

/**
 * A conexão falsa existe para provar o ISOLAMENTO sem banco — o Miniflare não
 * roda nesta máquina e um Postgres local não existe aqui.
 *
 * Ela registra todo argumento que a camada de escopo passa ao Prisma, e **lança
 * em `findUnique` e em `update`**. Essas duas são exatamente as formas que não
 * conseguem carregar o `appId` ao lado do `id`: se alguém as usar no escopo um
 * dia, a prova quebra aqui, e não em produção com dado de outro cliente na tela.
 */

interface Chamada {
    delegado: string
    metodo: string
    args: Record<string, unknown>
}

function conexaoFalsa(respostas: Record<string, unknown> = {}) {
    const chamadas: Chamada[] = []

    const delegado = (nome: string) =>
        new Proxy(
            {},
            {
                get(_alvo, metodo: string) {
                    if (metodo === 'findUnique' || metodo === 'update') {
                        return () => {
                            throw new Error(
                                `${nome}.${metodo} não pode ser usado no escopo: não aceita appId ao lado do id`
                            )
                        }
                    }

                    return (args: Record<string, unknown>) => {
                        chamadas.push({ delegado: nome, metodo, args })
                        const resposta = respostas[`${nome}.${metodo}`]
                        if (metodo === 'findMany') return Promise.resolve(resposta ?? [])
                        if (metodo === 'updateMany') return Promise.resolve(resposta ?? { count: 1 })
                        if (metodo === 'create' || metodo === 'upsert') {
                            return Promise.resolve(resposta ?? { id: `${nome}-novo` })
                        }
                        return Promise.resolve(resposta ?? null)
                    }
                },
            }
        )

    const conexao = {
        ticket: delegado('ticket'),
        ticketMessage: delegado('ticketMessage'),
        ticketEvent: delegado('ticketEvent'),
        attachment: delegado('attachment'),
        tenant: delegado('tenant'),
        requester: delegado('requester'),
        slaTimer: delegado('slaTimer'),
        slaPolicy: delegado('slaPolicy'),
        kbArticle: delegado('kbArticle'),
        csatResponse: delegado('csatResponse'),
    } as unknown as Conexao

    return { conexao, chamadas }
}

const CHAMADO_A = {
    id: 'chamado-1',
    appId: 'app-a',
    numero: 1042,
    status: 'ABERTO',
    tipo: 'DUVIDA',
    prioridade: 'NORMAL',
    nivel: 'N1',
    assigneeId: null,
    primeiraRespostaEm: null,
}

describe('escopo por app', () => {
    it('injeta appId em toda leitura por id ou número', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.chamados.porId('chamado-1')
        await escopo.chamados.porNumero(1042)

        for (const chamada of chamadas) {
            expect(chamada.metodo).toBe('findFirst')
            expect(chamada.args['where']).toMatchObject({ appId: 'app-a' })
        }
    })

    it('injeta appId na listagem e limita o tamanho da página', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.chamados.listar({ requesterId: 'sol-1', limite: 5000 })

        const [chamada] = chamadas
        expect(chamada?.args['where']).toMatchObject({ appId: 'app-a', requesterId: 'sol-1' })
        expect(chamada?.args['take']).toBe(200)
    })

    it('a lista do widget só traz mensagem pública e sem rascunho', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.mensagens.publicas('chamado-1')

        expect(chamadas[0]?.args['where']).toMatchObject({
            appId: 'app-a',
            ticketId: 'chamado-1',
            visibilidade: 'PUBLICA',
            rascunho: false,
        })
    })

    /**
     * O caso que o critério de aceite da Fase 1 cobra: um id de chamado de outro
     * app não escreve nada. A conexão falsa devolve `null` na conferência, e a
     * camada para antes de criar a mensagem.
     */
    it('recusa escrever mensagem em chamado que não é do app', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'ticket.findFirst': null })
        const escopo = escopoDoApp(conexao, 'app-a')

        await expect(
            escopo.mensagens.adicionar(
                { ticketId: 'chamado-de-outro-app', autor: 'USUARIO', corpo: 'oi' },
                { ator: 'requester:sol-1' }
            )
        ).rejects.toThrowError(ErroDeDominio)

        expect(chamadas.filter((c) => c.metodo === 'create')).toHaveLength(0)
    })

    it('aplica o evento de estado e grava a trilha na mesma passagem', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'ticket.findFirst': CHAMADO_A })
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.chamados.aplicarEvento('chamado-1', 'responder_usuario', {
            ator: 'ia:responder_usuario',
        })

        const update = chamadas.find((c) => c.metodo === 'updateMany')
        expect(update?.args['where']).toMatchObject({ appId: 'app-a', status: 'ABERTO' })
        expect(update?.args['data']).toMatchObject({ status: 'AGUARDANDO_USUARIO' })

        const evento = chamadas.find((c) => c.delegado === 'ticketEvent')
        expect(evento?.args['data']).toMatchObject({
            appId: 'app-a',
            ator: 'ia:responder_usuario',
            evento: 'status:responder_usuario',
        })
    })

    it('transição inválida não escreve nada', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'ticket.findFirst': { ...CHAMADO_A, status: 'FECHADO' },
        })
        const escopo = escopoDoApp(conexao, 'app-a')

        await expect(
            escopo.chamados.aplicarEvento('chamado-1', 'resolver', { ator: 'agent:1' })
        ).rejects.toThrowError(ErroDeDominio)

        expect(chamadas.filter((c) => c.metodo !== 'findFirst')).toHaveLength(0)
    })

    it('alteração sem campo nenhum não toca o banco', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'ticket.findFirst': CHAMADO_A })
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.chamados.alterar('chamado-1', {}, { ator: 'agent:1' })

        expect(chamadas.filter((c) => c.metodo !== 'findFirst')).toHaveLength(0)
    })

    it('o upsert do solicitante carrega o appId na chave composta', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'tenant.upsert': { id: 'tenant-1' },
            'requester.upsert': { id: 'sol-1' },
        })
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.solicitantes.garantir({
            tenantExternalId: 'clinica-123',
            tenantNome: 'Clínica Exemplo',
            requesterExternalId: 'usuario-456',
            nome: 'Ana',
            email: 'ana@exemplo.com',
            papelNoTenant: 'member',
        })

        for (const chamada of chamadas) {
            expect(chamada.metodo).toBe('upsert')
            expect(chamada.args['where']).toMatchObject({
                appId_externalId: { appId: 'app-a' },
            })
        }
    })
})

describe('os relógios de SLA, pelo escopo', () => {
    it('toda consulta de relógio carrega o appId', () => {
        /// A mesma regra do resto do escopo, agora na família nova.
        const { conexao, chamadas } = conexaoFalsa({
            'ticket.findFirst': CHAMADO_A,
            'slaTimer.findMany': [],
        })

        return escopoDoApp(conexao, 'app-a')
            .chamados.aplicarEvento('chamado-1', 'responder_usuario', { ator: 'agent:1' })
            .then(() => {
                const doSla = chamadas.filter((c) => c.delegado === 'slaTimer')
                expect(doSla.length).toBeGreaterThan(0)
                for (const chamada of doSla) {
                    expect((chamada.args['where'] as Record<string, unknown>)['appId']).toBe('app-a')
                }
            })
    })

    it('a mudança de status pausa o relógio que estava correndo', async () => {
        /**
         * `responder_usuario` leva a `AGUARDANDO_USUARIO`, que pausa (seção 6).
         * A prova é que a escrita sai com `pausadoEm`, e não com um vencimento
         * novo: empurrar o prazo na pausa dobraria o tempo.
         */
        const { conexao, chamadas } = conexaoFalsa({
            'ticket.findFirst': CHAMADO_A,
            'slaTimer.findMany': [
                {
                    id: 'relogio-1',
                    meta: 'primeira_resposta',
                    metaMin: 60,
                    venceEm: new Date(Date.now() + 60 * 60_000),
                    pausadoEm: null,
                    violadoEm: null,
                    cumpridoEm: null,
                },
            ],
        })

        await escopoDoApp(conexao, 'app-a').chamados.aplicarEvento(
            'chamado-1',
            'responder_usuario',
            { ator: 'agent:1' }
        )

        const pausa = chamadas.find(
            (c) => c.delegado === 'slaTimer' && c.metodo === 'updateMany'
        )
        const dados = pausa?.args['data'] as Record<string, unknown>

        expect(dados['pausadoEm']).toBeInstanceOf(Date)
        expect(dados).not.toHaveProperty('venceEm')
    })

    it('resposta pública de quem atende cumpre a primeira resposta', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'ticket.findFirst': CHAMADO_A })

        await escopoDoApp(conexao, 'app-a').mensagens.adicionar(
            { ticketId: 'chamado-1', autor: 'HUMANO', corpo: 'oi' },
            { ator: 'agent:1' }
        )

        const cumpriu = chamadas.find(
            (c) =>
                c.delegado === 'slaTimer' &&
                c.metodo === 'updateMany' &&
                (c.args['where'] as Record<string, unknown>)['meta'] === 'primeira_resposta'
        )

        expect(cumpriu).toBeDefined()
        /// Idempotente: só cumpre o que ainda não foi cumprido.
        expect((cumpriu?.args['where'] as Record<string, unknown>)['cumpridoEm']).toBe(null)
    })

    it('nota interna e rascunho da IA NÃO cumprem a primeira resposta', async () => {
        /**
         * O prazo mede se alguém respondeu a QUEM ABRIU. Nota interna é
         * conversa entre nós, e rascunho em modo sombra ainda não saiu.
         */
        for (const dados of [
            { autor: 'HUMANO' as const, corpo: 'x', visibilidade: 'INTERNA' as const },
            { autor: 'IA' as const, corpo: 'x', rascunho: true },
            { autor: 'USUARIO' as const, corpo: 'x' },
        ]) {
            const { conexao, chamadas } = conexaoFalsa({ 'ticket.findFirst': CHAMADO_A })

            await escopoDoApp(conexao, 'app-a').mensagens.adicionar(
                { ticketId: 'chamado-1', ...dados },
                { ator: 'quem-seja' }
            )

            expect(chamadas.some((c) => c.delegado === 'slaTimer')).toBe(false)
        }
    })
})

/**
 * A base de conhecimento é a ÚNICA família onde a linha pode não ter app, e
 * esses testes são o que sustenta essa exceção.
 *
 * O risco de um `OR` com `appId: null` não é teórico: escrito errado uma vez,
 * ele vira `{}` e devolve a base inteira dos três produtos. Então a prova não é
 * "o global aparece" — é que o artigo do vizinho NÃO aparece, em cada consulta
 * da família.
 */
describe('artigos: deste app ou global, nunca do vizinho', () => {
    const SO_DESTE_APP_OU_GLOBAL = { OR: [{ appId: 'app-a' }, { appId: null }] }

    it('toda leitura carrega a cláusula, e ela nunca alcança outro app', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.artigos.listar()
        await escopo.artigos.porId('artigo-1')
        await escopo.artigos.buscar('senha', 5)

        expect(chamadas).toHaveLength(3)
        for (const chamada of chamadas) {
            expect(chamada.args['where']).toMatchObject(SO_DESTE_APP_OU_GLOBAL)

            /// A cláusula tem de ser EXATAMENTE as duas alternativas. Uma
            /// terceira — ou um `OR` vazio — devolveria a base dos três.
            const onde = chamada.args['where'] as { OR: unknown[] }
            expect(onde.OR).toHaveLength(2)
        }
    })

    it('a busca lê só publicado — rascunho não vira resposta da IA', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.artigos.buscar('senha', 5)

        expect(chamadas[0]?.args['where']).toMatchObject({ status: 'PUBLICADO' })
    })

    it('criar sem global grava NESTE app; com global grava nulo', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.artigos.criar({ titulo: 'Trocar senha', corpo: 'x', tags: [], global: false })
        await escopo.artigos.criar({ titulo: 'Trocar senha', corpo: 'x', tags: [], global: true })

        expect(chamadas[0]?.args['data']).toMatchObject({ appId: 'app-a' })
        expect(chamadas[1]?.args['data']).toMatchObject({ appId: null })
    })

    it('alterar não alcança o artigo do vizinho', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.updateMany': { count: 0 } })
        const escopo = escopoDoApp(conexao, 'app-a')

        const resultado = await escopo.artigos.alterar('artigo-de-outro-app', { titulo: 'Novo' })

        /// Zero linhas alteradas significa "não existe" OU "é de outro app", e a
        /// resposta é a mesma nos dois casos — dizer qual confirmaria a
        /// existência de conteúdo que este app não deveria saber que existe.
        expect(resultado).toBeNull()
        expect(chamadas[0]?.args['where']).toMatchObject(SO_DESTE_APP_OU_GLOBAL)
    })

    it('recusa republicar um arquivado direto', async () => {
        const { conexao } = conexaoFalsa({
            'kbArticle.findFirst': { id: 'a', status: 'ARQUIVADO' },
        })
        const escopo = escopoDoApp(conexao, 'app-a')

        await expect(escopo.artigos.mudarStatus('a', 'PUBLICADO')).rejects.toBeInstanceOf(
            ErroDeDominio
        )
    })

    it('mudar para o mesmo status não escreve nada', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'kbArticle.findFirst': { id: 'a', status: 'PUBLICADO' },
        })
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.artigos.mudarStatus('a', 'PUBLICADO')

        expect(chamadas.filter((c) => c.metodo === 'updateMany')).toHaveLength(0)
    })
})

describe('csat: a nota é do app, e a dedução não vem do cliente', () => {
    it('ler e resumir filtram por app', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.csat.doChamado('chamado-1')
        await escopo.csat.todas()

        for (const chamada of chamadas) {
            expect(chamada.args['where']).toMatchObject({ appId: 'app-a' })
        }
    })

    it('a linha nova nasce carimbada com o app', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')

        await escopo.csat.registrar({
            ticketId: 'chamado-1',
            nota: 5,
            atendidoPelaIa: true,
        })

        /**
         * O `where` do upsert é só `ticketId` — a chave única do banco não tem
         * `appId`, e não há como pô-lo ali. O isolamento vem de quem chama: a
         * rota só alcança o chamado pelo escopo. O que SE pode garantir aqui é
         * que a linha nova nasça com o app certo, e é o que isto prova.
         */
        expect(chamadas[0]?.args['create']).toMatchObject({ appId: 'app-a' })
    })
})
