import { describe, expect, it } from 'vitest'

import { ancoradoPorPalavras, ancorar, literaisDe, paraAncorar } from './ancorar.ts'

const ARQUIVO = `
  { label: "Agentes de IA", href: "/atendimento/agentes" },
  { label: v.Pessoas, href: "/vendas/clientes" },
  flow: 390,
`

describe('ancorar', () => {
    it('aceita o que existe no arquivo, dobrando acento e caixa', () => {
        const r = ancorar({ rotulo: 'agentes de ia', href: '/atendimento/agentes' }, [ARQUIVO])
        expect(r.ok).toBe(true)
    })

    it('composição de coisas que existem passa: o produto monta rótulo em tempo de execução', () => {
        /// `{editando ? 'Editar' : 'Criar'} agente` chega ao modelo como
        /// "Criar/Editar agente", e "EDITOR_ROLES / canEdit" junta duas coisas
        /// que existem. As duas são honestas, e as duas reprovavam antes.
        expect(ancorar({ a: 'Agentes de IA / Clientes' }, [ARQUIVO]).ok).toBe(true)
    })

    it('rejeita o que o modelo inventou, e diz o quê', () => {
        /// O defeito que isto impede: "Relatórios" no mapa do menu quando a
        /// tela não existe. O cliente seguiria o caminho e não acharia.
        const r = ancorar({ rotulo: 'Relatórios', href: '/relatorios' }, [ARQUIVO])
        expect(r.ok).toBe(false)
        expect(r.soltas).toEqual(['Relatórios', '/relatorios'])
    })

    it('tolera placeholders de vocabulário e confere o resto da frase', () => {
        expect(ancorar({ rotulo: '{{Pessoas}}' }, [ARQUIVO]).ok).toBe(true)
        expect(ancorar({ t: 'CRM para {{organizacoes}} com funil' }, ['CRM para ${v.organizacoes} com funil']).ok).toBe(true)
        expect(ancorar({ t: 'CRM para {{organizacoes}} com descontos' }, ['CRM para ${v.organizacoes} com funil']).ok).toBe(false)
    })

    it('ignora literais curtos e os tolerados por regex', () => {
        expect(ancorar({ a: 'ok', b: 'R$ 390' }, [ARQUIVO], [/^R\$/]).ok).toBe(true)
    })

    it('literaisDe percorre qualquer profundidade e ignora números', () => {
        expect(literaisDe({ a: ['x', { b: 'y', n: 3 }], c: null })).toEqual(['x', 'y'])
    })
})

describe('ancoradoPorPalavras', () => {
    const ARQUIVO = paraAncorar([
        `if (!token || error) {
            redirect('/login?erro=convite_invalido')
        }
        toast.error('Não foi possível carregar os domínios')`,
    ])

    it('aceita a evidência que o modelo reformatou', () => {
        /// O modelo devolve o trecho com as aspas e as quebras trocadas. Exigir
        /// a string inteira reprovava evidência honesta — foi a maior causa de
        /// tela perdida em 20/11/2026.
        expect(ancoradoPorPalavras(`if (!token || error) { redirect("/login?erro=convite_invalido") }`, ARQUIVO)).toBe(true)
        expect(ancoradoPorPalavras('toast.error("Não foi possível carregar os domínios")', ARQUIVO)).toBe(true)
    })

    it('recusa a evidência inventada', () => {
        expect(ancoradoPorPalavras('if (plano.expirado) { bloquearAcessoCompleto(usuario) }', ARQUIVO)).toBe(false)
        expect(ancoradoPorPalavras('toast.error("A assinatura venceu ontem")', ARQUIVO)).toBe(false)
    })

    it('trecho só de símbolos e palavras curtas não trava nem passa de graça', () => {
        expect(ancoradoPorPalavras('()', ARQUIVO)).toBe(true)
        expect(ancoradoPorPalavras('xyzw abcd efgh', ARQUIVO)).toBe(false)
    })
})
