import { describe, expect, it } from 'vitest'

import { extrairTela, procurarDetalheInterno, type ArquivoDaTela, type Tela } from './tela.ts'
import type { Extrator } from './com-modelo.ts'
import { fixture } from '../testes/fixtures.ts'

const CLIENT = fixture('modulo-vendas/_dashboard__vendas_servicos_ProcedimentosClient.tsx.txt')
const HANDLER = fixture('modulo-vendas/api_products_route.ts.txt')

const ARQUIVOS: ArquivoDaTela[] = [
    { caminho: 'packages/core/src/rotas/(dashboard)/vendas/servicos/ProcedimentosClient.tsx', conteudo: CLIENT, papel: 'tela' },
    { caminho: 'packages/core/src/rotas/api/products/route.ts', conteudo: HANDLER, papel: 'apoio' },
]

const TELA_VALIDA: Tela = {
    nome: 'Procedimentos',
    paraQueServe: 'Lista o catálogo de itens que a clínica oferece, com preço e duração.',
    oQueSeVe: ['Item atualizado'],
    acoes: [{ nome: 'Novo', oQueFaz: 'Abre o painel para cadastrar um item.', evidencia: 'Item criado' }],
    campos: [{ nome: 'Nome é obrigatório', obrigatorio: true }],
    avisos: [{ quando: 'ao excluir', texto: 'Item excluído' }],
    porQuePodeNaoAparecer: [{ situacao: 'A lista vem vazia quando nada foi cadastrado ainda.', evidencia: 'Não foi possível carregar os produtos e serviços' }],
}

function extratorFalso(dados: unknown, registro?: { arquivos?: { caminho: string; conteudo: string }[] }) {
    const ext: Extrator = {
        async extrair(pedido) {
            if (registro !== undefined) registro.arquivos = pedido.arquivos
            return { dados: pedido.esquema.parse(dados), consumo: { passos: 1, tokensDeEntrada: 5000, tokensDeSaida: 800 } }
        },
    }
    return ext
}

describe('extrairTela', () => {
    it('aceita a documentação cujas afirmações existem no arquivo', async () => {
        const r = await extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(TELA_VALIDA))
        expect(r.extraidoPor).toBe('modelo')
        expect(r.dados.nome).toBe('Procedimentos')
        expect(r.consumo?.passos).toBe(1)
    })

    it('DESCARTA o rótulo inventado e mantém o resto da tela', async () => {
        /**
         * "Exportar para Excel" não existe nesta tela, e publicá-lo mandaria o
         * cliente procurar um botão que não há. Mas derrubar a tela inteira por
         * causa de uma ação entre dezoito era trocar o certo pelo nada — foi o
         * que perdeu as oito telas maiores em 20/11/2026.
         */
        const comUmaInventada = {
            ...TELA_VALIDA,
            acoes: [
                { nome: 'Novo', oQueFaz: 'Abre o painel.', evidencia: 'Item criado' },
                { nome: 'Exportar Excel', oQueFaz: 'Baixa a planilha.', evidencia: 'Exportar para Excel' },
            ],
        }
        const r = await extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(comUmaInventada))

        expect(r.dados.acoes.map((a) => a.nome)).toEqual(['Novo'])
        expect(r.dados.avisos).toHaveLength(1)
    })

    it('se NADA do que a tela afirma vem dos arquivos, ela falha', async () => {
        const tudoInventado = {
            ...TELA_VALIDA,
            acoes: [{ nome: 'Exportar Excel', oQueFaz: 'Baixa a planilha.', evidencia: 'Exportar para Excel' }],
            campos: [{ nome: 'Chave da conta bancária' }],
            avisos: [{ quando: 'sempre', texto: 'Assinatura vencida ontem' }],
            porQuePodeNaoAparecer: [],
        }
        await expect(extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(tudoInventado))).rejects.toThrow(/nada do que a documentação afirma/)
    })

    it('nome de tela inventado reprova: é o que titula o artigo', async () => {
        const semNome = { ...TELA_VALIDA, nome: 'Faturamento recorrente' }
        await expect(extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(semNome))).rejects.toThrow(/não aparece nos arquivos/)
    })

    it('reprova detalhe interno no texto, mesmo ancorado', async () => {
        /**
         * O nome do arquivo ESTÁ no prompt, então ele passaria pela ancoragem.
         * Quem o barra é a ADR 0012: o N1 fala com o cliente, e "veja em
         * ProcedimentosClient.tsx" não é resposta para ninguém.
         */
        const comInterno = {
            ...TELA_VALIDA,
            paraQueServe: 'A tela vive em ProcedimentosClient.tsx e lista o catálogo de itens.',
        }
        await expect(extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(comInterno))).rejects.toThrow(/detalhe interno/)
    })

    it('a evidência PODE citar código: é trecho do arquivo de propósito', () => {
        const comEvidenciaTecnica: Tela = {
            ...TELA_VALIDA,
            acoes: [{ nome: 'Novo', oQueFaz: 'Abre o painel.', evidencia: 'const [editingId, setEditingId] = useState' }],
        }
        expect(procurarDetalheInterno(comEvidenciaTecnica)).toEqual([])
    })

    it('tela grande vai DIGERIDA; o apoio vai sempre digerido', async () => {
        const registro: { arquivos?: { caminho: string; conteudo: string }[] } = {}
        const grande = fixture('conversas-recorte.page.tsx.txt')
        await extrairTela(
            '/atendimento/conversas',
            [
                { caminho: 'a/page.tsx', conteudo: grande, papel: 'tela' },
                { caminho: 'b/route.ts', conteudo: HANDLER, papel: 'apoio' },
            ],
            extratorFalso(
                {
                    ...TELA_VALIDA,
                    nome: 'Transferir',
                    acoes: [{ nome: 'Assumir', oQueFaz: 'Passa a conversa para quem clicou.', evidencia: 'Devolver à IA' }],
                    campos: [],
                    avisos: [],
                    porQuePodeNaoAparecer: [],
                    oQueSeVe: ['Notas internas'],
                },
                registro
            )
        )

        const tela = registro.arquivos?.find((a) => a.caminho.startsWith('a/'))
        const apoio = registro.arquivos?.find((a) => a.caminho.startsWith('b/'))
        expect(tela?.caminho).toContain('resumo')
        expect(tela?.conteudo.length).toBeLessThan(grande.length / 8)
        expect(apoio?.caminho).toContain('resumo')
        expect(apoio?.conteudo).not.toContain('export async function GET')
    })

    it('tela pequena vai CRUA: o fluxo está na lógica', async () => {
        const registro: { arquivos?: { caminho: string; conteudo: string }[] } = {}
        await extrairTela(
            '/x',
            [
                {
                    caminho: 'p.tsx',
                    conteudo:
                        '<h1>Procedimentos</h1> <span>Item atualizado</span> <button>Novo</button> Item criado · Nome é obrigatório · Item excluído · Não foi possível carregar os produtos e serviços',
                    papel: 'tela',
                },
            ],
            extratorFalso(TELA_VALIDA, registro)
        )
        expect(registro.arquivos?.[0]?.caminho).toBe('p.tsx')
        expect(registro.arquivos?.[0]?.conteudo).toContain('<h1>')
    })

    it('"o que se vê" é DESCRIÇÃO e passa; rótulo de ação inventado NÃO passa', async () => {
        /**
         * A regressão que isto tranca, de 20/11/2026: a instrução pedia a
         * descrição de um bloco ("cabeçalho com busca e botão de criar") e a
         * ancoragem exigia o literal. Cinco das 33 telas foram reprovadas por
         * essa contradição minha, não por erro do modelo.
         *
         * A linha divisória: descrever o que a tela TEM é livre; dizer o nome
         * de um botão é afirmação, porque quem atende vai mandar o cliente
         * clicar nele.
         */
        const descritivo = {
            ...TELA_VALIDA,
            oQueSeVe: ['cabeçalho fixo com busca e botão de criar', 'grade de cartões, um por item'],
        }
        await expect(extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(descritivo))).resolves.toMatchObject({
            dados: { oQueSeVe: ['cabeçalho fixo com busca e botão de criar', 'grade de cartões, um por item'] },
        })

        /// Composição de palavras que existem passa (o produto monta rótulo em
        /// tempo de execução); rótulo de outra tela não passa.
        const rotuloComposto = { ...TELA_VALIDA, acoes: [{ nome: 'Novo / Item criado', oQueFaz: 'Abre o painel.', evidencia: 'Item criado' }] }
        await expect(extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(rotuloComposto))).resolves.toBeDefined()

        const rotuloDeOutraTela = {
            ...TELA_VALIDA,
            acoes: [
                { nome: 'Novo', oQueFaz: 'Abre o painel.', evidencia: 'Item criado' },
                { nome: 'Exportar planilha do Excel', oQueFaz: 'Baixa tudo.', evidencia: 'Item criado' },
            ],
        }
        const r = await extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(rotuloDeOutraTela))
        expect(r.dados.acoes.map((a) => a.nome)).toEqual(['Novo'])
    })

    it('"o que o campo aceita" é a REGRA descrita, e não precisa estar escrita no arquivo', async () => {
        /**
         * A regressão que isto tranca, de 20/11/2026: o modelo escrevia
         * "Mínimo de 8 caracteres" e a ancoragem exigia esse texto no arquivo —
         * mas a regra mora no código como `min(8)`, não como frase. Dezessete
         * telas foram perdidas por isso.
         */
        const comRegra = {
            ...TELA_VALIDA,
            campos: [{ nome: 'Nome é obrigatório', obrigatorio: true, oQueAceita: 'Texto, até 80 caracteres' }],
        }
        await expect(extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(comRegra))).resolves.toMatchObject({
            dados: { campos: [{ oQueAceita: 'Texto, até 80 caracteres' }] },
        })
    })

    it('ação com evidência inventada é descartada, mesmo com o rótulo certo', async () => {
        /// O rótulo existe, a justificativa não. Sem evidência não há
        /// afirmação: o item sai.
        const comEvidenciaFalsa = {
            ...TELA_VALIDA,
            acoes: [
                { nome: 'Novo', oQueFaz: 'Abre o painel.', evidencia: 'if (assinaturaVencida) bloquearTudoAgora()' },
                { nome: 'Novo', oQueFaz: 'Abre o painel.', evidencia: 'Item criado' },
            ],
        }
        const r = await extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(comEvidenciaFalsa))
        expect(r.dados.acoes).toHaveLength(1)
        expect(r.dados.acoes[0]?.evidencia).toBe('Item criado')
    })

    it('sem arquivo não há tela', async () => {
        await expect(extrairTela('/x', [], extratorFalso(TELA_VALIDA))).rejects.toThrow('nenhum arquivo')
    })
})
