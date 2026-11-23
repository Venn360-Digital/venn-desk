import { z } from 'zod'

import type { Evento } from './estados.ts'

/**
 * Macros: a resposta pronta com as ações que a acompanham (Fase 7).
 *
 * **Por que não é só um texto.** O que o atendente faz ao responder "pedimos os
 * dados e aguardamos" é sempre a mesma sequência: escrever, marcar com uma tag e
 * mover o chamado para "aguardando usuário". Guardar só o texto deixaria as
 * outras duas para a memória dele, e é nelas que se esquece.
 *
 * **A macro NÃO envia nada.** Ela preenche: o texto vai para o campo, as ações
 * ficam propostas, e quem confirma é a pessoa. Uma macro que envia sozinha seria
 * um botão de resposta automática com nome diferente — e o modo sombra existe
 * justamente porque esse botão precisa de revisão.
 */

const EVENTOS_DE_MACRO = ['assumir', 'responder_usuario', 'resolver', 'fechar'] as const

export const esquemaDaDefinicao = z
    .object({
        /** O texto que vai para o campo de resposta. */
        texto: z.string().trim().min(1).max(5_000).optional(),
        visibilidade: z.enum(['PUBLICA', 'INTERNA']).optional(),
        /** Tags a acrescentar — nunca a remover: macro não desfaz classificação. */
        tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
        /**
         * A transição proposta. Só as quatro que um atendente aplica ao
         * responder: `escalar_engenharia` e `mensagem_do_usuario` têm efeitos
         * próprios (abre thread, reabre chamado) e não cabem num atalho.
         */
        status: z.enum(EVENTOS_DE_MACRO).optional(),
    })
    .strict()
    .refine((d) => d.texto !== undefined || d.tags !== undefined || d.status !== undefined, {
        message: 'A macro precisa fazer alguma coisa: texto, tags ou status.',
    })

export type DefinicaoDaMacro = z.infer<typeof esquemaDaDefinicao>

export function definicaoDaMacro(valor: unknown): DefinicaoDaMacro | null {
    const lida = esquemaDaDefinicao.safeParse(valor)
    return lida.success ? lida.data : null
}

/** O evento do domínio que a macro propõe, quando propõe. */
export function eventoDaMacro(d: DefinicaoDaMacro): Evento | null {
    return d.status ?? null
}

/**
 * Normaliza o nome de uma tag.
 *
 * Minúscula e espaço colapsado, acento PRESERVADO: "cobrança" e "cobranca" são
 * a mesma intenção, mas quem digita a segunda espera ver a primeira na lista —
 * e dobrar o acento aqui criaria tags que ninguém reconhece. O que se evita é a
 * duplicata por caixa e por espaço, que é o caso real.
 */
export function normalizarTag(nome: string): string {
    return nome.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40)
}

/** As tags de uma lista, sem repetição e sem vazias, na ordem em que vieram. */
export function tagsNormalizadas(nomes: string[]): string[] {
    const vistas = new Set<string>()
    const saida: string[] = []

    for (const nome of nomes) {
        const limpa = normalizarTag(nome)
        if (limpa === '' || vistas.has(limpa)) continue
        vistas.add(limpa)
        saida.push(limpa)
    }

    return saida
}
