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
 * O padrão: 30 passos e 150 mil tokens por chamado.
 *
 * O teto existe por dois motivos, e o segundo foi acrescentado caro.
 *
 * O primeiro é o LAÇO: um agente que relê o mesmo chamado em círculo não
 * melhora a resposta, só não termina — e um chamado que nunca termina é pior
 * para o cliente do que um respondido de forma mediana. Trinta passos é muito
 * mais do que qualquer caminho útil (ler, buscar, classificar, anotar,
 * responder, escalar cabe em sete) e ainda corta quem se perdeu.
 *
 * O segundo é o GASTO. A decisão de 18/11/2026 foi que token não é a restrição,
 * e o teto de tokens ficou em um milhão — até US$ 3 num único chamado. Em
 * 20/11/2026 um dia de rodadas de bateria custou US$ 229 e mostrou o que um
 * limite folgado permite quando ninguém está olhando. André baixou para 150 mil
 * em 21/11/2026, cerca de US$ 0,45 no pior caso.
 *
 * **O que isso corta.** O atendimento real medido (ODB-0122) usou 49 mil tokens
 * em 6 passos. O contexto é reenviado a cada passo, então o consumo cresce
 * rápido com o número deles: um chamado de mais de dez passos que abra vários
 * artigos inteiros pode bater em 150 mil e parar. Parar não deixa ninguém sem
 * resposta — o chamado vai para uma pessoa com nota interna dizendo por quê
 * (ver `atender.ts`) — mas é meio atendimento jogado fora, e o evento
 * `agente:teto` na trilha é o lugar de ver se está acontecendo demais.
 */
export const TETO_PADRAO: Teto = { passos: 30, tokens: 150_000 }

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
