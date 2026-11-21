import { describe, expect, it } from 'vitest'

import { chavesQueDivergem, divergencias, type AppComparavel } from './divergencias.ts'
import { AGENCIA, ODONTO } from './testes/vocabulario-falso.ts'
import type { Vocabulario } from './tipos.ts'

function app(slug: string, vocabulario: Vocabulario, artigos: [string, string][]): AppComparavel {
    return {
        slug,
        nome: `${slug[0]?.toUpperCase() ?? ''}${slug.slice(1)}360`,
        vocabulario,
        artigos: artigos.map(([chave, corpo]) => ({ chave, titulo: chave, corpo })),
    }
}

describe('divergencias', () => {
    it('vocabulário diferente NÃO é divergência: é o produto funcionando', () => {
        /**
         * A asserção que dá sentido ao detector. Os três apps são cascas sobre
         * o mesmo core, e o texto só deve diferir nas palavras do nicho — se
         * isso contasse como divergência, todo artigo apareceria na lista e a
         * tela não serviria para nada.
         */
        const a = app('odontobox', ODONTO, [['derivado:tela:agenda', 'O paciente marca um procedimento com o dentista da clínica.']])
        const b = app('stagent', AGENCIA, [['derivado:tela:agenda', 'O cliente marca um serviço com o talento da agência.']])

        expect(divergencias([a, b])).toEqual([])
    })

    it('o rodapé de procedência, que é diferente por construção, não conta', () => {
        /// Ele carrega o caminho do arquivo de cada app. Sem o corte, 38 das
        /// 104 divergências medidas em 21/11/2026 eram esse rodapé.
        const a = app('odontobox', ODONTO, [
            ['derivado:faq:z', 'O paciente confirma.\n\n---\nFonte: perguntas frequentes (apps/odontobox360/src/suporte.tsx @ abc123)'],
        ])
        const b = app('stagent', AGENCIA, [
            ['derivado:faq:z', 'O cliente confirma.\n\n---\nFonte: perguntas frequentes (apps/stagent360/src/suporte.tsx @ abc123)'],
        ])

        expect(divergencias([a, b])).toEqual([])
    })

    it('a chave também carrega vocabulário, e por isso é dobrada', () => {
        /**
         * A FAQ gera a chave do título: o Odontobox tem
         * `o-mesmo-paciente-apareceu-duas-vezes` e o Conecta
         * `o-mesmo-cliente-…`. Comparar chave crua dava dezesseis artigos
         * "ausentes" que existem nos dois.
         */
        const a = app('odontobox', ODONTO, [['derivado:faq:o-mesmo-paciente-voltou', 'O paciente voltou.']])
        const b = app('stagent', AGENCIA, [['derivado:faq:o-mesmo-cliente-voltou', 'O cliente voltou.']])

        expect(divergencias([a, b])).toEqual([])
    })

    it('o nome do produto e a nota de tradução automática não contam', () => {
        /**
         * Os dois existem por construção: cada artigo diz o nome do seu app, e
         * quem não é a origem do texto recebe a nota de que as palavras do
         * nicho foram trocadas. Juntos, eram 32 dos 47 achados de 21/11/2026.
         */
        const a = app('odontobox', ODONTO, [['derivado:produto:1', 'As mudanças publicadas no Odontobox360.\n\n---\n---\nFonte: PRODUCT.md @ abc']])
        const b = app('conecta', AGENCIA, [
            [
                'derivado:produto:1',
                'As mudanças publicadas no Conecta360.\n\n---\n(As palavras do nicho foram trocadas automaticamente a partir do texto original; a regra é a mesma.)\n---\nFonte: PRODUCT.md @ abc',
            ],
        ])

        expect(divergencias([a, b])).toEqual([])
    })

    it('rota do código não dobra: é igual nos três por construção', () => {
        /// `/vendas/clientes` é o caminho real; no Conecta "clientes" é
        /// vocabulário, e dobrar fazia o menu divergir de um texto idêntico.
        const a = app('odontobox', ODONTO, [['derivado:menu', '- Pacientes — /vendas/clientes']])
        const b = app('conecta', AGENCIA, [['derivado:menu', '- Clientes — /vendas/clientes']])

        expect(divergencias([a, b])).toEqual([])
    })

    it('acusa conteúdo que sobra depois de dobrar o vocabulário', () => {
        const a = app('odontobox', ODONTO, [['derivado:faq:x', 'O paciente recebe aviso por e-mail em até 24 horas.']])
        const b = app('stagent', AGENCIA, [['derivado:faq:x', 'O cliente recebe aviso por e-mail em até 48 horas.']])

        const achados = divergencias([a, b])
        expect(achados).toHaveLength(1)
        expect(achados[0]).toMatchObject({ tipo: 'conteudo', chave: 'derivado:faq:x', app: 'stagent', comparadoCom: 'odontobox' })
        expect(achados[0]?.detalhe).toContain('24')
    })

    it('acusa palavra de outro nicho, que é a FAQ triplicada à mão', () => {
        /// O dano real no venn-saas: texto odontológico dentro do app de
        /// agenciamento, porque a FAQ foi copiada e só meio traduzida.
        const a = app('odontobox', ODONTO, [['derivado:faq:y', 'O paciente confirma a consulta.']])
        const b = app('stagent', AGENCIA, [['derivado:faq:y', 'O paciente confirma a consulta.']])

        const achados = divergencias([a, b])
        expect(achados).toHaveLength(1)
        expect(achados[0]).toMatchObject({ tipo: 'palavra-de-outro-nicho', chave: 'derivado:faq:y', app: 'stagent' })
        expect(achados[0]?.detalhe).toContain('paciente')
    })

    it('acusa o artigo que existe num app e falta no outro, nos dois sentidos', () => {
        const a = app('odontobox', ODONTO, [['derivado:faq:só-aqui', 'texto']])
        const b = app('stagent', AGENCIA, [['derivado:faq:só-lá', 'texto']])

        const achados = divergencias([a, b]).filter((d) => d.tipo === 'ausente')
        expect(achados.map((d) => `${d.chave}@${d.app}`).sort()).toEqual([
            'derivado:faq:só-aqui@stagent',
            'derivado:faq:só-lá@odontobox',
        ])
    })

    it('compara sempre contra a referência, para não relatar o mesmo três vezes', () => {
        /// Todos contra todos mostraria o triplo do problema que existe.
        const a = app('odontobox', ODONTO, [['k', 'texto igual']])
        const b = app('conecta', AGENCIA, [['k', 'texto diferente']])
        const c = app('stagent', AGENCIA, [['k', 'texto diferente']])

        const achados = divergencias([a, b, c]).filter((d) => d.tipo === 'conteudo')
        expect(achados.map((d) => d.app)).toEqual(['conecta', 'stagent'])
        expect(chavesQueDivergem(achados)).toEqual(['k'])
    })

    it('um app só não tem com o que divergir', () => {
        expect(divergencias([app('odontobox', ODONTO, [['k', 'x']])])).toEqual([])
    })
})
