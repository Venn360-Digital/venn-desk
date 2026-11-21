import { describe, expect, it } from 'vitest'

import { escopoDoApp } from '../dados/escopo.ts'
import type { ChamadoParaSugerir } from '../dados/escopo.ts'
import { conexaoFalsa } from '../dados/testes/conexao-falsa.ts'
import type { Extrator, PedidoDeExtracao } from './extrair/com-modelo.ts'
import { elegivel, fontesDesatualizadas, sugerirDeChamado, sugerirDeLacuna } from './sugerir.ts'

const AGORA = new Date('2026-11-20T12:00:00Z')
const DEZ_DIAS_ATRAS = new Date('2026-11-10T12:00:00Z')

function chamado(ajustes: Partial<ChamadoParaSugerir> = {}): ChamadoParaSugerir {
    return {
        id: 'tkt-1',
        numero: 1042,
        assunto: 'o horário sumiu da agenda',
        tipo: 'DUVIDA',
        status: 'RESOLVIDO',
        resolvidoEm: DEZ_DIAS_ATRAS,
        tenant: { nome: 'Clínica São Jorge' },
        requester: { nome: 'Maria Antônia de Souza' },
        csat: { nota: 5 },
        mensagens: [
            {
                autor: 'USUARIO',
                corpo: 'Sou a Maria Antônia da Clínica São Jorge, meu email é maria.souza@gmail.com e meu fone (11) 98765-4321. O horário que marquei ontem não aparece mais na agenda.',
                visibilidade: 'PUBLICA',
                rascunho: false,
                criadoEm: DEZ_DIAS_ATRAS,
            },
            {
                autor: 'HUMANO',
                corpo: 'O horário estava com o profissional inativo. Reative o profissional em Gerenciamento e o horário volta a aparecer.',
                visibilidade: 'PUBLICA',
                rascunho: false,
                criadoEm: DEZ_DIAS_ATRAS,
            },
        ],
        ...ajustes,
    }
}

function extratorQueDevolve(dados: unknown): { ext: Extrator; pedidos: PedidoDeExtracao<unknown>[] } {
    const pedidos: PedidoDeExtracao<unknown>[] = []
    return {
        pedidos,
        ext: {
            async extrair(pedido) {
                pedidos.push(pedido as PedidoDeExtracao<unknown>)
                return { dados: dados as never, consumo: { passos: 1, tokensDeEntrada: 900, tokensDeSaida: 200 } }
            },
        },
    }
}

const CASO_BOM = {
    titulo: 'Horário não aparece na agenda',
    sintoma: 'Um horário já marcado deixa de aparecer na agenda.',
    causa: 'O profissional do horário foi inativado, e a agenda só mostra horários de profissionais ativos.',
    comoResolver: ['Abra Gerenciamento e localize o profissional', 'Reative o profissional', 'Volte à agenda'],
    tags: ['agenda'],
}

describe('elegivel', () => {
    it('aceita encerrado, com pergunta do cliente, resposta de humano e nota alta', () => {
        expect(elegivel(chamado(), AGORA)).toEqual({ ok: true })
    })

    it('recusa o que a IA resolveu sozinha', () => {
        /**
         * A recusa mais importante da biblioteca. A IA respondeu com o que
         * estava na base; virar artigo seria copiar a base de volta para dentro
         * dela, com o erro que ela tivesse. O que vale aprender é o que um
         * humano soube e a base não.
         */
        const so = chamado({
            mensagens: [
                { autor: 'USUARIO', corpo: 'como faço?', visibilidade: 'PUBLICA', rascunho: false, criadoEm: DEZ_DIAS_ATRAS },
                { autor: 'IA', corpo: 'faça assim', visibilidade: 'PUBLICA', rascunho: false, criadoEm: DEZ_DIAS_ATRAS },
            ],
        })
        expect(elegivel(so, AGORA)).toEqual({ ok: false, motivo: 'sem-resposta-de-humano' })
    })

    it('recusa rascunho do modo sombra como resposta de humano', () => {
        /// Rascunho é texto da IA esperando aprovação: não é alguém tendo sabido.
        const comRascunho = chamado({
            mensagens: [
                { autor: 'USUARIO', corpo: 'como faço?', visibilidade: 'PUBLICA', rascunho: false, criadoEm: DEZ_DIAS_ATRAS },
                { autor: 'HUMANO', corpo: 'faça assim', visibilidade: 'PUBLICA', rascunho: true, criadoEm: DEZ_DIAS_ATRAS },
            ],
        })
        expect(elegivel(comRascunho, AGORA).ok).toBe(false)
    })

    it('nota baixa recusa, e sem nota espera o prazo de reabertura', () => {
        expect(elegivel(chamado({ csat: { nota: 3 } }), AGORA)).toEqual({ ok: false, motivo: 'nota-baixa' })
        expect(elegivel(chamado({ csat: null }), AGORA)).toEqual({ ok: true })
        expect(elegivel(chamado({ csat: null, resolvidoEm: new Date('2026-11-18T12:00:00Z') }), AGORA)).toEqual({
            ok: false,
            motivo: 'recente-e-sem-nota',
        })
    })

    it('recusa chamado ainda aberto', () => {
        expect(elegivel(chamado({ status: 'ABERTO', resolvidoEm: null }), AGORA)).toEqual({ ok: false, motivo: 'nao-encerrado' })
    })
})

describe('sugerirDeChamado', () => {
    it('o que chega ao modelo já está anonimizado', () => {
        /**
         * A guarda que importa mais, porque é a única que também protege o log
         * do provedor: o que não entra no prompt não volta na resposta e não
         * fica guardado fora daqui.
         */
        const { conexao } = conexaoFalsa()
        const { ext, pedidos } = extratorQueDevolve(CASO_BOM)

        return sugerirDeChamado({ escopo: escopoDoApp(conexao, 'app-1'), chamado: chamado(), extrator: ext, agora: AGORA }).then(() => {
            const enviado = pedidos[0]?.arquivos[0]?.conteudo ?? ''
            expect(enviado).not.toMatch(/maria\.souza|98765|Maria|Antônia|São Jorge/i)
            expect(enviado).toContain('[e-mail]')
            expect(enviado).toContain('[telefone]')
            expect(enviado).toContain('[nome]')
            /// E o problema sobrevive: é dele que sai o artigo.
            expect(enviado).toContain('não aparece mais na agenda')
            expect(enviado).toContain('[CLIENTE]')
            expect(enviado).toContain('[ATENDENTE]')
        })
    })

    it('cria RASCUNHO SUGERIDO com chave do chamado, tag de caso e evento', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.create': { id: 'art-9' } })
        const { ext } = extratorQueDevolve(CASO_BOM)

        const r = await sugerirDeChamado({
            escopo: escopoDoApp(conexao, 'app-1'),
            chamado: chamado(),
            extrator: ext,
            agora: AGORA,
        })

        expect(r).toMatchObject({ criou: true, recusa: null, chave: 'sugerido:chamado:tkt-1' })
        const criado = chamadas.find((c) => c.delegado === 'kbArticle' && c.metodo === 'create')
        expect(criado?.args.data).toMatchObject({
            appId: 'app-1',
            origem: 'SUGERIDO',
            status: 'RASCUNHO',
            chave: 'sugerido:chamado:tkt-1',
            tags: ['caso', 'agenda'],
        })
        expect(String((criado?.args.data as { corpo: string }).corpo)).toContain('1. Abra Gerenciamento')
        expect(chamadas.some((c) => c.delegado === 'kbEvento' && c.metodo === 'create')).toBe(true)
    })

    it('o segundo encontro do mesmo chamado não cria outro rascunho', async () => {
        /// O gancho do CSAT e a varredura diária chegam ao mesmo chamado.
        const { conexao, chamadas } = conexaoFalsa({
            'kbArticle.findFirst': { id: 'art-9', chave: 'sugerido:chamado:tkt-1', status: 'PUBLICADO' },
        })
        const { ext } = extratorQueDevolve(CASO_BOM)

        const r = await sugerirDeChamado({
            escopo: escopoDoApp(conexao, 'app-1'),
            chamado: chamado(),
            extrator: ext,
            agora: AGORA,
        })

        expect(r.criou).toBe(false)
        expect(chamadas.some((c) => c.delegado === 'kbArticle' && c.metodo === 'create')).toBe(false)
        /// E o status de quem já foi publicado não é tocado.
        const toque = chamadas.find((c) => c.delegado === 'kbArticle' && c.metodo === 'updateMany')
        expect(Object.keys(toque?.args.data as object)).toEqual(['fonte', 'sincronizadoEm'])
    })

    it('recusa quando a saída do modelo traz dado pessoal, e não corrige', async () => {
        const { conexao, chamadas } = conexaoFalsa()
        const { ext } = extratorQueDevolve({
            ...CASO_BOM,
            causa: 'A paciente joana@exemplo.com.br tinha o profissional inativo.',
        })

        const r = await sugerirDeChamado({
            escopo: escopoDoApp(conexao, 'app-1'),
            chamado: chamado(),
            extrator: ext,
            agora: AGORA,
        })

        expect(r.recusa).toBe('dado-pessoal-na-saida')
        expect(r.achados.map((a) => a.tipo)).toEqual(['e-mail'])
        expect(chamadas.some((c) => c.delegado === 'kbArticle' && c.metodo === 'create')).toBe(false)
        const evento = chamadas.find((c) => c.delegado === 'kbEvento' && c.metodo === 'create')
        expect(evento?.args.data).toMatchObject({ evento: 'sugerido:recusado' })
        /// A trilha registra o tipo, nunca o dado.
        expect(JSON.stringify(evento?.args.data)).not.toContain('joana')
    })

    it('recusa detalhe interno, que é o risco de ler nota interna', async () => {
        /**
         * As notas internas entram no prompt de propósito — é nelas que o
         * atendente registra a causa confirmada. O preço é este: é também onde
         * ele escreve o nome da classe.
         */
        const { conexao, chamadas } = conexaoFalsa()
        const { ext } = extratorQueDevolve({
            ...CASO_BOM,
            causa: 'O productService não devolvia a duração quando o profissional estava inativo.',
        })

        const r = await sugerirDeChamado({
            escopo: escopoDoApp(conexao, 'app-1'),
            chamado: chamado(),
            extrator: ext,
            agora: AGORA,
        })

        expect(r.recusa).toBe('detalhe-interno-na-saida')
        expect(chamadas.some((c) => c.delegado === 'kbArticle' && c.metodo === 'create')).toBe(false)
    })

    it('inelegível não chega ao modelo', async () => {
        const { conexao } = conexaoFalsa()
        const { ext, pedidos } = extratorQueDevolve(CASO_BOM)

        const r = await sugerirDeChamado({
            escopo: escopoDoApp(conexao, 'app-1'),
            chamado: chamado({ status: 'ABERTO', resolvidoEm: null }),
            extrator: ext,
            agora: AGORA,
        })

        expect(r.recusa).toBe('nao-encerrado')
        expect(pedidos).toHaveLength(0)
    })
})

describe('sugerirDeLacuna', () => {
    const artigos = [
        {
            id: 'a1',
            chave: 'derivado:tela:/gerenciamento/profissionais',
            titulo: 'Profissionais',
            corpo: 'Um profissional inativo não aparece na agenda.',
            sincronizadoEm: new Date('2026-11-19T10:00:00Z'),
        },
    ]

    it('sem artigo nenhum na base, não chama o modelo', async () => {
        const { conexao } = conexaoFalsa({ 'kbArticle.findMany': [] })
        const { ext, pedidos } = extratorQueDevolve({})

        const r = await sugerirDeLacuna({
            escopo: escopoDoApp(conexao, 'app-1'),
            exemplo: 'como exportar a lista de pacientes',
            vezes: 4,
            extrator: ext,
            agora: AGORA,
        })

        expect(r.recusa).toBe('sem-fonte-na-base')
        expect(pedidos).toHaveLength(0)
    })

    it('registra na fonte os artigos em que a resposta se apoia', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'kbArticle.findMany': artigos.map((a) => ({ ...a, status: 'PUBLICADO', tags: [] })),
            'kbArticle.create': { id: 'art-10' },
        })
        const { ext } = extratorQueDevolve({
            titulo: 'Por que um horário não aparece na agenda',
            resposta: 'A agenda só mostra horários de profissionais ativos. Reative o profissional em Gerenciamento.',
            artigosUsados: ['derivado:tela:/gerenciamento/profissionais'],
        })

        const r = await sugerirDeLacuna({
            escopo: escopoDoApp(conexao, 'app-1'),
            /// Precisa casar metade dos termos: é o LIMIAR da busca por
            /// palavra, o mesmo que o agente enfrenta.
            exemplo: 'profissional inativo na agenda',
            vezes: 4,
            extrator: ext,
            agora: AGORA,
        })

        expect(r.criou).toBe(true)
        const criado = chamadas.find((c) => c.delegado === 'kbArticle' && c.metodo === 'create')
        expect(criado?.args.data).toMatchObject({ origem: 'SUGERIDO', status: 'RASCUNHO', tags: ['caso', 'lacuna'] })
        expect((criado?.args.data as { fonte: { tipo: string; vezes: number; artigos: unknown[] } }).fonte).toMatchObject({
            tipo: 'lacuna',
            vezes: 4,
        })
    })
})

describe('fontesDesatualizadas', () => {
    it('acusa o derivado ressincronizado depois da aprovação', () => {
        /**
         * Um rascunho aprovado há duas semanas citava a tela como ela era. Se a
         * tela mudou, o artigo aprovado pode estar errado e ninguém notaria.
         */
        const fonte = {
            artigos: [
                { chave: 'derivado:tela:/agenda', sincronizadoEm: '2026-11-10T10:00:00.000Z' },
                { chave: 'derivado:faq:horario', sincronizadoEm: '2026-11-10T10:00:00.000Z' },
            ],
        }
        const atuais = [
            { chave: 'derivado:tela:/agenda', sincronizadoEm: new Date('2026-11-19T10:00:00.000Z') },
            { chave: 'derivado:faq:horario', sincronizadoEm: new Date('2026-11-10T10:00:00.000Z') },
        ]

        expect(fontesDesatualizadas(fonte, atuais)).toEqual(['derivado:tela:/agenda'])
    })

    it('fonte de chamado não tem artigo citado, e não acusa nada', () => {
        expect(fontesDesatualizadas({ tipo: 'chamado', ticketId: 'tkt-1' }, [])).toEqual([])
    })
})
