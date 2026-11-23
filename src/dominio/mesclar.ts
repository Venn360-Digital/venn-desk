export interface ChamadoParaMesclar {
    id: string
    numero: number
    tenantId: string
    status: string
    excluidoEm: Date | null
    mescladoEmId: string | null
}

export type MotivoDaRecusa =
    | 'mesmo_chamado'
    | 'tenant_diferente'
    | 'origem_ja_mesclada'
    | 'destino_mesclado'
    | 'destino_fechado'
    | 'excluido'

/**
 * Mesclar chamados (Fase 7).
 *
 * **O que mesclar significa aqui.** A origem é encerrada apontando para o
 * destino, e nada é movido. Mover mensagens parece mais limpo e é pior: o
 * histórico do chamado de uma pessoa apareceria dentro do chamado de outra, e a
 * trilha deixaria de dizer quem falou onde.
 *
 * **Só dentro do mesmo tenant, e isso não é detalhe.** Dois chamados do mesmo
 * problema em empresas diferentes são dois chamados — cada uma precisa de
 * resposta, e apontar o chamado de uma para o da outra mandaria a pessoa a um
 * lugar que ela não pode abrir. Quando o defeito é o mesmo, o que agrupa é o
 * PROBLEMA (`vincular_incidente`), não a mesclagem.
 */
export function podeMesclar(
    origem: ChamadoParaMesclar,
    destino: ChamadoParaMesclar
): { ok: true } | { ok: false; motivo: MotivoDaRecusa } {
    if (origem.id === destino.id) return { ok: false, motivo: 'mesmo_chamado' }
    if (origem.excluidoEm !== null || destino.excluidoEm !== null) return { ok: false, motivo: 'excluido' }
    if (origem.tenantId !== destino.tenantId) return { ok: false, motivo: 'tenant_diferente' }
    if (origem.mescladoEmId !== null) return { ok: false, motivo: 'origem_ja_mesclada' }

    /**
     * O destino não pode ser ele mesmo uma duplicata.
     *
     * Sem isso nasceria cadeia — A aponta para B, que aponta para C —, e quem
     * abre A precisaria de dois saltos para achar a conversa. Mesclar em C é o
     * que a pessoa quis dizer, e exigir isso explicitamente deixa a decisão com
     * ela.
     */
    if (destino.mescladoEmId !== null) return { ok: false, motivo: 'destino_mesclado' }

    /// Encerrar a origem apontando para um chamado fechado deixaria as duas
    /// pontas sem caminho: ninguém responde no destino.
    if (destino.status === 'FECHADO') return { ok: false, motivo: 'destino_fechado' }

    return { ok: true }
}

const EXPLICACAO: Record<MotivoDaRecusa, string> = {
    mesmo_chamado: 'Um chamado não pode ser mesclado em si mesmo.',
    tenant_diferente: 'Os chamados são de empresas diferentes. Para agrupar o mesmo defeito, use o vínculo de incidente.',
    origem_ja_mesclada: 'Este chamado já foi mesclado em outro.',
    destino_mesclado: 'O chamado de destino já é uma duplicata. Mescle direto no chamado que continua.',
    destino_fechado: 'O chamado de destino está fechado, e ninguém responderia nele.',
    excluido: 'Um dos chamados foi excluído.',
}

export function explicarRecusa(motivo: MotivoDaRecusa): string {
    return EXPLICACAO[motivo]
}

/** O aviso público na origem. Leva o número do destino, que a pessoa pode abrir. */
export function textoDaMesclagem(numeroDoDestino: string): string {
    return [
        `Este chamado trata do mesmo assunto de ${numeroDoDestino}, e seguimos a conversa por lá.`,
        '',
        `Acompanhe em ${numeroDoDestino}. Se o seu caso for diferente, responda aqui e reabrimos.`,
    ].join('\n')
}
