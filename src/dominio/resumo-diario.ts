export interface LinhaDoResumo {
    app: string
    abertos: number
    resolvidos: number
    violados: number
    /** Em aberto AGORA, de qualquer data: é o que a equipe encontra de manhã. */
    emAberto: number
}

export interface DadosDoResumo {
    linhas: LinhaDoResumo[]
    /** O gasto de IA do período, em dólares. */
    gastoUsd: number
    /** Quantas horas o resumo cobre. */
    horas: number
}

/**
 * O resumo diário do canal de alertas (Fase 7).
 *
 * **O que ele responde**, em uma olhada e sem abrir o Console: quanto entrou,
 * quanto saiu, o que furou prazo, o que ficou e quanto a IA custou. É a leitura
 * de quem chega de manhã.
 *
 * **O que ele NÃO faz.** Não repete o que os alertas do dia já disseram. Queda
 * de app, prazo estourado e risco chegam na hora em que acontecem; repeti-los
 * aqui ensinaria a ignorar as duas coisas.
 *
 * Silencioso quando não houve nada: um resumo "0 chamados, US$ 0,00" todas as
 * manhãs é a maneira mais eficiente de ninguém ler o resumo do dia em que houve.
 */
export function textoDoResumoDiario(d: DadosDoResumo): string | null {
    const movimento = d.linhas.reduce((s, l) => s + l.abertos + l.resolvidos, 0)
    if (movimento === 0 && d.gastoUsd === 0) return null

    const linhas = d.linhas
        .filter((l) => l.abertos > 0 || l.resolvidos > 0 || l.emAberto > 0)
        .map((l) => {
            const partes = [
                `${l.abertos} aberto(s)`,
                `${l.resolvidos} resolvido(s)`,
                l.violados > 0 ? `${l.violados} fora do prazo` : null,
                l.emAberto > 0 ? `${l.emAberto} na fila agora` : null,
            ].filter((p): p is string => p !== null)

            return `• *${l.app}* — ${partes.join(' · ')}`
        })

    return [
        `*Resumo das últimas ${d.horas}h*`,
        ...(linhas.length === 0 ? ['• sem chamados'] : linhas),
        /// O custo entra sempre, mesmo zero: é o número que ninguém olha até
        /// doer, e vê-lo todo dia é o que faz US$ 229 serem notados no dia.
        `• IA: US$ ${d.gastoUsd.toFixed(2)}`,
    ].join('\n')
}
