import type { Vocabulario } from '../tipos.ts'

/**
 * Um vocabulário de teste a partir das quatro palavras que importam.
 *
 * As dezesseis formas escritas à mão em cada teste davam dezesseis chances de
 * errar uma e descobrir o erro no lugar errado.
 */
export function vocabularioFalso(p: {
    organizacao: string
    pessoa: string
    profissional: string
    servico: string
}): Vocabulario {
    const M = (s: string) => `${s[0]?.toUpperCase() ?? ''}${s.slice(1)}`
    return {
        genero: { organizacao: 'f', pessoa: 'm', profissional: 'm', servico: 'm' },
        organizacao: p.organizacao,
        Organizacao: M(p.organizacao),
        organizacoes: `${p.organizacao}s`,
        Organizacoes: `${M(p.organizacao)}s`,
        pessoa: p.pessoa,
        Pessoa: M(p.pessoa),
        pessoas: `${p.pessoa}s`,
        Pessoas: `${M(p.pessoa)}s`,
        profissional: p.profissional,
        Profissional: M(p.profissional),
        profissionais: `${p.profissional}s`,
        Profissionais: `${M(p.profissional)}s`,
        servico: p.servico,
        Servico: M(p.servico),
        servicos: `${p.servico}s`,
        Servicos: `${M(p.servico)}s`,
    }
}

export const ODONTO = vocabularioFalso({ organizacao: 'clínica', pessoa: 'paciente', profissional: 'dentista', servico: 'procedimento' })
export const AGENCIA = vocabularioFalso({ organizacao: 'agência', pessoa: 'cliente', profissional: 'talento', servico: 'serviço' })
