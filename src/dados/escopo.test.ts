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
