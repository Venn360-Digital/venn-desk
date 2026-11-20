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

    it('reprova rótulo que o modelo inventou', async () => {
        /// "Exportar para Excel" não existe nesta tela. Publicá-lo mandaria o
        /// cliente procurar um botão que não há.
        const inventado = { ...TELA_VALIDA, acoes: [{ nome: 'Exportar Excel', oQueFaz: 'Baixa a planilha.', evidencia: 'Exportar para Excel' }] }
        await expect(extrairTela('/vendas/servicos', ARQUIVOS, extratorFalso(inventado))).rejects.toThrow(/não existem nos arquivos/)
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

    it('sem arquivo não há tela', async () => {
        await expect(extrairTela('/x', [], extratorFalso(TELA_VALIDA))).rejects.toThrow('nenhum arquivo')
    })
})
