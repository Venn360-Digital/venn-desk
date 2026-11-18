import { describe, expect, it } from 'vitest'

import {
    avisosDoTema,
    CONTRASTE_MINIMO,
    contraste,
    esquemaDoTema,
    lerTema,
    TEMA_PADRAO,
    tintaPara,
    variaveisDoTema,
} from './tema.ts'

describe('o tema do widget', () => {
    it('um app sem nada cadastrado tem tema válido', () => {
        /// O padrão não pode ser "vazio": ele é o que o widget usa em todo app
        /// que ninguém configurou, que no começo são todos.
        expect(TEMA_PADRAO.posicao).toBe('direita')
        expect(TEMA_PADRAO.mostrarBotao).toBe(true)
        expect(TEMA_PADRAO.modulos).toEqual([])
    })

    it('tema inválido no banco vira o padrão, sem lançar', () => {
        /**
         * O widget é a PORTA do suporte. Se ela quebrar por causa de um JSON
         * estranho — de uma versão antiga, de uma edição à mão —, a pessoa não
         * tem como reclamar que ela quebrou.
         */
        for (const lixo of [null, undefined, 'texto', 42, { corDeDestaque: 'azul' }, { posicao: 'meio' }]) {
            expect(() => lerTema(lixo)).not.toThrow()
            expect(lerTema(lixo)).toEqual(TEMA_PADRAO)
        }
    })

    it('recusa cor que não é hexadecimal', () => {
        expect(esquemaDoTema.safeParse({ corDeDestaque: 'rebeccapurple' }).success).toBe(false)
        expect(esquemaDoTema.safeParse({ corDeDestaque: '#1F56B5' }).success).toBe(true)
        expect(esquemaDoTema.safeParse({ corDeDestaque: '#abc' }).success).toBe(true)
    })

    it('calcula contraste pela fórmula da WCAG', () => {
        /// Preto sobre branco é o máximo da escala: 21:1.
        expect(contraste('#000000', '#FFFFFF')).toBe(21)
        expect(contraste('#FFFFFF', '#FFFFFF')).toBe(1)
    })

    it('escolhe entre preto e branco o que se lê melhor', () => {
        expect(tintaPara('#1F56B5')).toBe('#FFFFFF')
        expect(tintaPara('#FFE066')).toBe('#111117')
    })

    it('AVISA sobre contraste ruim, e não impede', () => {
        /**
         * A cor é da marca do cliente. Um bloqueio faria a pessoa escolher a
         * segunda cor preferida dela em vez da primeira — resolvendo o nosso
         * desconforto, não o problema dela.
         */
        const ruim = esquemaDoTema.parse({ corDeDestaque: '#FFE066', corSobreDestaque: '#FFFFFF' })

        expect(esquemaDoTema.safeParse({ corDeDestaque: '#FFE066', corSobreDestaque: '#FFFFFF' }).success).toBe(true)
        const avisos = avisosDoTema(ruim)
        expect(avisos.length).toBe(1)
        expect(avisos[0]?.campo).toBe('corDeDestaque')
        expect(avisos[0]?.texto).toMatch(/baixa visão/i)
    })

    it('não avisa quando o contraste está bom', () => {
        const bom = esquemaDoTema.parse({ corDeDestaque: '#1F56B5' })

        expect(contraste('#1F56B5', tintaPara('#1F56B5'))).toBeGreaterThanOrEqual(CONTRASTE_MINIMO)
        expect(avisosDoTema(bom)).toEqual([])
    })

    it('avisa sobre avatar sem https, que o navegador bloquearia', () => {
        const comHttp = esquemaDoTema.parse({ atendente: { avatar: 'http://exemplo.invalid/a.png' } })

        expect(avisosDoTema(comHttp).some((a) => a.campo === 'atendente.avatar')).toBe(true)
    })

    it('só emite a variável da cor quando alguém escolheu uma', () => {
        /**
         * Ausência significa "herde do app": o CSS do widget já é
         * `var(--primary, queda)`. Emitir a cor padrão sobrescreveria o tema
         * do app em todo app que não configurou nada — o oposto do combinado.
         */
        expect(variaveisDoTema(TEMA_PADRAO)['--vd-destaque']).toBeUndefined()

        const comCor = esquemaDoTema.parse({ corDeDestaque: '#1F56B5' })
        expect(variaveisDoTema(comCor)['--vd-destaque']).toBe('#1F56B5')
        expect(variaveisDoTema(comCor)['--vd-destaque-tinta']).toBe('#FFFFFF')
    })

    it('a tinta escolhida à mão vence a automática', () => {
        const comTinta = esquemaDoTema.parse({
            corDeDestaque: '#1F56B5',
            corSobreDestaque: '#FFE066',
        })

        expect(variaveisDoTema(comTinta)['--vd-destaque-tinta']).toBe('#FFE066')
    })

    it('a margem sempre sai, porque o widget precisa de uma', () => {
        expect(variaveisDoTema(TEMA_PADRAO)['--vd-margem']).toBe('24px')
    })
})
