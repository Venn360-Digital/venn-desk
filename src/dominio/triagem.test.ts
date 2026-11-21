import { describe, expect, it } from 'vitest'

import { duplicadosProvaveis, tipoSugerido } from './triagem.ts'
import { avisoDeDuplicata } from './duplicata-aviso.ts'

describe('tipoSugerido', () => {
    it('erro, falha e "não salva" são INCIDENTE', () => {
        expect(tipoSugerido({ assunto: 'erro ao salvar', descricao: 'dá erro quando clico em salvar' })).toBe('INCIDENTE')
        expect(tipoSugerido({ assunto: 'agenda', descricao: 'o horário sumiu da lista' })).toBe('INCIDENTE')
    })

    it('pedido de coisa que não existe é SOLICITAÇÃO, não incidente', () => {
        /**
         * A ordem das perguntas é a regra. "Não existe a opção de exportar"
         * contém "não existe", que pareceria defeito; é pedido. E pedido vai
         * para o backlog do produto com prioridade baixa, em vez de competir
         * com defeito na fila de suporte (seção 4).
         */
        expect(tipoSugerido({ assunto: 'exportar', descricao: 'não existe a opção de exportar em excel' })).toBe(
            'SOLICITACAO'
        )
        expect(tipoSugerido({ assunto: 'relatório', descricao: 'gostaria que tivesse um gráfico por mês' })).toBe(
            'SOLICITACAO'
        )
    })

    it('defeito com cara de pergunta continua INCIDENTE', () => {
        /// "Como resolvo o erro ao salvar" tem "como" e é incidente. Tratá-lo
        /// como dúvida daria a ele o teto de prioridade de dúvida.
        expect(tipoSugerido({ assunto: 'ajuda', descricao: 'como resolvo o erro ao salvar o agendamento?' })).toBe(
            'INCIDENTE'
        )
    })

    it('pergunta de uso é DÚVIDA', () => {
        expect(tipoSugerido({ assunto: 'procedimentos', descricao: 'onde eu cadastro um procedimento novo?' })).toBe(
            'DUVIDA'
        )
    })

    it('a prova da máquina pesa mais que a frase', () => {
        /**
         * O widget captura erro de console e requisição com falha. Isso é
         * prova; a frase é relato. "Não entendi essa tela" com um 500 atrás é
         * incidente, e quem lê a fila precisa ver isso.
         */
        expect(
            tipoSugerido({
                assunto: 'dúvida',
                descricao: 'não entendi essa tela',
                contexto: { requisicoesComFalha: [{ url: '/api/x', status: 500 }] },
            })
        ).toBe('INCIDENTE')
    })

    it('sem sinal nenhum, DÚVIDA — que é o padrão de antes', () => {
        expect(tipoSugerido({ assunto: 'agendamento', descricao: 'preciso de ajuda com isso' })).toBe('DUVIDA')
        expect(tipoSugerido({ assunto: '', descricao: '' })).toBe('DUVIDA')
    })
})

describe('duplicadosProvaveis', () => {
    const abertos = [
        { id: 't1', numero: 1040, assunto: 'erro ao salvar agendamento recorrente' },
        { id: 't2', numero: 1041, assunto: 'nota fiscal não emite' },
    ]

    it('acha o assunto repetido pelo mesmo solicitante', () => {
        const achados = duplicadosProvaveis({ assunto: 'erro ao salvar agendamento recorrente' }, abertos)
        expect(achados).toHaveLength(1)
        expect(achados[0]).toMatchObject({ numero: 1040, nota: 1 })
    })

    it('exige MAIS que a busca: parecido não é duplicata', () => {
        /**
         * 0,5 é o limiar da busca e serve para sugerir leitura. Dizer "isto já
         * foi aberto" tem outro custo: o atendente fecha o chamado novo achando
         * que é o mesmo, e o cliente fica sem resposta.
         */
        const achados = duplicadosProvaveis({ assunto: 'erro ao emitir nota fiscal do convênio' }, abertos)
        expect(achados).toEqual([])
    })

    it('lista vazia e assunto vazio não devolvem nada', () => {
        expect(duplicadosProvaveis({ assunto: 'qualquer coisa' }, [])).toEqual([])
        expect(duplicadosProvaveis({ assunto: '' }, abertos)).toEqual([])
    })
})

describe('avisoDeDuplicata', () => {
    it('nomeia os chamados com prefixo e a força do palpite', () => {
        /// O prefixo entra para a nota ser legível numa tela que mostra três
        /// produtos: `ODB-1040` diz mais que `1040`.
        const aviso = avisoDeDuplicata([{ id: 't1', numero: 1040, nota: 0.8 }], 'ODB')
        expect(aviso).toContain('ODB-1040')
        expect(aviso).toContain('80%')
        expect(aviso).toContain('Confira antes de responder')
    })

    it('sem duplicata não há nota', () => {
        /// Nada é escrito quando não há o que dizer: uma nota "nenhuma
        /// duplicata encontrada" em todo chamado é ruído na trilha.
        expect(avisoDeDuplicata([], 'ODB')).toBe(null)
    })
})
