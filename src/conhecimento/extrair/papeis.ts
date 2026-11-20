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
                        /**
                         * SEM mínimo, e isso é a mesma lição pela quinta vez:
                         * `min(1)` é juízo disfarçado de forma. `daPlataforma`
                         * não pertence a papel de workspace nenhum — é o dono
                         * do workspace da Venn360 — e o modelo devolvia a lista
                         * vazia com razão, perdendo a fonte inteira.
                         */
                        papeis: z.array(curto),
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

const INSTRUCAO = `Você transcreve as permissões de um produto a partir do código que as define, para a equipe de suporte explicar a um cliente por que alguém da equipe dele não consegue fazer algo.
Leia os conjuntos de papéis (ex.: EDITOR_ROLES, MANAGER_ROLES, OVERSIGHT_ROLES) e as flags que o hook devolve (ex.: canEdit, canManage, canTransfer).

Devolva:
- papeis: um por papel de workspace que o código declara. Em "chave", o valor EXATO como está no código (OWNER, ADMIN, GESTOR, ATENDENTE). Em "nome", como a equipe de suporte o chamaria em português (proprietário, administrador, gestor, atendente).
- capacidades: uma por flag. Em "nome", um rótulo curto EM PORTUGUÊS do que a permissão faz, escrito para quem usa o produto — "Editar configurações da unidade", "Transferir conversa", "Ver o trabalho de toda a equipe". NUNCA use o nome da flag como rótulo. Em "oQuePermite", explique EM PORTUGUÊS, em uma frase, o que a pessoa com essa permissão consegue fazer no produto; o código tem comentários em inglês, e você deve traduzir a ideia, não copiar a frase. Em "papeis", liste as chaves dos papéis que têm essa permissão, usando EXATAMENTE os mesmos valores que você devolveu em papeis[].chave. Em "evidencia", o nome exato da flag ou do conjunto no código.

Transcreva o que está escrito. Não invente capacidade que o código não declara, e não suponha o que uma flag faria.`

export async function extrairPapeis(hookTs: string, extrator: Extrator): Promise<Extracao<Papeis>> {
    const { dados, consumo } = await extrator.extrair({
        esquema: esquemaDosPapeis,
        instrucao: INSTRUCAO,
        arquivos: [{ caminho: 'packages/core/src/hooks/usePermissions.ts', conteudo: hookTs }],
        maxTokensSaida: 6_000,
    })

    /// Ancora só o que o arquivo tem literalmente: a flag e a chave do papel. O
    /// rótulo em português e a explicação são tradução pedida.
    const afirmacoes = [...dados.papeis.map((p) => p.chave), ...dados.capacidades.map((c) => c.evidencia)]
    const ancoragem = ancorar(afirmacoes, [hookTs])
    if (!ancoragem.ok) {
        throw new ErroDeExtracao('papeis', `flags ou papéis que não existem no arquivo: ${ancoragem.soltas.join(' | ')}`, consumo)
    }

    /**
     * A tabela do artigo cruza capacidade com papel. Se as chaves não casarem,
     * ela sai inteira com um traço em cada célula — e o artigo passa a dizer
     * que ninguém pode nada, o que é pior que não existir. Aconteceu em
     * produção em 20/11/2026.
     */
    const chaves = new Set(dados.papeis.map((p) => p.chave.toUpperCase()))
    /// Capacidade sem papel nenhum é legítima (`daPlataforma`): ela não entra
    /// na conta de "nenhuma casa".
    const comPapel = dados.capacidades.filter((c) => c.papeis.length > 0)
    const semCruzamento = comPapel.filter((c) => !c.papeis.some((p) => chaves.has(p.toUpperCase())))
    if (comPapel.length > 0 && semCruzamento.length === comPapel.length) {
        throw new ErroDeExtracao(
            'papeis',
            `nenhuma capacidade casa com os papéis declarados (papéis: ${[...chaves].join(', ')}; capacidades citam: ${dados.capacidades.flatMap((c) => c.papeis).slice(0, 6).join(', ')})`,
            consumo
        )
    }

    /// Rótulo que é nome de flag escapa da ancoragem (a flag existe no
    /// arquivo), e deixaria "canEdit" como título de linha na tabela.
    const tecnicos = dados.capacidades.filter((c) => /^(?:can|is|has|da|should)[A-Z]/.test(c.nome) || !/\s/.test(c.nome)).map((c) => c.nome)
    if (tecnicos.length > 0) {
        throw new ErroDeExtracao('papeis', `rótulos que são nome de variável, não de permissão: ${tecnicos.join(', ')}`, consumo)
    }

    return { dados, extraidoPor: 'modelo', consumo }
}
