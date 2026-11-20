import { describe, expect, it } from 'vitest'

import { ErroDeDominio } from '../lib/erros.ts'

import { escopoDoApp } from './escopo.ts'
import { conexaoFalsa } from './testes/conexao-falsa.ts'

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

describe('a base viva no escopo', () => {
    const DERIVADO = {
        id: 'art-1',
        appId: 'app-a',
        origem: 'DERIVADO',
        chave: 'derivado:faq:senha',
        titulo: 'Como troco a senha',
        corpo: 'Vá em Conta → Segurança.',
        tags: ['faq'],
        status: 'PUBLICADO',
        fonte: { caminhos: ['apps/odontobox360/src/app/(dashboard)/suporte/page.tsx'], sha: 'abc' },
        statusFixadoPor: null,
    }

    it('recusa editar à mão um artigo DERIVADO, e diz onde mudar', async () => {
        /// A edição duraria até o próximo merge e sumiria sem aviso.
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findFirst': DERIVADO })
        const escopo = escopoDoApp(conexao, 'app-a')

        await expect(escopo.artigos.alterar('art-1', { titulo: 'Outro' })).rejects.toMatchObject({
            codigo: 'artigo_derivado',
            status: 409,
            message: expect.stringContaining('suporte/page.tsx'),
        })
        expect(chamadas.filter((c) => c.metodo === 'updateMany')).toHaveLength(0)
    })

    it('derivado não vai para ARQUIVADO à mão; para RASCUNHO vai, e FIXA o ator', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findFirst': DERIVADO })
        const escopo = escopoDoApp(conexao, 'app-a')

        await expect(escopo.artigos.mudarStatus('art-1', 'ARQUIVADO', { ator: 'agent:1' })).rejects.toMatchObject({
            codigo: 'transicao_invalida',
        })

        await escopo.artigos.mudarStatus('art-1', 'RASCUNHO', { ator: 'agent:1' })
        const escrita = chamadas.find((c) => c.metodo === 'updateMany')
        expect(escrita?.args['data']).toEqual({ status: 'RASCUNHO', statusFixadoPor: 'agent:1' })
        expect((escrita?.args['where'] as Record<string, unknown>)['OR']).toBeDefined()
    })

    it('a sincronização (sem ator) não fixa status', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findFirst': DERIVADO })
        await escopoDoApp(conexao, 'app-a').artigos.mudarStatus('art-1', 'RASCUNHO')
        const escrita = chamadas.find((c) => c.metodo === 'updateMany')
        expect(escrita?.args['data']).toEqual({ status: 'RASCUNHO' })
    })

    it('sincronizarDerivado cria por upsert com o appId DENTRO da chave única', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findFirst': null })
        const escopo = escopoDoApp(conexao, 'app-a')
        const agora = new Date('2026-11-19T12:00:00Z')

        const { efeito } = await escopo.artigos.sincronizarDerivado({
            chave: 'derivado:faq:senha',
            titulo: 'Como troco a senha',
            corpo: 'Vá em Conta → Segurança.',
            tags: ['faq'],
            fonte: { sha: 'abc' },
            dados: { p: 'x' },
            publicarDireto: true,
            agora,
        })

        expect(efeito).toBe('criado')
        const upsert = chamadas.find((c) => c.metodo === 'upsert')
        expect(upsert?.args['where']).toEqual({ appId_chave: { appId: 'app-a', chave: 'derivado:faq:senha' } })
        const create = upsert?.args['create'] as Record<string, unknown>
        expect(create['appId']).toBe('app-a')
        expect(create['origem']).toBe('DERIVADO')
        expect(create['status']).toBe('PUBLICADO')
        /// O `update` NÃO toca status: quem tirou do ar continua mandando.
        expect(upsert?.args['update']).not.toHaveProperty('status')
    })

    it('conteúdo igual é "inalterado" e não escreve nada — mesmo com o JSONB reordenando as chaves da fonte', async () => {
        /// O JSONB devolve `{ sha, caminhos }` quando se gravou `{ caminhos, sha }`.
        /// Em 20/11 isso marcou 36 artigos iguais como "atualizados" e os
        /// re-embutiu de graça.
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findFirst': { ...DERIVADO, fonte: { sha: 'abc', caminhos: DERIVADO.fonte.caminhos } } })
        const { efeito } = await escopoDoApp(conexao, 'app-a').artigos.sincronizarDerivado({
            chave: DERIVADO.chave,
            titulo: DERIVADO.titulo,
            corpo: DERIVADO.corpo,
            tags: DERIVADO.tags,
            fonte: DERIVADO.fonte,
            dados: {},
            publicarDireto: true,
            agora: new Date(),
        })
        expect(efeito).toBe('inalterado')
        expect(chamadas.filter((c) => c.metodo !== 'findFirst')).toHaveLength(0)
    })

    it('arquivado pela sincronização cuja fonte voltou REABRE; fixado por pessoa, não', async () => {
        const arquivado = { ...DERIVADO, status: 'ARQUIVADO' }
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findFirst': arquivado })
        const mesmo = {
            chave: DERIVADO.chave, titulo: DERIVADO.titulo, corpo: DERIVADO.corpo, tags: DERIVADO.tags,
            fonte: DERIVADO.fonte, dados: {}, publicarDireto: true, agora: new Date(),
        }
        const { efeito } = await escopoDoApp(conexao, 'app-a').artigos.sincronizarDerivado(mesmo)
        expect(efeito).toBe('reaberto')
        expect(chamadas.find((c) => c.metodo === 'updateMany')?.args['data']).toMatchObject({ status: 'PUBLICADO' })

        const fixado = { ...arquivado, statusFixadoPor: 'agent:1' }
        const outra = conexaoFalsa({ 'kbArticle.findFirst': fixado })
        const r = await escopoDoApp(outra.conexao, 'app-a').artigos.sincronizarDerivado(mesmo)
        expect(r.efeito).toBe('inalterado')
    })

    it('arquivarDerivadosFora só alcança DERIVADOS deste app e fora das chaves vivas', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findMany': [DERIVADO] })
        const arquivados = await escopoDoApp(conexao, 'app-a').artigos.arquivarDerivadosFora('derivado:faq:', ['derivado:faq:outra'])

        expect(arquivados).toHaveLength(1)
        const leitura = chamadas.find((c) => c.metodo === 'findMany')?.args['where'] as Record<string, unknown>
        expect(leitura['appId']).toBe('app-a')
        expect(leitura['origem']).toBe('DERIVADO')
        expect(leitura['chave']).toEqual({ startsWith: 'derivado:faq:', notIn: ['derivado:faq:outra'] })
        const escrita = chamadas.find((c) => c.metodo === 'updateMany')?.args['where'] as Record<string, unknown>
        expect(escrita['appId']).toBe('app-a')
    })

    it('o SQL do vetor carrega o appId como parâmetro, na escrita e na leitura', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')
        await escopo.artigos.gravarEmbedding('art-1', [0.1, 0.2])
        await escopo.artigos.buscarPorVetor([0.1, 0.2], 5)

        const [escrita, leitura] = chamadas.filter((c) => c.delegado === 'sql')
        expect(escrita?.metodo).toBe('executeRaw')
        expect(escrita?.args['valores']).toContain('app-a')
        expect(escrita?.args['sql']).toContain('app_id')
        expect(leitura?.metodo).toBe('queryRaw')
        expect(leitura?.args['valores']).toContain('app-a')
        expect(leitura?.args['sql']).toContain("status = 'PUBLICADO'")
        /// O vetor vai como parâmetro, nunca concatenado no SQL.
        expect(leitura?.args['sql']).not.toContain('0.1')
    })

    it('buscar sem vetor é a busca por palavra de sempre; com vetor, funde', async () => {
        const publicados = [
            { ...DERIVADO, id: 'a', titulo: 'Exportar contatos', corpo: 'Como exportar a lista de contatos.', tags: [] },
            { ...DERIVADO, id: 'b', titulo: 'Agenda do profissional', corpo: 'Horários da agenda.', tags: [] },
        ]
        const { conexao } = conexaoFalsa({
            'kbArticle.findMany': publicados,
            'sql.queryRaw': [{ id: 'b', distancia: 0.1 }, { id: 'a', distancia: 0.2 }],
        })
        const escopo = escopoDoApp(conexao, 'app-a')

        const soPalavra = await escopo.artigos.buscar('exportar contatos', 5)
        expect(soPalavra.map((r) => r.artigo.id)).toEqual(['a'])

        const hibrida = await escopo.artigos.buscar('exportar contatos', 5, { vetor: [0.1] })
        /// "a" aparece nas duas listas; "b" só na do vetor. As duas entram,
        /// e "a" primeiro.
        expect(hibrida.map((r) => r.artigo.id)).toEqual(['a', 'b'])
    })

    it('sincronizações e eventos da base sempre levam o appId', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const escopo = escopoDoApp(conexao, 'app-a')
        const agora = new Date()

        await escopo.sincronizacoes.registrarPedido({ repositorio: 'o/r', commitSha: 'x', pedidaPor: 'cron', forcada: false })
        await escopo.sincronizacoes.iniciar('s1', agora)
        await escopo.sincronizacoes.concluir('s1', { criados: 1 }, agora)
        await escopo.sincronizacoes.ultimaConcluida()
        await escopo.eventosDaBase.registrar({ artigoId: 'art-1', ator: 'sistema:sincronizacao', evento: 'artigo:derivado-criado' })
        await escopo.eventosDaBase.doArtigo('art-1')

        for (const chamada of chamadas) {
            const onde = (chamada.args['where'] ?? chamada.args['data']) as Record<string, unknown>
            expect(onde['appId'], `${chamada.delegado}.${chamada.metodo}`).toBe('app-a')
        }
    })
})
