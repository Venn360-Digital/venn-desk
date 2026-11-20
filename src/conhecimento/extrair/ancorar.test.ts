import { describe, expect, it } from 'vitest'

import { ancorar, literaisDe } from './ancorar.ts'

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
