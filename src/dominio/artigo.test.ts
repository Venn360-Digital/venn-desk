import { describe, expect, it } from 'vitest'

import {
    RESUMO_MAXIMO,
    esquemaDoArtigo,
    podeIrPara,
    resumir,
    textoDeBusca,
} from './artigo.ts'
import { parecidos } from './busca.ts'

describe('esquemaDoArtigo', () => {
    it('recusa título curto demais para dizer alguma coisa', () => {
        expect(esquemaDoArtigo.safeParse({ titulo: 'ab', corpo: 'x'.repeat(20) }).success).toBe(
            false
        )
    })

    it('nasce específico do app: global é escolha, não padrão', () => {
        const lido = esquemaDoArtigo.parse({ titulo: 'Trocar a senha', corpo: 'x'.repeat(20) })
        expect(lido.global).toBe(false)
    })
})

describe('podeIrPara', () => {
    it('leva rascunho ao ar e tira do ar', () => {
        expect(podeIrPara('RASCUNHO', 'PUBLICADO')).toBe(true)
        expect(podeIrPara('PUBLICADO', 'ARQUIVADO')).toBe(true)
    })

    it('não republica arquivado direto', () => {
        /// Quem arquivou tirou do ar por um motivo. Voltar ao ar sem reler é
        /// desfazer a decisão sem olhar o que ela decidiu.
        expect(podeIrPara('ARQUIVADO', 'PUBLICADO')).toBe(false)
        expect(podeIrPara('ARQUIVADO', 'RASCUNHO')).toBe(true)
    })
})

describe('textoDeBusca', () => {
    it('faz o título pesar mais que uma menção de passagem no corpo', () => {
        const certo = {
            id: 'a',
            titulo: 'Redefinir a senha de acesso',
            corpo: 'Clique em esqueci minha senha e siga o e-mail.',
            tags: [],
        }
        /**
         * O impostor cita "senha" DUAS vezes e fala de outra coisa. Sem o peso
         * do título ele venceria pela contagem — que é exatamente o modo como
         * uma busca ingênua devolve o artigo errado para a pergunta certa.
         */
        const impostor = {
            id: 'b',
            titulo: 'Relatório de faturamento mensal',
            corpo: 'O relatório exige senha de administrador. Peça a senha ao gestor.',
            tags: [],
        }

        const achados = parecidos(
            [impostor, certo].map((a) => ({ ...a, assunto: textoDeBusca(a) })),
            'redefinir senha',
            5
        )

        expect(achados[0]?.item.id).toBe('a')
    })

    it('alcança o artigo pela palavra que só está na tag', () => {
        const artigo = {
            id: 'a',
            titulo: 'Redefinir a senha de acesso',
            corpo: 'Use o link enviado por e-mail.',
            tags: ['login', 'bloqueado'],
        }

        const achados = parecidos([{ ...artigo, assunto: textoDeBusca(artigo) }], 'login', 5)

        expect(achados).toHaveLength(1)
    })
})

describe('resumir', () => {
    it('devolve o corpo curto inteiro, sem reticências', () => {
        expect(resumir('  Duas  linhas\ne um espaço.  ')).toBe('Duas linhas e um espaço.')
    })

    it('corta na fronteira de palavra, sem partir sílaba', () => {
        const corpo = 'palavra '.repeat(200)
        const curto = resumir(corpo)

        expect(curto.length).toBeLessThanOrEqual(RESUMO_MAXIMO + 1)
        expect(curto.endsWith('…')).toBe(true)
        expect(curto).not.toContain('palav…')
    })
})
