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
         * Instrução que mente sobre as próprias ferramentas gasta uma rodada
         * do modelo descobrindo que a ferramenta não está na lista — e corrói a
         * confiança no resto do texto.
         *
         * Nasceu com uma asserção fixa contra `buscar_base`, que a seção 8
         * citava e o sistema não tinha. A base de conhecimento entrou em
         * 19/11/2026 e a asserção saiu; o que prova a regra é o laço abaixo,
         * que confere TODO nome citado contra o escopo — e vale para a próxima
         * ferramenta que alguém citar antes de existir.
         */
        const texto = montarInstrucoes(BASE)
        const citadas = [...texto.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!)
        const existentes = BASE.ferramentas.map((f) => f.nome)

        for (const citada of citadas) {
            /// Só confere o que PARECE nome de ferramenta (tem underscore).
            if (!citada.includes('_')) continue
            expect(existentes, `instruções citam ${citada}`).toContain(citada)
        }
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

describe('o bloco da base viva', () => {
    it('entra quando a base está no catálogo, com as três regras que o agente não adivinha', () => {
        const texto = montarInstrucoes({
            nomeDoApp: 'Odontobox360',
            numeroDoChamado: 'ODB-0001',
            modoSombra: false,
            ferramentas: ferramentasDoEscopo('SUPORTE'),
        })

        expect(texto).toContain('## A base é viva')
        /// Qual artigo vale mais: o derivado, que é a verdade de hoje.
        expect(texto).toContain('prefira o derivado mais recente')
        /// Como dizer onde fica: o caminho do menu, não o endereço.
        expect(texto).toContain('Vendas → Procedimentos')
        /// O mapa técnico é para entender e apontar, nunca para repetir.
        expect(texto).toMatch(/tag `tecnico`[\s\S]*Nunca repita ao cliente/)
    })

    it('não entra quando o canal não tem a base: seria instrução sobre o que não existe', () => {
        const texto = montarInstrucoes({
            nomeDoApp: 'Odontobox360',
            numeroDoChamado: 'ODB-0001',
            modoSombra: false,
            ferramentas: ferramentasDoEscopo('SUPORTE').filter((f) => f.nome !== 'buscar_base'),
        })
        expect(texto).not.toContain('## A base é viva')
    })
})
