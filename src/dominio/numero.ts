import { ErroDeDominio } from '../lib/erros.ts'

/**
 * O número legível do chamado: `ODB-1042`, `CNT-0311`, `STG-0087` (seção 5).
 *
 * Prefixo por app, sequência por app. A sequência é incrementada dentro da
 * transação que cria o chamado — ver `App.proximoNumero` no schema. Aqui mora
 * só a forma, para a tela, o e-mail, o Slack e a issue escreverem igual.
 */

const LARGURA_MINIMA = 4

export function formatarNumero(prefixo: string, numero: number): string {
    if (!Number.isInteger(numero) || numero < 1) {
        throw new ErroDeDominio('numero_invalido', 'O número do chamado é um inteiro positivo.')
    }

    return `${prefixo.toUpperCase()}-${String(numero).padStart(LARGURA_MINIMA, '0')}`
}

/**
 * O caminho de volta: o usuário cola `ODB-1042` na busca, ou o assunto de um
 * e-mail traz o número.
 */
export function lerNumero(texto: string): { prefixo: string; numero: number } | null {
    const achado = /^\s*([A-Za-z]{2,5})-(\d{1,9})\s*$/.exec(texto)
    if (!achado) return null

    const [, prefixo, digitos] = achado
    if (prefixo === undefined || digitos === undefined) return null

    const numero = Number(digitos)
    return numero >= 1 ? { prefixo: prefixo.toUpperCase(), numero } : null
}
