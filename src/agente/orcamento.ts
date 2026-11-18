/**
 * O teto de gasto do agente (Fase 4: "teto de gasto").
 *
 * **Conta passos e tokens, não reais.** Preço de modelo muda, e um número de
 * dólares escrito no código vira mentira silenciosa no dia em que a tabela
 * mudar — pior que não ter teto, porque parece que tem. Passos e tokens são
 * exatos, vêm da própria resposta da API e não dependem de o código estar
 * atualizado. A conversão para dinheiro é feita por quem define a tarifa, uma
 * vez, e fica declarada.
 *
 * **Dois tetos, porque são duas falhas diferentes.** Um agente em laço chama
 * ferramenta sem parar e estoura PASSOS com poucos tokens. Um agente diante de
 * um chamado enorme estoura TOKENS no primeiro passo. Um teto só deixaria uma
 * das duas passar.
 */

export interface Tarifa {
    /** US$ por milhão de tokens de entrada. */
    entradaPorMilhao: number
    /** US$ por milhão de tokens de saída. */
    saidaPorMilhao: number
}

export interface Teto {
    passos: number
    tokens: number
}

/**
 * O padrão: 12 passos e 200 mil tokens por chamado.
 *
 * Doze passos cobrem o caminho completo — ler, buscar parecidos, classificar,
 * anotar, responder — com folga para uma correção de rota, e cortam o laço bem
 * antes de ele custar caro. Duzentos mil tokens é mais que qualquer chamado
 * real: quem chega lá está relendo o mesmo chamado em círculo.
 */
export const TETO_PADRAO: Teto = { passos: 12, tokens: 200_000 }

export interface Consumo {
    passos: number
    tokensDeEntrada: number
    tokensDeSaida: number
}

export const ZERO: Consumo = { passos: 0, tokensDeEntrada: 0, tokensDeSaida: 0 }

export function somar(a: Consumo, b: Partial<Consumo>): Consumo {
    return {
        passos: a.passos + (b.passos ?? 0),
        tokensDeEntrada: a.tokensDeEntrada + (b.tokensDeEntrada ?? 0),
        tokensDeSaida: a.tokensDeSaida + (b.tokensDeSaida ?? 0),
    }
}

export const totalDeTokens = (c: Consumo): number => c.tokensDeEntrada + c.tokensDeSaida

export type Veredito = { dentro: true } | { dentro: false; motivo: 'passos' | 'tokens' }

export function conferirTeto(consumo: Consumo, teto: Teto = TETO_PADRAO): Veredito {
    /// Passos primeiro: é o estouro que indica laço, e laço é o caso em que
    /// parar rápido importa mais.
    if (consumo.passos >= teto.passos) return { dentro: false, motivo: 'passos' }
    if (totalDeTokens(consumo) >= teto.tokens) return { dentro: false, motivo: 'tokens' }
    return { dentro: true }
}

/**
 * O custo estimado, em dólares.
 *
 * **Estimado, e o nome diz.** Ele ignora cache de prompt e desconto por lote,
 * que mudam o valor real para menos. Serve para ordem de grandeza na trilha de
 * auditoria — "este chamado custou centavos" contra "custou dólares" — e não
 * para fechar conta com ninguém.
 */
export function custoEstimado(consumo: Consumo, tarifa: Tarifa): number {
    return (
        (consumo.tokensDeEntrada / 1_000_000) * tarifa.entradaPorMilhao +
        (consumo.tokensDeSaida / 1_000_000) * tarifa.saidaPorMilhao
    )
}

/** O que a trilha de auditoria guarda de cada atendimento. */
export function paraATrilha(
    consumo: Consumo,
    tarifa: Tarifa
): Record<string, number | string> {
    return {
        passos: consumo.passos,
        tokensDeEntrada: consumo.tokensDeEntrada,
        tokensDeSaida: consumo.tokensDeSaida,
        custoEstimadoUsd: Number(custoEstimado(consumo, tarifa).toFixed(4)),
    }
}
