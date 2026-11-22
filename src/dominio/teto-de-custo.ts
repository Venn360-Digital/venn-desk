/**
 * O cão de guarda de custo de IA (Fase 8).
 *
 * Existe por um dia datado: 20/11/2026, US$ 229 em rodadas de bateria, sem
 * ninguém ver a conta subir. O teto aqui NÃO corta nada — ele avisa. Cortar
 * automaticamente deixaria cliente sem resposta por causa de uma conta, e a
 * decisão de desligar o atendimento automático de um app já existe como botão
 * no Console, onde uma pessoa a toma sabendo o que perde.
 *
 * Dois níveis, porque um só não serve: o de ATENÇÃO chega quando ainda dá para
 * pensar, e o de ESTOURO quando já passou. Um aviso único no fim do dia só
 * informaria o prejuízo.
 */

export const TETO_DIARIO_PADRAO_USD = 25
/** A fração do teto em que o primeiro aviso sai. */
export const FRACAO_DE_ATENCAO = 0.6

export type NivelDoCusto = 'normal' | 'atencao' | 'estouro'

export interface VereditoDeCusto {
    nivel: NivelDoCusto
    /** Uma linha para o canal de alertas. Vazia quando é `normal`. */
    resumo: string
}

/**
 * Compara o gasto do dia com o teto e com o que já foi avisado.
 *
 * `jaAvisado` é o que impede o canal de alertas de repetir a mesma linha a cada
 * minuto do dia — o cron roda sempre, e um alerta que se repete 1.400 vezes é o
 * mesmo que nenhum.
 */
export function conferirCustoDoDia(p: {
    gastoUsd: number
    tetoUsd?: number
    jaAvisado: NivelDoCusto
}): VereditoDeCusto {
    const teto = p.tetoUsd ?? TETO_DIARIO_PADRAO_USD
    const gasto = Number(p.gastoUsd.toFixed(2))

    const nivel: NivelDoCusto =
        gasto >= teto ? 'estouro' : gasto >= teto * FRACAO_DE_ATENCAO ? 'atencao' : 'normal'

    /// Só sobe: do estouro não se volta a "atenção" no mesmo dia, senão o
    /// alerta piscaria a cada chamada que entra.
    const ordem: NivelDoCusto[] = ['normal', 'atencao', 'estouro']
    if (ordem.indexOf(nivel) <= ordem.indexOf(p.jaAvisado)) return { nivel, resumo: '' }

    return {
        nivel,
        resumo:
            nivel === 'estouro'
                ? `gasto de IA passou do teto do dia: US$ ${gasto.toFixed(2)} de US$ ${teto.toFixed(2)}. Para parar, desligue o atendimento automático no Console.`
                : `gasto de IA em US$ ${gasto.toFixed(2)} de US$ ${teto.toFixed(2)} no dia (${Math.round((gasto / teto) * 100)}%).`,
    }
}

/** O começo do dia em UTC, que é o relógio do cron. */
export function comecoDoDia(agora: Date): Date {
    return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()))
}
