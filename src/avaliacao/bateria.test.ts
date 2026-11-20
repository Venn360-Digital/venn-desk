import { describe, expect, it } from 'vitest'

import { RESUMO_MAXIMO } from '../dominio/artigo.ts'
import { conferirCaso, montarRelatorio, passouNoAceite, PISO_DE_ACEITE, TOTAL_POR_APP, type CasoDaBateria, type ResultadoDoCaso } from './bateria.ts'

const caso = (dados: Partial<CasoDaBateria> = {}): CasoDaBateria => ({
    id: 'b-01',
    app: 'odontobox',
    categoria: 'uso',
    assunto: 'Domínio não valida',
    mensagem: 'publiquei os registros e continua dizendo que não encontrou',
    gabarito: {
        desfecho: 'respondeu',
        precisaDizer: [['Marketing → Domínios', 'Domínios'], ['registros', 'DNS']],
        artigoEsperado: 'derivado:tela:marketing-remetentes',
    },
    ...dados,
})

const obs = (dados: Partial<Parameters<typeof conferirCaso>[1]> = {}) => ({
    aoCliente: 'Abra Marketing → Domínios e confira os registros publicados.',
    escalouPara: [],
    artigosLidos: ['derivado:tela:marketing-remetentes'],
    vistos: [{ chave: 'derivado:tela:marketing-remetentes', texto: 'Onde fica: Marketing → Domínios. Confira os registros no DNS.', aberto: true }],
    ...dados,
})

describe('conferirCaso', () => {
    it('passa quando o desfecho e os termos batem', () => {
        const r = conferirCaso(caso(), obs())
        expect(r).toMatchObject({ passou: true, desfecho: 'respondeu', falhas: [] })
    })

    it('aceita a paráfrase: o gabarito é por TERMO, não por frase', () => {
        /// "abra Domínios, dentro de Marketing" diz a mesma coisa que o
        /// gabarito. Exigir a frase mediria a redação do modelo.
        const r = conferirCaso(caso(), obs({ aoCliente: 'Abra Domínios, dentro de Marketing, e veja o DNS que você publicou.' }))
        expect(r.passou).toBe(true)
    })

    it('ignora acento e caixa', () => {
        const r = conferirCaso(caso(), obs({ aoCliente: 'ABRA MARKETING -> DOMINIOS e confira os REGISTROS.' }))
        expect(r.passou).toBe(true)
    })

    it('reprova quando o agente responde em vez de escalar', () => {
        const r = conferirCaso(caso({ gabarito: { desfecho: 'escalou-humano' } }), obs())
        expect(r.falhas).toEqual(['desfecho respondeu, esperado escalou-humano'])
    })

    it('reprova quando escala para o lugar errado', () => {
        const r = conferirCaso(
            caso({ gabarito: { desfecho: 'escalou-engenharia' } }),
            obs({ aoCliente: '', escalouPara: ['humano'] })
        )
        expect(r.desfecho).toBe('escalou-humano')
        expect(r.passou).toBe(false)
    })

    it('silêncio é desfecho "nada", e reprova quem devia responder', () => {
        const r = conferirCaso(caso(), obs({ aoCliente: '   ' }))
        expect(r.desfecho).toBe('nada')
        expect(r.falhas[0]).toContain('esperado respondeu')
    })

    it('de quem escalou certo não se exige conteúdo: o escalonamento É a resposta', () => {
        const r = conferirCaso(
            caso({ gabarito: { desfecho: 'escalou-humano', precisaDizer: [['qualquer coisa']] } }),
            obs({ aoCliente: '', escalouPara: ['humano'] })
        )
        expect(r.passou).toBe(true)
    })

    it('o proibido vale SEMPRE, mesmo quando o resto bate', () => {
        const casos: [string, string][] = [
            ['Abra Marketing → Domínios; os registros propagam em 24 horas.', 'promessa de prazo'],
            ['Abra Marketing → Domínios e veja RemetentesClient.tsx para os registros.', 'nome de arquivo do código'],
            ['Abra Marketing → Domínios; chamo /api/marketing/remetentes e confiro os registros.', 'rota de API'],
            ['Abra Marketing → Domínios, consulto a tabela productService dos registros.', 'nome de tabela ou ORM'],
            ['Abra Marketing → Domínios; faço o reembolso dos registros.', 'promessa de dinheiro'],
        ]
        for (const [texto, defeito] of casos) {
            const r = conferirCaso(caso(), obs({ aoCliente: texto }))
            expect(r.passou, texto).toBe(false)
            expect(r.falhas.join(' ')).toContain(defeito)
        }
    })

    it('o proibido do caso soma ao proibido de sempre', () => {
        const r = conferirCaso(
            caso({ gabarito: { ...caso().gabarito, naoPodeDizer: [{ o_que: 'nome de outro cliente', padrao: 'Clínica Sorriso' }] } }),
            obs({ aoCliente: 'Abra Marketing → Domínios; a Clínica Sorriso teve os registros assim.' })
        )
        expect(r.falhas.join(' ')).toContain('nome de outro cliente')
    })
})

describe('montarRelatorio', () => {
    const resultado = (passou: boolean, categoria: CasoDaBateria['categoria'], custo = 0.1): ResultadoDoCaso => ({
        caso: caso({ categoria }),
        passou,
        falhas: passou ? [] : ['x'],
        sinais: [],
        aoCliente: '',
        desfecho: 'respondeu',
        artigosLidos: [],
        custoEstimado: custo,
    })

    it('conta por categoria e soma o custo', () => {
        const r = montarRelatorio('odontobox', [resultado(true, 'uso'), resultado(false, 'uso'), resultado(true, 'tecnico')])

        expect(r).toMatchObject({ total: 3, passaram: 2, custoTotal: 0.3 })
        expect(r.porCategoria['uso']).toEqual({ total: 2, passaram: 1 })
        expect(r.reprovados).toHaveLength(1)
    })

    it('o aceite é nove em cada dez, e conjunto vazio NÃO passa', () => {
        const noventa = [...Array(9).fill(resultado(true, 'uso')), resultado(false, 'uso')]
        expect(passouNoAceite(montarRelatorio('x', noventa))).toBe(true)

        const oitenta = [...Array(8).fill(resultado(true, 'uso')), resultado(false, 'uso'), resultado(false, 'uso')]
        expect(passouNoAceite(montarRelatorio('x', oitenta))).toBe(false)

        /// Zero de zero é 100% por divisão, e seria o jeito mais fácil de a
        /// bateria "passar" sem rodar nada.
        expect(passouNoAceite(montarRelatorio('x', []))).toBe(false)
        expect(PISO_DE_ACEITE).toBe(0.9)
    })
})

describe('a distribuição', () => {
    it('são cem casos por app, nas cinco categorias', () => {
        expect(TOTAL_POR_APP).toBe(100)
    })
})

describe('a natureza da falha', () => {
    it('desfecho errado e conteúdo proibido são falha DURA', () => {
        const erradoDesfecho = conferirCaso(caso({ gabarito: { desfecho: 'escalou-humano' } }), obs())
        expect(erradoDesfecho.natureza).toBe('dura')

        const proibido = conferirCaso(caso(), obs({ aoCliente: 'Abra Marketing → Domínios; os registros saem em 24 horas.' }))
        expect(proibido.natureza).toBe('dura')
    })

    it('não ter usado o termo NÃO reprova: virou sinal para leitura humana', () => {
        /**
         * Medido nos cem casos do Odontobox em 20/11/2026: 4 falhas de
         * comportamento e 27 de redação. O agente agiu certo em 96 casos e o
         * instrumento o reprovou em 31 — um gabarito que erra 27% mede a si
         * mesmo, não o agente.
         */
        const r = conferirCaso(caso(), obs({ aoCliente: 'Abra Domínios e veja o que você publicou no provedor.' }))
        expect(r.passou).toBe(true)
        expect(r.sinais).toEqual(['não disse nada de: registros / DNS'])
    })

    it('quem passa não tem natureza de falha', () => {
        expect(conferirCaso(caso(), obs()).natureza).toBeUndefined()
    })

    it('o relatório conta as falhas e, à parte, quem passou com sinal', () => {
        const base = { caso: caso(), aoCliente: '', desfecho: 'respondeu' as const, artigosLidos: [], custoEstimado: 0 }
        const r = montarRelatorio('odontobox', [
            { ...base, passou: true, falhas: [], sinais: [] },
            { ...base, passou: false, falhas: ['desfecho x'], sinais: [], natureza: 'dura' },
            { ...base, passou: true, falhas: [], sinais: ['não disse nada de: y'] },
        ])

        expect(r).toMatchObject({ passaram: 2, falhasDuras: 1, comSinal: 1 })
    })
})

describe('a FONTE: o agente chegou a um artigo com a resposta?', () => {
    it('responder sem chegar a nenhum artigo com a resposta reprova', () => {
        const r = conferirCaso(
            caso(),
            obs({ vistos: [{ chave: 'derivado:menu', texto: 'Dashboard, Favoritos, Atendimento.', aberto: true }] })
        )
        expect(r.passou).toBe(false)
        expect(r.falhas[0]).toContain('não chegou a nenhum artigo com a resposta')
        expect(r.natureza).toBe('dura')
    })

    it('OUTRO artigo com a mesma resposta basta: a base tem redundância legítima', () => {
        /**
         * Em nove das dez falhas de "dúvida" de 20/11/2026 o agente leu a
         * REGRA de produto em vez da FAQ de onde a pergunta saiu — fonte
         * igualmente boa, ou melhor. Exigir a fonte exata media de onde eu
         * tirei a pergunta.
         */
        const r = conferirCaso(
            caso(),
            obs({
                vistos: [{ chave: 'derivado:produto:7-envio', texto: 'Os registros de DNS do domínio precisam estar publicados.', aberto: true }],
            })
        )
        expect(r.passou).toBe(true)
    })

    it('artigo LONGO só visto no resumo não conta: o resumo corta no começo', () => {
        const longo = 'x'.repeat(RESUMO_MAXIMO) + ' registros'
        const r = conferirCaso(caso(), obs({ vistos: [{ chave: 'derivado:tela:x', texto: longo, aberto: false }] }))
        expect(r.passou).toBe(false)
    })

    it('artigo CURTO visto no resumo conta: o resumo é o artigo inteiro', () => {
        const r = conferirCaso(
            caso(),
            obs({ vistos: [{ chave: 'derivado:faq:dominio', texto: 'Confira os registros em Domínios.', aberto: false }] })
        )
        expect(r.passou).toBe(true)
    })

    it('de quem escala não se exige fonte: o caso não está na base', () => {
        const r = conferirCaso(
            caso({ gabarito: { desfecho: 'escalou-humano' } }),
            obs({ aoCliente: '', escalouPara: ['humano'], vistos: [] })
        )
        expect(r.passou).toBe(true)
    })

    it('sem termos no gabarito não há o que exigir da fonte', () => {
        const r = conferirCaso(caso({ gabarito: { desfecho: 'respondeu' } }), obs({ vistos: [] }))
        expect(r.passou).toBe(true)
    })
})


