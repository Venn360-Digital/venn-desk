import { describe, expect, it } from 'vitest'

import { dobrar, LIMIAR, parecidos, pontuar, termosDe } from './busca.ts'

describe('a busca por chamados parecidos', () => {
    it('dobra acento e caixa', () => {
        /// "não", "nao" e "NÃO" têm de ser a mesma coisa: metade dos chamados é
        /// escrita com pressa e a outra metade com calma.
        expect(dobrar('NÃO abre a AGENDA')).toBe('nao abre a agenda')
        expect(dobrar('configuração')).toBe('configuracao')
    })

    it('descarta palavra vazia e palavra curta', () => {
        /**
         * Sem isto, buscar "não consigo ver a agenda" casaria com todo chamado
         * que contém "não" — com todos — e a ordenação viraria ruído.
         */
        expect(termosDe('não consigo ver a agenda')).toEqual(['consigo', 'ver', 'agenda'])
        expect(termosDe('a e o de um')).toEqual([])
    })

    it('acha o MESMO problema descrito com palavras diferentes', () => {
        /**
         * O caso que motivou o módulo. Estes dois assuntos são o mesmo problema
         * e não têm substring em comum — a versão anterior, que casava
         * substring, não achava nenhum, e o agente buscou cinco vezes trocando
         * termos. Medido em 18/11/2026.
         */
        const antigo = 'A agenda nao abre depois do login'
        const novo = 'Recepcionista nova não consegue ver a agenda'

        expect(pontuar(antigo, termosDe(novo))).toBeGreaterThan(0)
    })

    it('casa por prefixo: plural e flexão contam', () => {
        /// "agenda" acha "agendamento"; "bloqueio" acha "bloquear". É a
        /// diferença mais comum entre duas pessoas descrevendo o mesmo caso.
        expect(pontuar('Erro ao salvar agendamento recorrente', ['agenda'])).toBe(1)
        expect(pontuar('Como bloquear um horário', ['bloqueio'])).toBe(1)
    })

    it('a nota é a FRAÇÃO dos termos, não a contagem', () => {
        /// Assim uma busca de duas palavras e uma de seis são comparáveis, e o
        /// mesmo limiar vale para as duas.
        expect(pontuar('agenda vazia', ['agenda', 'vazia'])).toBe(1)
        expect(pontuar('agenda vazia', ['agenda', 'vazia', 'impressora', 'boleto'])).toBe(0.5)
    })

    it('traz os parecidos e deixa o alheio de fora', () => {
        /**
         * Os dois primeiros casam os três termos — `usuario`, `novo`, `agenda`
         * — e empatam em 1. A versão anterior deste teste exigia um deles em
         * primeiro lugar, o que é pedir ordem onde não há diferença: um empate
         * é um empate, e inventar critério de desempate aqui seria escrever
         * regra para fazer o teste passar.
         */
        const achados = parecidos(
            [
                { assunto: 'Boleto não chegou por e-mail' },
                { assunto: 'Agenda vazia para usuário novo' },
                { assunto: 'Usuário novo não vê a agenda da clínica' },
            ],
            'usuario novo nao ve a agenda',
            5
        )

        expect(achados.length).toBe(2)
        expect(achados.every((a) => a.nota === 1)).toBe(true)
        expect(achados.map((a) => a.item.assunto)).not.toContain('Boleto não chegou por e-mail')
    })

    it('descarta o que casa pouco — do mesmo módulo não é parecido', () => {
        /**
         * Um chamado que casa só "agenda" numa busca de quatro palavras não é
         * parecido: é do mesmo módulo. Devolvê-lo faria o agente ler coisa
         * irrelevante e gastar contexto à toa.
         */
        const achados = parecidos(
            [{ assunto: 'Agenda não imprime' }],
            'relatorio financeiro do mes agenda',
            5
        )

        expect(achados).toEqual([])
        expect(LIMIAR).toBe(0.5)
    })

    it('busca sem nenhum termo útil não devolve tudo', () => {
        /// "e o de um" não é uma busca. Devolver a fila inteira seria pior que
        /// devolver nada.
        expect(parecidos([{ assunto: 'qualquer coisa' }], 'a e o de um', 5)).toEqual([])
    })

    it('o limite corta, e corta os PIORES', () => {
        const achados = parecidos(
            [
                { assunto: 'agenda login erro senha' },
                { assunto: 'agenda login erro' },
                { assunto: 'agenda login' },
            ],
            'agenda login erro senha',
            2
        )

        expect(achados.length).toBe(2)
        expect(achados[0]?.nota).toBeGreaterThanOrEqual(achados[1]!.nota)
        expect(achados.map((a) => a.item.assunto)).not.toContain('agenda login')
    })
})
