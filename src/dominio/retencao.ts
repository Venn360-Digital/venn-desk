export interface PoliticaDeRetencao {
    /** Meses antes de o arquivo sair do armazenamento. */
    anexosEmMeses: number
    /** Anos antes de o chamado ser encerrado logicamente. */
    chamadosEmAnos: number
}

/**
 * A política padrão, como a seção 10 propõe.
 *
 * Anexos por 12 meses: eles são o que mais pesa e o que mais carrega dado
 * sensível — captura de tela de uma clínica pode trazer dado de paciente, e
 * guardá-la por cinco anos aumenta a superfície sem aumentar a utilidade.
 *
 * Chamados por 5 anos porque são o registro do atendimento: prazo de reclamação
 * e de disputa é contado em anos, e o texto de um chamado é a prova do que foi
 * dito.
 */
export const POLITICA_PADRAO: PoliticaDeRetencao = { anexosEmMeses: 12, chamadosEmAnos: 5 }

/** O instante a partir do qual um anexo pode sair do armazenamento. */
export function limiteDeAnexos(agora: Date, politica: PoliticaDeRetencao = POLITICA_PADRAO): Date {
    const d = new Date(agora)
    d.setUTCMonth(d.getUTCMonth() - politica.anexosEmMeses)
    return d
}

export function limiteDeChamados(agora: Date, politica: PoliticaDeRetencao = POLITICA_PADRAO): Date {
    const d = new Date(agora)
    d.setUTCFullYear(d.getUTCFullYear() - politica.chamadosEmAnos)
    return d
}

/**
 * O nome e o e-mail que substituem os do titular (LGPD, seção 10).
 *
 * O e-mail precisa continuar ÚNICO por app, porque a coluna é indexada e usada
 * para achar o solicitante — dois titulares anonimizados com o mesmo valor
 * colidiriam. O id interno serve: ele não é dado pessoal e já é único.
 *
 * O formato é legível de propósito: quem abre o chamado depois precisa entender
 * que ali havia uma pessoa e que ela pediu para sair, não achar que o dado se
 * perdeu.
 */
export function identidadeAnonima(requesterId: string): { nome: string; email: string } {
    return {
        nome: 'Titular que pediu exclusão',
        email: `removido+${requesterId}@invalido.local`,
    }
}

/** O que substitui o texto escrito pelo titular. */
export const TEXTO_REMOVIDO = '[conteúdo removido a pedido do titular]'
