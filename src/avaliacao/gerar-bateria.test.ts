import { describe, expect, it } from 'vitest'

import type { Extrator } from '../conhecimento/extrair/com-modelo.ts'
import { desfechoPelaPergunta, exigeEscalonamento, fonteDaCategoria, gerarCasosDeArtigo, servePraCliente, tecnicosDoApp } from './gerar-bateria.ts'
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
    it('são dez, todos esperando ESCALONAMENTO — nenhum tem resposta na base', () => {
        const t = tecnicosDoApp('odontobox')
        expect(t).toHaveLength(DISTRIBUICAO.tecnico)
        /// Para quem varia (ver bateria-tecnicos.ts); o que não varia é que
        /// nenhum deles se resolve respondendo.
        expect(t.every((c) => c.gabarito.desfecho.startsWith('escalou-'))).toBe(true)
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

describe('servePraCliente', () => {
    it('recusa o que a resposta ao cliente é proibida de dizer', () => {
        /**
         * O gerador devolveu `["OWNER","ADMIN","GESTOR"]` lido da tabela de
         * papéis. Exigir isso no gabarito seria exigir que o agente vaze nome
         * técnico — justamente o que a bateria reprova em outra linha.
         */
        for (const ruim of ['OWNER', 'ADMIN', 'MANAGER_ROLES', 'canEdit', 'workspaceId', 'page.tsx', '/api/products', '—', '  ', 'a']) {
            expect(servePraCliente(ruim), ruim).toBe(false)
        }
    })

    it('recusa frase comprida: o gabarito é por termo', () => {
        expect(servePraCliente('removendo-a de todos os registros e conversas que a usam')).toBe(false)
        expect(servePraCliente('Marketing → Domínios')).toBe(true)
    })

    it('aceita o que o cliente leria', () => {
        for (const bom of ['Domínios', 'registros', 'crédito de IA', 'Agentes de IA', 'proprietário', 'somente-leitura']) {
            expect(servePraCliente(bom), bom).toBe(true)
        }
    })
})

describe('o gabarito peneirado', () => {
    it('tira do grupo o termo técnico, e descarta o grupo que só tinha técnicos', async () => {
        const artigo = {
            chave: 'derivado:papeis',
            titulo: 'Quem pode fazer o quê',
            corpo: '| Editar configurações | proprietário | administrador | OWNER | ADMIN |',
        }
        const r = await gerarCasosDeArtigo({
            artigo,
            app: 'odontobox',
            categoria: 'permissao',
            quantas: 1,
            extrator: extratorFalso({
                casos: [
                    {
                        assunto: 'quem pode',
                        mensagem: 'quem pode editar as configurações aqui na clínica?',
                        precisaDizer: [['OWNER', 'ADMIN'], ['proprietário', 'administrador']],
                    },
                ],
            }),
        })

        expect(r[0]?.gabarito.precisaDizer).toEqual([['proprietário', 'administrador']])
    })
})

describe('exigeEscalonamento', () => {
    it('artigo de assunto de PESSOA gera caso de escalonamento, não de resposta', async () => {
        /**
         * Em 20/11/2026 a bateria reprovou o agente por escalar uma pergunta
         * sobre cobrança — que é exatamente o que a instrução dele manda fazer.
         * O gabarito estava contra a própria regra do produto.
         */
        const artigo = {
            chave: 'derivado:emails',
            titulo: 'E-mails que o Odontobox360 envia',
            corpo: 'Cobrança vencida — enviado quando a mensalidade está em aberto e a clínica entra em somente-leitura.',
        }
        expect(exigeEscalonamento(artigo)).toBe(true)

        const [caso] = await gerarCasosDeArtigo({
            artigo,
            app: 'odontobox',
            categoria: 'duvida',
            quantas: 1,
            extrator: extratorFalso({ casos: [{ assunto: 'somente leitura', mensagem: 'recebi aviso de somente-leitura, o que faço?', precisaDizer: [['cobrança']] }] }),
        })

        expect(caso?.gabarito.desfecho).toBe('escalou-humano')
        /// De quem escala não se exige conteúdo: o escalonamento É a resposta.
        expect(caso?.gabarito.precisaDizer).toBeUndefined()
    })

    it('artigo comum segue gerando caso de resposta', () => {
        expect(exigeEscalonamento({ chave: 'derivado:tela:vendas-servicos', titulo: 'Tela: Procedimentos', corpo: 'O catálogo de itens.' })).toBe(false)
    })

    it('menção de passagem no fim do artigo não transforma o assunto', () => {
        /// Um artigo de tela que cita "fatura" no último parágrafo continua
        /// sendo um artigo de tela.
        const artigo = { chave: 'derivado:tela:x', titulo: 'Tela: Relatórios', corpo: `${'texto comum. '.repeat(60)} veja também a fatura.` }
        expect(exigeEscalonamento(artigo)).toBe(false)
    })
})

describe('o gabarito não ecoa a pergunta', () => {
    it('termo que o cliente já disse é descartado', async () => {
        /**
         * O gerador escolhia a mensagem de erro que a própria pergunta citava,
         * e aí a bateria media se o agente ECOA o cliente. A resposta que
         * explica sem repetir é melhor, e era reprovada (20/11/2026).
         */
        const artigo = {
            chave: 'derivado:tela:agentes-comandos',
            titulo: 'Tela: Parametrização',
            corpo: 'Avisos: "É necessário criar o agente primeiro" quando ainda não há agente publicado. Fica em Parametrização.',
        }
        const [caso] = await gerarCasosDeArtigo({
            artigo,
            app: 'odontobox',
            categoria: 'integracao',
            quantas: 1,
            extrator: extratorFalso({
                casos: [
                    {
                        assunto: 'erro ao salvar regra',
                        mensagem: 'apareceu que preciso criar o agente primeiro, mas já tenho vários agentes',
                        precisaDizer: [['criar o agente primeiro'], ['Parametrização', 'publicado']],
                    },
                ],
            }),
        })

        expect(caso?.gabarito.precisaDizer).toEqual([['Parametrização', 'publicado']])
    })
})

describe('para quem cada caso técnico escala', () => {
    it('indisponibilidade geral e vazamento vão para PESSOA, como a instrução manda', () => {
        const t = tecnicosDoApp('odontobox')
        const geral = t.find((c) => c.mensagem.includes('Ninguém da equipe consegue entrar'))
        const quinhentos = t.find((c) => c.mensagem.includes('em todas as telas de lista'))
        const vazamento = t.find((c) => c.assunto.includes('outra unidade'))

        for (const caso of [geral, quinhentos, vazamento]) {
            expect(caso?.gabarito.desfecho, caso?.id).toBe('escalou-humano')
        }
    })

    it('defeito localizado vai para ENGENHARIA', () => {
        const t = tecnicosDoApp('odontobox')
        const localizados = t.filter((c) => c.gabarito.desfecho === 'escalou-engenharia')
        expect(localizados.length).toBe(7)
        expect(localizados.some((c) => c.assunto.includes('Relatório com número errado'))).toBe(true)
    })
})

describe('desfechoPelaPergunta', () => {
    it('pergunta financeira pede escalonamento, mesmo de artigo neutro', () => {
        /**
         * De um artigo de e-mails o gerador tirou "o atendimento foi pausado
         * por falta de pagamento, perdi as conversas?", com gabarito
         * "respondeu". O agente escalou — porque a instrução dele manda — e a
         * bateria o reprovou por obedecer (20/11/2026).
         */
        expect(desfechoPelaPergunta('aviso', 'o atendimento foi pausado por falta de pagamento')).toBe('escalou-humano')
        expect(desfechoPelaPergunta('créditos', 'queria comprar créditos pra testar à vontade')).toBe('escalou-humano')
        expect(desfechoPelaPergunta('sócio saiu', 'o proprietário saiu da empresa, quem gerencia agora?')).toBe('escalou-humano')
    })

    it('pergunta que descreve DEFEITO pede engenharia: não há artigo que responda', () => {
        expect(desfechoPelaPergunta('menu', 'cliquei no gerenciamento e a página fica em branco')).toBe('escalou-engenharia')
        expect(desfechoPelaPergunta('lista', 'só fica carregando e não abre nada')).toBe('escalou-engenharia')
        expect(desfechoPelaPergunta('relatório', 'o total não bate com a soma das linhas')).toBe('escalou-engenharia')
    })

    it('"deu erro" e "dono da conta" NÃO forçam desfecho: o artigo responde', () => {
        /**
         * Os dois primeiros padrões que escrevi eram largos demais e tiravam de
         * "respondeu" três casos legítimos: senha incorreta e permissão negada
         * dizem "deu erro" sem ser defeito, e "sou dono da conta, posso tudo?"
         * é pergunta de papéis, não de titularidade.
         */
        expect(desfechoPelaPergunta('esqueci a senha', 'tentei entrar e deu erro de senha incorreta')).toBeNull()
        expect(desfechoPelaPergunta('link do convite deu erro', 'apareceu que o convite expirou, e agora?')).toBeNull()
        expect(desfechoPelaPergunta('permissões', 'sou dono da conta, posso fazer absolutamente tudo?')).toBeNull()
        expect(desfechoPelaPergunta('exclusão', 'uma atendente tentou excluir um cadastro e deu erro, o que houve?')).toBeNull()
        /// "travou algo?" é pergunta retórica sobre um redirecionamento que o
        /// artigo da tela documenta. Só vale como defeito com sujeito.
        expect(desfechoPelaPergunta('sumiu a tela', 'entrei no Atendimento e caiu na tela de Agentes, é normal ou travou algo?')).toBeNull()
        expect(desfechoPelaPergunta('parou', 'o sistema travou na hora de salvar')).toBe('escalou-engenharia')
    })

    it('pergunta de uso comum não força desfecho nenhum', () => {
        expect(desfechoPelaPergunta('duração', 'de onde sai a duração de um procedimento?')).toBeNull()
        expect(desfechoPelaPergunta('etiquetas', 'como eu crio uma etiqueta nova?')).toBeNull()
    })
})
