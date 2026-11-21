import { dobrar, parecidos } from './busca.ts'
import type { TipoDeChamado } from './prioridade.ts'

/**
 * A triagem que acontece ANTES de qualquer modelo (seção 4).
 *
 * Duas perguntas que o widget não faz e que mudam a rota do chamado: que tipo
 * de coisa é isto, e já existe um chamado igual aberto?
 *
 * **Por que determinístico.** A IA reclassifica depois, com
 * `classificar_chamado`, e faz isso melhor. Mas ela entra pela fila, segundos
 * depois, e em app com atendimento automático desligado ela não entra nunca —
 * então o chamado passaria a vida inteira como "dúvida normal". O palpite de
 * regra é pior que o da IA e infinitamente melhor que nenhum, porque é dele que
 * saem a prioridade e o prazo.
 *
 * **Palpite, e dito como tal.** Nada aqui decide nada sozinho: o tipo entra
 * como sugestão inicial, e a suspeita de duplicata vira nota interna para uma
 * pessoa olhar. Fechar chamado por semelhança de texto seria fechar o chamado
 * errado uma vez por semana.
 */

/** Sinais de DEFEITO: algo que funcionava e parou, ou que responde com erro. */
const DE_INCIDENTE =
    /\b(erro|falha|falhou|bug|travou|travando|quebrou|parou de|n[ãa]o (salva|carrega|abre|funciona|aparece|envia|entra)|sumiu|desapareceu|duplicad|em branco|500|502|timeout)\b/i

/** Sinais de PEDIDO: não existe, e alguém quer que exista. */
const DE_SOLICITACAO =
    /\b(gostaria que|seria (bom|[óo]timo)|poderiam|podem (adicionar|incluir|criar)|sugest[ãa]o|sugiro|falta a op[çc][ãa]o|n[ãa]o existe a op[çc][ãa]o|solicito|preciso que (criem|adicionem))\b/i

/** Sinais de DÚVIDA: existe, e a pessoa não achou ou não sabe usar. */
const DE_DUVIDA = /\b(como|onde|qual|quando|por que|porque|d[úu]vida|n[ãa]o (sei|entendi|encontro|acho))\b/i

export interface SinaisDoContexto {
    /** Erros de console capturados pelo widget. */
    errosDoConsole?: unknown
    /** Requisições que falharam. */
    requisicoesComFalha?: unknown
}

/**
 * O tipo mais provável do chamado.
 *
 * A ordem das perguntas é a regra, e não é arbitrária: PEDIDO antes de DEFEITO
 * porque "não existe a opção de exportar" tem a palavra "não existe" e é
 * solicitação; DEFEITO antes de DÚVIDA porque "como resolvo o erro ao salvar"
 * é incidente com cara de pergunta, e tratá-lo como dúvida daria a ele o teto
 * de prioridade de dúvida.
 *
 * O contexto do widget pesa mais que o texto: um erro de console capturado pela
 * máquina é prova, e a frase é relato.
 */
export function tipoSugerido(p: {
    assunto: string
    descricao: string
    contexto?: SinaisDoContexto | null
}): TipoDeChamado {
    const texto = `${p.assunto}\n${p.descricao}`

    if (DE_SOLICITACAO.test(texto)) return 'SOLICITACAO'

    /// Prova da máquina: o widget capturou erro de console ou requisição com
    /// falha naquela tela, na hora.
    const temProva = naoVazio(p.contexto?.errosDoConsole) || naoVazio(p.contexto?.requisicoesComFalha)
    if (temProva || DE_INCIDENTE.test(texto)) return 'INCIDENTE'

    if (DE_DUVIDA.test(texto)) return 'DUVIDA'

    /**
     * Sem sinal nenhum, DÚVIDA.
     *
     * É o padrão que estava lá antes desta função existir, e continua sendo o
     * certo: dúvida tem teto de prioridade alta e não acorda ninguém de
     * madrugada por engano.
     */
    return 'DUVIDA'
}

function naoVazio(valor: unknown): boolean {
    return Array.isArray(valor) ? valor.length > 0 : typeof valor === 'string' && valor.trim() !== ''
}

export interface ChamadoComparavel {
    id: string
    numero: number
    assunto: string
}

export interface Duplicata {
    numero: number
    id: string
    /** Fração de termos em comum, de 0 a 1. */
    nota: number
}

/**
 * Metade dos termos é "parecido"; duplicata exige mais.
 *
 * 0,5 é o limiar da busca (`LIMIAR` em `busca.ts`) e serve para sugerir leitura.
 * Para dizer "isto já foi aberto" o custo do erro é outro: o atendente fecha o
 * chamado novo achando que é o mesmo, e o cliente fica sem resposta. 0,75 pede
 * três de quatro palavras iguais.
 */
export const LIMIAR_DE_DUPLICATA = 0.75

/**
 * Os chamados abertos do MESMO solicitante que parecem ser o mesmo assunto.
 *
 * Mesmo solicitante, e não mesma empresa: duas pessoas da mesma clínica
 * relatando o mesmo problema são dois chamados legítimos — cada uma precisa de
 * resposta. A mesma pessoa reabrindo o mesmo assunto em dez minutos é quem
 * clicou duas vezes ou não viu o primeiro.
 */
export function duplicadosProvaveis(
    novo: { assunto: string; descricao?: string },
    abertos: ChamadoComparavel[],
    limiar = LIMIAR_DE_DUPLICATA
): Duplicata[] {
    const candidatos = abertos.filter((c) => dobrar(c.assunto).trim() !== '')
    if (candidatos.length === 0) return []

    return parecidos(candidatos, novo.assunto, 5)
        .filter(({ nota }) => nota >= limiar)
        .map(({ item, nota }) => ({ id: item.id, numero: item.numero, nota: Number(nota.toFixed(2)) }))
}
