/**
 * Os módulos do produto — a unidade do mapa técnico e da documentação
 * funcional.
 *
 * Um módulo é um conjunto de prefixos de caminho no monorepo. A tabela é
 * escrita à mão de propósito: é uma decisão de produto ("Departamentos é de
 * atendimento, não de CRM", 2026-11-09) que nenhum parser tiraria do código, e
 * ela muda pouco. O que muda sempre — os arquivos dentro de cada prefixo — é
 * descoberto pela árvore do commit, nunca listado aqui.
 *
 * `plataforma/` fica FORA de todo módulo: é o console interno da Venn360, e
 * nada dele deve virar artigo que o agente leia para responder a um cliente.
 */

export interface Modulo {
    slug: string
    nome: string
    /** O que o módulo faz, para o título do mapa e para orientar o modelo. */
    resumo: string
    /** Prefixos sob `packages/core/src/` que pertencem ao módulo. */
    prefixos: string[]
}

export const MODULOS: Modulo[] = [
    {
        slug: 'atendimento',
        nome: 'Atendimento',
        resumo: 'Conversas de WhatsApp e outros canais, filas por departamento, etiquetas, respostas rápidas e transferência.',
        prefixos: [
            'rotas/(dashboard)/atendimento/conversas',
            'rotas/(dashboard)/atendimento/etiquetas',
            'rotas/(dashboard)/atendimento/respostas-rapidas',
            'rotas/(dashboard)/atendimento/page.tsx',
            'rotas/(dashboard)/vendas/departamentos',
            'rotas/api/conversations',
            'rotas/api/messages',
            'rotas/api/tags',
            'rotas/api/quick-responses',
            'rotas/api/departments',
            'components/conversas',
            'components/tags',
            'components/quick-responses',
            'components/departments',
        ],
    },
    {
        slug: 'agentes',
        nome: 'Agentes de IA',
        resumo: 'Os agentes que respondem no WhatsApp: criação, treinamento, regras, canais e números, integrações e parametrização.',
        prefixos: [
            'rotas/(dashboard)/atendimento/agentes',
            'rotas/api/agents',
            'rotas/api/whatsapp',
            'rotas/api/widget',
            'components/agents',
            'lib/treinamento',
        ],
    },
    {
        slug: 'vendas',
        nome: 'Vendas (CRM)',
        resumo: 'Negócios no funil, cadastro de pessoas, agenda, profissionais e catálogo de serviços.',
        prefixos: [
            'rotas/(dashboard)/vendas/negocios',
            'rotas/(dashboard)/vendas/clientes',
            'rotas/(dashboard)/vendas/agenda',
            'rotas/(dashboard)/vendas/profissionais',
            'rotas/(dashboard)/vendas/servicos',
            'rotas/(dashboard)/vendas/page.tsx',
            'rotas/api/deals',
            'rotas/api/pipelines',
            'rotas/api/contacts',
            'rotas/api/products',
            'rotas/api/professionals',
            'rotas/api/schedule-exceptions',
            'rotas/api/activities',
            'rotas/api/appointments',
            'components/contacts',
            'components/professionals',
            'components/products',
            'components/activities',
        ],
    },
    {
        slug: 'marketing',
        nome: 'Marketing',
        resumo: 'Campanhas por WhatsApp e e-mail, listas de contatos, templates, domínios de envio e funis automáticos.',
        prefixos: ['rotas/(dashboard)/marketing', 'rotas/api/marketing', 'rotas/api/broadcasts', 'rotas/api/funnels'],
    },
    {
        slug: 'conta',
        nome: 'Gerenciamento e conta',
        resumo: 'Conta, plano e créditos, usuários e permissões, integrações, agenda da unidade e dashboard.',
        prefixos: [
            'rotas/(dashboard)/gerenciamento',
            'rotas/(dashboard)/dashboard',
            'rotas/api/account',
            'rotas/api/users',
            'rotas/api/integrations',
            'rotas/api/dashboard',
            'rotas/api/billing',
            'components/account',
            'components/management',
            'components/users',
            'components/equipe',
            'components/integrations',
            'components/dashboard',
            'lib/plan-limits.ts',
            'lib/plans.ts',
            'lib/billing',
        ],
    },
    {
        slug: 'acesso',
        nome: 'Acesso e primeiros passos',
        resumo: 'Login, nova senha, convite para a equipe e o onboarding de uma conta nova.',
        prefixos: ['rotas/(auth)', 'rotas/api/auth', 'rotas/api/onboarding', 'rotas/api/invites', 'components/onboarding'],
    },
]

/** Prefixos que NUNCA entram em módulo nenhum, mesmo que casem por engano. */
export const EXCLUIDOS = ['rotas/(dashboard)/plataforma', 'rotas/api/plataforma', 'components/plataforma']

const RAIZ = 'packages/core/src/'

/**
 * O módulo de um caminho do repositório, ou `null` se não pertence a nenhum.
 *
 * O prefixo mais LONGO vence: `rotas/(dashboard)/vendas/departamentos` é de
 * atendimento mesmo com `rotas/(dashboard)/vendas` em outro lugar.
 */
export function moduloDe(caminho: string, modulos: Modulo[] = MODULOS): Modulo | null {
    if (!caminho.startsWith(RAIZ)) return null
    const relativo = caminho.slice(RAIZ.length)
    if (EXCLUIDOS.some((e) => relativo.startsWith(e))) return null

    let melhor: { modulo: Modulo; tamanho: number } | null = null
    for (const modulo of modulos) {
        for (const prefixo of modulo.prefixos) {
            if (relativo === prefixo || relativo.startsWith(prefixo.endsWith('.tsx') || prefixo.endsWith('.ts') ? prefixo : `${prefixo}/`)) {
                if (melhor === null || prefixo.length > melhor.tamanho) melhor = { modulo, tamanho: prefixo.length }
            }
        }
    }
    return melhor?.modulo ?? null
}
