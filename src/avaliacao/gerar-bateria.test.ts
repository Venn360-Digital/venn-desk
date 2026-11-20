import { describe, expect, it } from 'vitest'

import type { Extrator } from '../conhecimento/extrair/com-modelo.ts'
import { fonteDaCategoria, gerarCasosDeArtigo, tecnicosDoApp } from './gerar-bateria.ts'
import { DISTRIBUICAO, TOTAL_POR_APP } from './bateria.ts'

const ARTIGO = {
    chave: 'derivado:tela:marketing-remetentes',
    titulo: 'Tela: Remetentes (Marketing → Domínios)',
    corpo: [
        'Cadastrar e verificar os domínios de e-mail.',
        'Onde fica: Marketing → Domínios',
        '## Avisos que o sistema dá',
        '- quando a verificação ainda não encontra: "Os registros ainda não foram encontrados."',
    ].join('\n'),
}

const extratorFalso = (casos: unknown): Extrator => ({
    async extrair(pedido) {
        return { dados: pedido.esquema.parse(casos), consumo: { passos: 1, tokensDeEntrada: 900, tokensDeSaida: 300 } }
    },
})

describe('gerarCasosDeArtigo', () => {
    it('monta o caso com desfecho "respondeu" e o artigo esperado', async () => {
        const r = await gerarCasosDeArtigo({
            artigo: ARTIGO,
            app: 'odontobox',
            categoria: 'uso',
            quantas: 1,
            extrator: extratorFalso({
                casos: [{ assunto: 'nao valida', mensagem: 'publiquei e nao valida, o que faço?', precisaDizer: [['Domínios', 'Marketing'], ['registros']] }],
            }),
        })

        expect(r).toHaveLength(1)
        expect(r[0]).toMatchObject({
            app: 'odontobox',
            categoria: 'uso',
            gabarito: { desfecho: 'respondeu', artigoEsperado: ARTIGO.chave },
        })
        expect(r[0]?.gabarito.precisaDizer).toEqual([['Domínios', 'Marketing'], ['registros']])
    })

    it('DESCARTA o grupo cujo termo nenhum está no artigo', async () => {
        /**
         * Se o gabarito exigir o que a base não diz, a bateria reprova um
         * agente certo — e o número passa a medir a imaginação do gerador.
         */
        const r = await gerarCasosDeArtigo({
            artigo: ARTIGO,
            app: 'odontobox',
            categoria: 'uso',
            quantas: 1,
            extrator: extratorFalso({
                casos: [{ assunto: 'x', mensagem: 'uma pergunta qualquer sobre o domínio', precisaDizer: [['Domínios'], ['propagação em 48h', 'cache do provedor']] }],
            }),
        })

        expect(r[0]?.gabarito.precisaDizer).toEqual([['Domínios']])
    })

    it('mantém só as alternativas que existem, dentro do grupo', async () => {
        const r = await gerarCasosDeArtigo({
            artigo: ARTIGO,
            app: 'odontobox',
            categoria: 'uso',
            quantas: 1,
            extrator: extratorFalso({
                casos: [{ assunto: 'x', mensagem: 'outra pergunta sobre o assunto', precisaDizer: [['Domínios', 'Remetentes', 'Inventado']] }],
            }),
        })

        expect(r[0]?.gabarito.precisaDizer?.[0]).toEqual(['Domínios', 'Remetentes'])
    })

    it('respeita a quantidade pedida, mesmo se o modelo devolver mais', async () => {
        const casos = Array.from({ length: 5 }, (_, i) => ({ assunto: `a${i}`, mensagem: `pergunta número ${i} sobre domínio`, precisaDizer: [['Domínios']] }))
        const r = await gerarCasosDeArtigo({ artigo: ARTIGO, app: 'odontobox', categoria: 'uso', quantas: 2, extrator: extratorFalso({ casos }) })
        expect(r).toHaveLength(2)
    })

    it('o id não repete entre perguntas do mesmo artigo', async () => {
        const casos = Array.from({ length: 3 }, (_, i) => ({ assunto: `a${i}`, mensagem: `pergunta ${i} sobre o domínio`, precisaDizer: [['Domínios']] }))
        const r = await gerarCasosDeArtigo({ artigo: ARTIGO, app: 'odontobox', categoria: 'uso', quantas: 3, extrator: extratorFalso({ casos }) })
        expect(new Set(r.map((c) => c.id)).size).toBe(3)
    })
})

describe('fonteDaCategoria', () => {
    it('cada família de artigo alimenta a categoria que mede a capacidade dela', () => {
        expect(fonteDaCategoria('derivado:faq:como-troco-a-senha')).toBe('duvida')
        expect(fonteDaCategoria('derivado:produto:2-creditos')).toBe('duvida')
        expect(fonteDaCategoria('derivado:planos')).toBe('duvida')
        expect(fonteDaCategoria('derivado:papeis')).toBe('permissao')
        expect(fonteDaCategoria('derivado:tela:vendas-clientes')).toBe('uso')
        expect(fonteDaCategoria('derivado:tela:atendimento-agentes-integracoes')).toBe('integracao')
    })

    it('o mapa técnico NÃO gera pergunta: ele é de uso interno', () => {
        /// Perguntar ao cliente sobre o mapa técnico seria testar se o agente
        /// repete o que a ADR 0012 proíbe.
        expect(fonteDaCategoria('derivado:mapa:vendas')).toBeNull()
        expect(fonteDaCategoria('derivado:novidades')).toBeNull()
    })
})

describe('tecnicosDoApp', () => {
    it('são dez, todos esperando escalonamento para engenharia', () => {
        const t = tecnicosDoApp('odontobox')
        expect(t).toHaveLength(DISTRIBUICAO.tecnico)
        expect(t.every((c) => c.gabarito.desfecho === 'escalou-engenharia')).toBe(true)
        expect(t.every((c) => c.app === 'odontobox')).toBe(true)
        expect(new Set(t.map((c) => c.id)).size).toBe(10)
    })

    it('o caso de vazamento entre clientes proíbe confirmar ao cliente', () => {
        const vazamento = tecnicosDoApp('odontobox').find((c) => c.assunto.includes('outra unidade'))
        expect(vazamento?.gabarito.naoPodeDizer?.[0]?.o_que).toContain('vazamento')
    })

    it('as cinco categorias somam cem', () => {
        expect(TOTAL_POR_APP).toBe(100)
        expect(DISTRIBUICAO.duvida + DISTRIBUICAO.uso + DISTRIBUICAO.permissao).toBe(80)
    })
})
