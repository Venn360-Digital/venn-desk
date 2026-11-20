import { z } from 'zod'

import { ancorar } from './ancorar.ts'
import type { Extrator } from './com-modelo.ts'
import { ErroDeExtracao, type Extracao } from '../tipos.ts'

/**
 * Quem pode fazer o quê, de `usePermissions.ts`.
 *
 * Passa pelo modelo porque a resposta está em conjuntos nomeados
 * (`EDITOR_ROLES`, `MANAGER_ROLES`) cruzados com flags (`canEdit`,
 * `canTransfer`) — ler isso é juntar duas listas, e o modelo junta bem. A
 * ancoragem confere os nomes dos papéis e das flags.
 *
 * O artigo resultante é o que o N1 usa para responder "por que o meu atendente
 * não vê isso?", que é das perguntas mais comuns de suporte em produto com
 * equipe.
 */

const PAPEL = ['OWNER', 'ADMIN', 'GESTOR', 'ATENDENTE'] as const

export const esquemaDosPapeis = z
    .object({
        papeis: z
            .array(
                z
                    .object({
                        chave: z.enum(PAPEL),
                        /** Como se chama em português, para quem atende dizer. */
                        nome: z.string().trim().min(3).max(40),
                    })
                    .strict()
            )
            .min(2),
        capacidades: z
            .array(
                z
                    .object({
                        nome: z.string().trim().min(3).max(80),
                        oQuePermite: z.string().trim().min(10).max(300),
                        papeis: z.array(z.enum(PAPEL)).min(1),
                        /** A flag do código que sustenta a linha. */
                        evidencia: z.string().trim().min(3).max(80),
                    })
                    .strict()
            )
            .min(3),
    })
    .strict()

export type Papeis = z.infer<typeof esquemaDosPapeis>

const INSTRUCAO = `Você transcreve as permissões de um produto a partir do código que as define.
Leia os conjuntos de papéis (ex.: EDITOR_ROLES, MANAGER_ROLES, OVERSIGHT_ROLES) e as flags que o hook devolve (ex.: canEdit, canManage, canTransfer, canSeeEveryone).
Devolva:
- papeis: cada papel do tipo de papel do workspace, com o nome em português que a equipe de suporte usaria (OWNER → "proprietário", ADMIN → "administrador", GESTOR → "gestor", ATENDENTE → "atendente").
- capacidades: uma linha por flag, dizendo o que ela permite em palavras de quem usa o produto, e quais papéis a têm. Em "evidencia", escreva o nome exato da flag ou do conjunto no código.
Transcreva o que está escrito. Não invente capacidade que o código não declara, e não suponha o que uma flag faria.`

export async function extrairPapeis(hookTs: string, extrator: Extrator): Promise<Extracao<Papeis>> {
    const { dados, consumo } = await extrator.extrair({
        esquema: esquemaDosPapeis,
        instrucao: INSTRUCAO,
        arquivos: [{ caminho: 'packages/core/src/hooks/usePermissions.ts', conteudo: hookTs }],
        maxTokensSaida: 2_500,
    })

    /// Ancora só o que o arquivo tem literalmente: a flag e o papel. O nome em
    /// português e a explicação são tradução pedida.
    const afirmacoes = [...dados.papeis.map((p) => p.chave), ...dados.capacidades.map((c) => c.evidencia)]
    const ancoragem = ancorar(afirmacoes, [hookTs])
    if (!ancoragem.ok) {
        throw new ErroDeExtracao('papeis', `flags ou papéis que não existem no arquivo: ${ancoragem.soltas.join(' | ')}`, consumo)
    }

    return { dados, extraidoPor: 'modelo', consumo }
}
