/**
 * Prioridade sugerida por impacto e urgência (seção 5).
 *
 * É SUGESTÃO: a IA classifica, um humano ajusta, e o ajuste grava evento. O
 * impacto vem de uma pergunta que o usuário entende ("só eu", "minha equipe",
 * "não consigo trabalhar") em vez de pedir que ele escolha uma prioridade — que
 * ninguém calibra do lado de fora.
 */

export type Prioridade = 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE'

/** O que o widget pergunta na abertura. */
export type Impacto = 'so_eu' | 'minha_equipe' | 'nao_consigo_trabalhar'

/** Lido do texto pela triagem: existe contorno? há perda de dado? */
export type Urgencia = 'tem_contorno' | 'sem_contorno' | 'perda_de_dado'

export type TipoDeChamado = 'DUVIDA' | 'INCIDENTE' | 'PROBLEMA' | 'SOLICITACAO'

const MATRIZ: Readonly<Record<Impacto, Record<Urgencia, Prioridade>>> = {
    so_eu: {
        tem_contorno: 'BAIXA',
        sem_contorno: 'NORMAL',
        perda_de_dado: 'ALTA',
    },
    minha_equipe: {
        tem_contorno: 'NORMAL',
        sem_contorno: 'ALTA',
        perda_de_dado: 'URGENTE',
    },
    nao_consigo_trabalhar: {
        tem_contorno: 'ALTA',
        /// Tenant inteiro parado é urgente: é o caso de 15 minutos, 24x7
        /// (seção 12).
        sem_contorno: 'URGENTE',
        perda_de_dado: 'URGENTE',
    },
}

export function prioridadeSugerida(
    tipo: TipoDeChamado,
    impacto: Impacto,
    urgencia: Urgencia
): Prioridade {
    /**
     * Pedido de funcionalidade nova não é incidente (seção 4): vira solicitação
     * e vai para o backlog do produto. Deixá-lo competir por prioridade com
     * defeito é o que faz fila de suporte virar fila de produto.
     */
    if (tipo === 'SOLICITACAO') return 'BAIXA'

    const sugerida = MATRIZ[impacto][urgencia]

    /// Dúvida de uso não chega a urgente: ela não tem como parar um tenant. O
    /// teto é alta, que já é 30 minutos de primeira resposta.
    if (tipo === 'DUVIDA' && sugerida === 'URGENTE') return 'ALTA'

    return sugerida
}

/**
 * Casos que vão para humano na hora, em qualquer nível (seção 4). Não é
 * prioridade: é desvio de rota. A IA não responde nenhum deles.
 */
export const MOTIVOS_DE_HUMANO = [
    'cobranca',
    'reembolso',
    'pedido_de_titular_lgpd',
    'suspeita_de_incidente_de_seguranca',
    'vazamento_entre_tenants',
    'indisponibilidade_geral',
    'ameaca_de_cancelamento',
    'pedido_explicito_de_pessoa',
    'duas_tentativas_sem_resolver',
] as const

export type MotivoDeHumano = (typeof MOTIVOS_DE_HUMANO)[number]

export function exigeHumano(motivos: readonly string[]): boolean {
    return motivos.some((motivo) => (MOTIVOS_DE_HUMANO as readonly string[]).includes(motivo))
}
