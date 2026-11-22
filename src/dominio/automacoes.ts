export type AcaoAutomatica = 'lembrar' | 'resolver_por_inatividade' | 'fechar'

export interface PrazosDaAutomacao {
    /** Dias em "aguardando usuário" antes do lembrete. */
    lembreteEmDias: number
    /** Dias em "aguardando usuário" antes de resolver por inatividade. */
    resolverEmDias: number
    /** Dias em "resolvido" antes de fechar. */
    fecharEmDias: number
}

/**
 * Os prazos padrão, e o porquê de cada um.
 *
 * Três dias para o lembrete: dois são pouco (fim de semana e a pessoa nem viu),
 * cinco são tarde (ela já esqueceu o que perguntou). Sete para resolver, porque
 * depois de um lembrete sem resposta o chamado não está esperando por nós.
 * Cinco para fechar o resolvido, que é o prazo em que alguém reabre quando a
 * resposta não serviu — e reabrir um resolvido é mais barato que reabrir um
 * fechado.
 */
export const PRAZOS_PADRAO: PrazosDaAutomacao = { lembreteEmDias: 3, resolverEmDias: 7, fecharEmDias: 5 }

export interface ChamadoParado {
    id: string
    numero: number
    status: string
    /** A última vez que ALGUÉM escreveu, de qualquer lado. */
    ultimaMensagemEm: Date | null
    resolvidoEm: Date | null
    /** O lembrete já saiu neste ciclo de espera? */
    jaLembrado: boolean
}

export interface Decisao {
    chamadoId: string
    numero: number
    acao: AcaoAutomatica
    /** Dias parados, para o texto e para a trilha. */
    diasParado: number
}

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * As automações de inatividade (Fase 7).
 *
 * **Por que elas existem.** Um chamado em "aguardando usuário" que ninguém
 * responde fica na fila para sempre, e enquanto está lá ele mente: aparece como
 * trabalho pendente da equipe quando o pendente é do outro lado. Fechar sozinho
 * é o que mantém a fila honesta.
 *
 * **O lembrete vem antes, sempre.** Resolver sem lembrar seria encerrar o
 * chamado de quem talvez não tenha visto a resposta — e a pessoa descobriria
 * pelo e-mail de encerramento. O lembrete é a chance de ela voltar, e por isso o
 * prazo de resolver só conta depois dele.
 *
 * **Pura de propósito.** Decide, não executa: devolve a lista do que fazer, e
 * quem escreve é a camada de fora. É o que torna os prazos testáveis sem banco.
 */
export function decidirAutomacoes(
    chamados: ChamadoParado[],
    agora: Date,
    prazos: PrazosDaAutomacao = PRAZOS_PADRAO
): Decisao[] {
    const decisoes: Decisao[] = []

    for (const c of chamados) {
        if (c.status === 'AGUARDANDO_USUARIO') {
            /**
             * Sem mensagem nenhuma não há espera a medir.
             *
             * Acontece com chamado movido à mão para "aguardando usuário" antes
             * de alguém escrever. Resolver esse por inatividade encerraria um
             * chamado que ninguém ainda respondeu.
             */
            if (c.ultimaMensagemEm === null) continue

            const dias = Math.floor((agora.getTime() - c.ultimaMensagemEm.getTime()) / DIA_MS)

            if (c.jaLembrado) {
                if (dias >= prazos.resolverEmDias) {
                    decisoes.push({ chamadoId: c.id, numero: c.numero, acao: 'resolver_por_inatividade', diasParado: dias })
                }
                continue
            }

            if (dias >= prazos.lembreteEmDias) {
                decisoes.push({ chamadoId: c.id, numero: c.numero, acao: 'lembrar', diasParado: dias })
            }
            continue
        }

        if (c.status === 'RESOLVIDO' && c.resolvidoEm !== null) {
            const dias = Math.floor((agora.getTime() - c.resolvidoEm.getTime()) / DIA_MS)
            if (dias >= prazos.fecharEmDias) {
                decisoes.push({ chamadoId: c.id, numero: c.numero, acao: 'fechar', diasParado: dias })
            }
        }
    }

    return decisoes
}

/**
 * O texto do lembrete, que vai ao CLIENTE.
 *
 * Sem prazo e sem cobrança: ele não deve soar como ameaça de fechamento, nem
 * prometer data. E diz o que fazer — responder ali mesmo —, porque a pessoa pode
 * ter perdido o e-mail e não saber que o chamado espera por ela.
 */
export function textoDoLembrete(dias: number, resolverEmDias: number): string {
    const restam = Math.max(1, resolverEmDias - dias)
    return [
        'Passando para saber se a resposta anterior resolveu.',
        '',
        'Se ainda precisar de ajuda, responda por aqui e seguimos. ' +
            `Se não houver resposta, encerramos este chamado em ${restam} dia(s) — e você pode reabri-lo quando quiser.`,
    ].join('\n')
}
