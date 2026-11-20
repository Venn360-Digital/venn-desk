import { describe, expect, it } from 'vitest'

import type { App, PrismaClient } from '#prisma'

import { executarFerramenta, type Contexto } from './executar.ts'
import type { EscopoDoApp } from '../dados/escopo.ts'

/**
 * As ferramentas do MCP, com um escopo falso que registra tudo.
 *
 * Sem banco de propósito: o que estes testes medem é o TEXTO que a ferramenta
 * devolve ao modelo e o que ela grava — e as duas coisas são decididas em
 * `executar.ts`, não no Postgres.
 */

interface Registro {
    aoCliente: string[]
    notas: string[]
    eventos: { evento: string; depois?: unknown }[]
}

interface Opcoes {
    chamado?: Record<string, unknown>
    /** O que `artigos.buscar` devolve. */
    busca?: { artigo: Record<string, unknown>; nota: number }[]
    artigoPorId?: Record<string, unknown> | null
    artigoPorChave?: Record<string, unknown> | null
    derivados?: Record<string, unknown>[]
    tema?: unknown
}

function contextoDeProva(opcoes: Opcoes = {}): Contexto & { registro: Registro } {
    const registro: Registro = { aoCliente: [], notas: [], eventos: [] }
    const agora = new Date('2026-11-20T12:00:00Z')

    const chamado = {
        id: 'chamado-1',
        appId: 'app-a',
        numero: 1,
        assunto: 'Uma dúvida',
        status: 'ABERTO',
        tipo: 'DUVIDA',
        prioridade: 'NORMAL',
        nivel: 'N1',
        requesterId: 'sol-1',
        tenantId: 'ten-1',
        assigneeId: null,
        primeiraRespostaEm: null,
        contexto: null,
        criadoEm: agora,
        atualizadoEm: agora,
        ...opcoes.chamado,
    }

    const escopo = {
        appId: 'app-a',
        chamados: {
            porNumero: async () => chamado,
            porId: async () => chamado,
            mudarStatus: async () => chamado,
            aplicarEvento: async () => chamado,
            classificar: async () => chamado,
            atribuir: async () => chamado,
        },
        mensagens: {
            adicionar: async (dados: { corpo: string; visibilidade?: string }) => {
                if (dados.visibilidade === 'INTERNA') registro.notas.push(dados.corpo)
                else registro.aoCliente.push(dados.corpo)
                return { id: 'msg-1', corpo: dados.corpo }
            },
            todas: async () => [
                { id: 'msg-0', corpo: 'Não consigo achar o cadastro.', visibilidade: 'PUBLICA', autor: 'USUARIO', rascunho: false, criadoEm: agora },
            ],
        },
        solicitantes: { porId: async () => ({ id: 'sol-1', nome: 'Ana' }) },
        empresas: { porId: async () => ({ id: 'ten-1', nome: 'Clínica A' }) },
        sla: { doChamado: async () => [] },
        eventos: {
            registrar: async (dados: { evento: string; depois?: unknown }) => {
                registro.eventos.push(dados)
                return { id: 'ev-1' }
            },
            doChamado: async () => [],
        },
        artigos: {
            buscar: async () => opcoes.busca ?? [],
            porId: async () => opcoes.artigoPorId ?? null,
            porChave: async () => opcoes.artigoPorChave ?? null,
            listar: async () => opcoes.derivados ?? [],
            registrarConsulta: async () => ({ id: 'consulta-1' }),
            marcarLeitura: async () => undefined,
        },
    } as unknown as EscopoDoApp

    return {
        cliente: null as unknown as PrismaClient,
        escopoDoApp: escopo,
        app: { id: 'app-a', slug: 'odontobox', nome: 'Odontobox360', prefixo: 'ODB', tema: opcoes.tema ?? null } as unknown as App,
        escopo: 'SUPORTE',
        registro,
    }
}


describe('a camada B: o que a base viva acrescenta às ferramentas', () => {
    const MENU = {
        secoes: [{ rotulo: 'Vendas (CRM)', itens: [{ rotulo: '{{Servicos}}', href: '/vendas/servicos' }] }],
        segmentos: { vendas: 'Vendas', servicos: '{{Servicos}}' },
    }

    it('obter_chamado diz em que TELA o cliente estava, pelo nome do menu', async () => {
        /// O widget manda "/vendas/servicos", que não diz nada a quem atende.
        const ctx = contextoDeProva({
            chamado: { contexto: { rota: '/vendas/servicos', titulo: 'Procedimentos' } },
            artigoPorChave: { dados: MENU },
            tema: { vocabulario: { Servicos: 'Procedimentos' } },
        })

        const r = await executarFerramenta(ctx, 'obter_chamado', { numero: '1' })
        expect(r.texto).toContain('Tela em que o cliente estava: Vendas → Procedimentos')
    })

    it('sem artigo de menu, o chamado segue com o endereço — e não com um palpite', async () => {
        const ctx = contextoDeProva({ chamado: { contexto: { rota: '/vendas/servicos' } }, artigoPorChave: null })
        const r = await executarFerramenta(ctx, 'obter_chamado', { numero: '1' })

        expect(r.texto).not.toContain('Tela em que o cliente estava')
        expect(r.texto).toContain('/vendas/servicos')
    })

    it('buscar_base e obter_artigo trazem a PROCEDÊNCIA do artigo', async () => {
        const derivado = {
            id: 'art-1',
            titulo: 'Tela: Procedimentos',
            corpo: 'O catálogo de itens que a clínica oferece.',
            tags: ['tela'],
            status: 'PUBLICADO',
            origem: 'DERIVADO',
            fonte: { descricao: 'a tela Procedimentos do produto', commit: 'abc1234def' },
            sincronizadoEm: new Date('2026-11-20T17:00:00Z'),
        }
        const ctx = contextoDeProva({ busca: [{ artigo: derivado, nota: 1 }], artigoPorId: derivado })

        const busca = await executarFerramenta(ctx, 'buscar_base', { texto: 'catálogo' })
        expect(busca.texto).toContain('Fonte: a tela Procedimentos do produto')
        expect(busca.texto).toContain('commit abc1234')

        const leitura = await executarFerramenta(ctx, 'obter_artigo', { id: 'art-1' })
        expect(leitura.texto).toContain('sincronizado em 20/11')
    })

    it('escalar para ENGENHARIA leva o ponteiro do mapa técnico na nota', async () => {
        /**
         * O N1 não lê código, mas tem o mapa — e quem recebe do outro lado
         * começa procurando onde olhar.
         */
        const mapa = {
            id: 'mapa-1',
            chave: 'derivado:mapa:vendas',
            origem: 'DERIVADO',
            dados: {
                telas: [{ rota: '/vendas/servicos', arquivos: ['rotas/vendas/servicos/page.tsx'], apis: ['/api/products'], modelos: ['productService'] }],
            },
        }
        const ctx = contextoDeProva({ chamado: { contexto: { rota: '/vendas/servicos' } }, derivados: [mapa] })

        await executarFerramenta(ctx, 'escalar', { numero: '1', para: 'engenharia', motivo: 'A tela não carrega.' })

        const nota = ctx.registro.notas.join('\n')
        expect(nota).toContain('Por onde começar a olhar')
        expect(nota).toContain('/api/products')
        expect(nota).toContain('productService')
    })

    it('escalar para HUMANO não leva ponteiro de código: quem atende não precisa dele', async () => {
        const ctx = contextoDeProva({ chamado: { contexto: { rota: '/vendas/servicos' } }, derivados: [] })
        await executarFerramenta(ctx, 'escalar', { numero: '1', para: 'humano', motivo: 'Pediu cancelamento.' })

        expect(ctx.registro.notas.join('\n')).not.toContain('Por onde começar')
    })
})
