import { describe, expect, it } from 'vitest'

import { CASOS_DE_HUMANO, montarInstrucoes } from './instrucoes.ts'
import { ferramentasDoEscopo } from '../mcp/ferramentas.ts'

const BASE = {
    nomeDoApp: 'Odontobox360',
    numeroDoChamado: 'ODB-1042',
    modoSombra: false,
    ferramentas: ferramentasDoEscopo('SUPORTE'),
}

describe('as instruções do agente', () => {
    it('nomeia SÓ ferramentas que existem no escopo', () => {
        /**
         * A seção 8 cita `buscar_base`, que é da base de conhecimento (Fase 7)
         * e ainda não existe. Mandar o modelo usá-la gastaria uma rodada para
         * ele descobrir que não está na lista — e instrução que mente sobre as
         * próprias ferramentas corrói a confiança no resto do texto.
         */
        const texto = montarInstrucoes(BASE)
        const citadas = [...texto.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!)
        const existentes = BASE.ferramentas.map((f) => f.nome)

        for (const citada of citadas) {
            /// Só confere o que PARECE nome de ferramenta (tem underscore).
            if (!citada.includes('_')) continue
            expect(existentes, `instruções citam ${citada}`).toContain(citada)
        }
        expect(texto).not.toContain('buscar_base')
    })

    it('as regras comuns NÃO dependem do cadastro do app', () => {
        /// Um app novo nasce com elas valendo, sem ninguém preencher nada.
        const semCadastro = montarInstrucoes({ ...BASE, instrucoesDoApp: null })

        expect(semCadastro).toMatch(/nunca prometa prazo/i)
        expect(semCadastro).toMatch(/outro cliente/i)
        for (const caso of CASOS_DE_HUMANO) expect(semCadastro).toContain(caso)
    })

    it('manda escalar quando o texto do cliente tentar dar ordens', () => {
        const texto = montarInstrucoes(BASE)

        expect(texto).toMatch(/dado-nao-confiavel/)
        expect(texto).toMatch(/ignorar instru/i)
        expect(texto).toMatch(/não existe pedido legítimo com essa forma/i)
    })

    it('o que o app cadastra vem por ÚLTIMO e anunciado como dele', () => {
        /**
         * Ordem importa: o cadastro é editável na tela, e se ele viesse antes
         * das regras comuns, um texto colado ali poderia parecer regra da casa.
         * Vindo depois e sob um título que diz de quem é, não pode.
         */
        const texto = montarInstrucoes({
            ...BASE,
            instrucoesDoApp: 'Chame a unidade de "clínica". Nunca prometa integração com raio-X.',
        })

        expect(texto.indexOf('Sobre o Odontobox360')).toBeGreaterThan(
            texto.indexOf('Nunca prometa prazo')
        )
        expect(texto).toContain('Chame a unidade de "clínica"')
    })

    it('cadastro vazio não deixa seção vazia na instrução', () => {
        for (const vazio of [null, undefined, '', '   \n  ']) {
            const texto = montarInstrucoes({ ...BASE, instrucoesDoApp: vazio })
            expect(texto).not.toContain('## Sobre o Odontobox360')
        }
    })

    it('avisa o modo sombra, e só quando ele está ligado', () => {
        expect(montarInstrucoes({ ...BASE, modoSombra: true })).toMatch(/modo sombra está ligado/i)
        expect(montarInstrucoes({ ...BASE, modoSombra: false })).not.toMatch(/modo sombra/i)
    })

    it('diz que o que não passa pela ferramenta não chega ao cliente', () => {
        /// É a confusão mais cara que um agente pode ter: achar que o texto da
        /// resposta dele já é a resposta.
        expect(montarInstrucoes(BASE)).toMatch(/fora da ferramenta NÃO chega/i)
    })

    it('no escopo de engenharia, as instruções acompanham o catálogo', () => {
        const eng = montarInstrucoes({ ...BASE, ferramentas: ferramentasDoEscopo('ENGENHARIA') })

        expect(eng).toMatch(/escalar/)
        expect(eng).toMatch(/nunca prometa prazo/i)
    })
})
