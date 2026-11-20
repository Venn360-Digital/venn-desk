import { z } from 'zod'

import { ancorar } from './ancorar.ts'
import { curto, evidencia as campoDeEvidencia, frase, MUITOS } from './limites.ts'
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

export const esquemaDosPapeis = z
    .object({
        papeis: z
            .array(
                z
                    .object({
                        /**
                         * A chave como está no código. String livre, não enum:
                         * o arquivo tem `daPlataforma` ao lado dos quatro
                         * papéis, e um valor fora da lista derrubava a fonte
                         * inteira em vez de uma linha. Quem confere que a chave
                         * existe é a ancoragem.
                         */
                        chave: curto,
                        /** Como se chama em português, para quem atende dizer. */
                        nome: curto,
                    })
                    .strict()
            )
            .min(1),
        capacidades: z
            .array(
                z
                    .object({
                        nome: curto,
                        oQuePermite: frase,
                        papeis: z.array(curto).min(1),
                        /** A flag do código que sustenta a linha. */
                        evidencia: campoDeEvidencia,
                    })
                    .strict()
            )
            .min(1)
            .max(MUITOS),
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
        maxTokensSaida: 6_000,
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
