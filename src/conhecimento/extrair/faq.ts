import { z } from 'zod'

import { blocoDeChaves, desescapar } from './vocabulario.ts'

/**
 * A FAQ in-app de cada produto (`apps/<app>/src/app/(dashboard)/suporte/page.tsx`).
 *
 * É um objeto literal TypeScript: grupos com `grupo`, `resumo`, `icone` e
 * `itens: [{ p, r }]`. O parser aqui é determinístico e estreito de propósito —
 * ele entende exatamente essa forma e devolve `null` para qualquer outra, e é
 * esse `null` que manda o sincronizador para o fallback por modelo, marcado
 * como tal no Console. Um parser "esperto" que adivinhasse formas novas
 * publicaria adivinhação como se fosse a FAQ.
 *
 * Por que não importar o arquivo: ele é `'use client'`, puxa ícones do Lucide e
 * componentes do app. Não roda num Worker, e nem deveria.
 */

export const esquemaDaFaq = z
    .object({
        grupos: z
            .array(
                z
                    .object({
                        grupo: z.string().trim().min(2).max(80),
                        resumo: z.string().trim().max(300),
                        itens: z
                            .array(
                                z
                                    .object({
                                        p: z.string().trim().min(8).max(200),
                                        r: z.string().trim().min(20).max(2_000),
                                    })
                                    .strict()
                            )
                            .min(1),
                    })
                    .strict()
            )
            .min(1),
    })
    .strict()

export type Faq = z.infer<typeof esquemaDaFaq>

const STRING = `'((?:[^'\\\\]|\\\\.)*)'`

export function extrairFaq(pageTsx: string): Faq | null {
    const declaracao = /\bconst\s+FAQ\s*:[\s\S]*?=\s*\[/.exec(pageTsx)
    if (declaracao === null) return null

    const inicio = declaracao.index + declaracao[0].length - 1
    const lista = blocoDeColchetes(pageTsx, inicio)
    if (lista === null) return null

    const grupos: Faq['grupos'] = []
    /// Cada grupo é um `{ … }` de primeiro nível dentro da lista.
    for (const grupo of objetosDePrimeiroNivel(lista)) {
        const nome = new RegExp(`\\bgrupo\\s*:\\s*${STRING}`).exec(grupo)
        const resumo = new RegExp(`\\bresumo\\s*:\\s*${STRING}`).exec(grupo)
        if (nome === null) return null

        const itens: { p: string; r: string }[] = []
        const re = new RegExp(`\\{\\s*p\\s*:\\s*${STRING}\\s*,\\s*r\\s*:\\s*${STRING}\\s*,?\\s*\\}`, 'g')
        for (const m of grupo.matchAll(re)) {
            itens.push({ p: desescapar(m[1] ?? ''), r: desescapar(m[2] ?? '') })
        }
        if (itens.length === 0) return null

        grupos.push({ grupo: desescapar(nome[1] ?? ''), resumo: desescapar(resumo?.[1] ?? ''), itens })
    }

    const validacao = esquemaDaFaq.safeParse({ grupos })
    return validacao.success ? validacao.data : null
}

/** Como `blocoDeChaves`, para `[` e `]`. */
function blocoDeColchetes(texto: string, abre: number): string | null {
    if (texto[abre] !== '[') return null
    let nivel = 0
    for (let i = abre; i < texto.length; i++) {
        const c = texto[i]
        if (c === "'" || c === '"' || c === '`') {
            const aspa = c
            for (i++; i < texto.length; i++) {
                if (texto[i] === '\\') {
                    i++
                    continue
                }
                if (texto[i] === aspa) break
            }
            continue
        }
        if (c === '[') nivel++
        if (c === ']') {
            nivel--
            if (nivel === 0) return texto.slice(abre + 1, i)
        }
    }
    return null
}

function objetosDePrimeiroNivel(lista: string): string[] {
    const objetos: string[] = []
    let i = 0
    while (i < lista.length) {
        const abre = lista.indexOf('{', i)
        if (abre === -1) break
        const bloco = blocoDeChaves(lista, abre)
        objetos.push(bloco)
        i = abre + bloco.length
    }
    return objetos
}
