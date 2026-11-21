import { z } from 'zod'

import { dobrar } from '../dominio/busca.ts'
import type { Extrator } from '../conhecimento/extrair/com-modelo.ts'
import { curto, frase } from '../conhecimento/extrair/limites.ts'
import { DISTRIBUICAO, type CasoDaBateria, type CategoriaDaBateria } from './bateria.ts'
import { TECNICOS } from './bateria-tecnicos.ts'

/**
 * Gera as perguntas da bateria a partir da base viva.
 *
 * **Por que a partir dos artigos.** A especificação pedia 50 dúvidas reais por
 * app, e o censo de 19/11/2026 provou que elas não existem: produção com zero
 * chamados. Inventá-las de cabeça mediria se o agente concorda com o meu
 * palpite sobre o produto. Geradas do artigo, elas medem o que importa — se o
 * agente ACHA a resposta que a empresa já tem escrita.
 *
 * **O gabarito é ancorado no artigo.** Cada termo que a resposta precisa dizer
 * tem de existir no artigo de origem. Sem isso, o modelo escreveria pergunta e
 * gabarito do mesmo palpite, e a bateria mediria a coerência dele consigo
 * mesmo.
 *
 * **A pergunta imita cliente, não documentação.** A instrução pede o jeito como
 * alguém escreve com pressa: sem o nome exato da tela, com a palavra do dia a
 * dia, às vezes com dois assuntos juntos. Uma pergunta que repete o título do
 * artigo mede a busca por palavra, e essa já tem teste.
 */

const esquemaDosCasos = z
    .object({
        casos: z
            .array(
                z
                    .object({
                        assunto: curto,
                        mensagem: frase,
                        /**
                         * Grupos de alternativas. Em cada grupo, ao menos uma
                         * precisa aparecer na resposta.
                         *
                         * Cada alternativa é um TERMO, com teto de 60
                         * caracteres: o modelo tende a devolver a frase inteira
                         * do artigo ("removendo-a de todos os registros e
                         * conversas que a usam"), e exigir a frase literal mede
                         * a redação do agente, não o acerto dele.
                         */
                        precisaDizer: z.array(z.array(z.string().trim().min(2).max(60)).min(1)).max(2),
                    })
                    .strict()
            )
            .max(20),
    })
    .strict()

const INSTRUCAO = `Você escreve perguntas de clientes para testar um atendimento de suporte.

Receberá UM artigo da base de conhecimento de um produto. Escreva perguntas que esse artigo responde, como um cliente de verdade as escreveria — com pressa, sem saber o nome exato da tela, usando a palavra do dia a dia dele. Algumas podem trazer um detalhe irrelevante junto, como acontece de verdade.

Para cada pergunta devolva:
- assunto: o que a pessoa escreveria no campo de assunto (curto, às vezes mal escrito).
- mensagem: o texto da dúvida, em uma ou três frases, na voz dela.
- precisaDizer: UM grupo, ou no máximo dois, de termos que uma boa resposta tem de conter. Cada grupo é uma lista de ALTERNATIVAS equivalentes (sinônimos, o caminho do menu, o nome da tela).

Sobre os termos do gabarito, e isto é o mais fácil de errar:
- **O teste é este: existe uma resposta CORRETA que não usaria nenhuma das alternativas do grupo?** Se existe, o grupo está errado — troque por alternativas mais amplas, ou não inclua o grupo. Prefira exigir pouco: um grupo com o nome da tela ou o conceito central costuma bastar.
- Use TERMO, não frase: "Domínios", "registros", "crédito" — nunca "removendo-a de todos os registros e conversas que a usam". No máximo seis palavras.
- Nunca use como termo o TÍTULO de uma seção do artigo ("Por que algo pode não aparecer", "Avisos que o sistema dá"): ninguém responde citando o título de uma seção.
- Nunca use como termo algo que a própria pergunta já diz. Se o cliente escreveu "apareceu que preciso criar o agente primeiro", exigir "criar o agente primeiro" mede se o agente repete o cliente, não se ele ajuda.
- Use só o que uma resposta AO CLIENTE pode dizer. Nunca nome de papel em maiúsculas (OWNER, ADMIN), nome de campo do banco, nome de arquivo, rota de API, nem símbolo solto: a resposta é proibida de citar isso, e exigi-lo seria exigir o erro.

NÃO escreva pergunta cuja resposta não esteja no artigo. NÃO repita o título do artigo dentro da pergunta — o cliente não o conhece.

NÃO escreva pergunta que descreva um DEFEITO ("a página fica em branco", "dá erro ao salvar", "fica carregando para sempre", "o total não bate"): essas não têm resposta em artigo nenhum, e já existem num conjunto separado. Pergunte sobre como o produto funciona, não sobre ele parar de funcionar.`

export interface ArtigoParaGerar {
    chave: string
    titulo: string
    corpo: string
}

/** Quantas perguntas tirar de um artigo, por categoria. */
export async function gerarCasosDeArtigo(p: {
    artigo: ArtigoParaGerar
    app: string
    categoria: CategoriaDaBateria
    quantas: number
    extrator: Extrator
    rota?: string
}): Promise<CasoDaBateria[]> {
    const { dados } = await p.extrator.extrair({
        esquema: esquemaDosCasos,
        instrucao: `${INSTRUCAO}\n\nEscreva ${p.quantas} pergunta(s).`,
        arquivos: [{ caminho: `artigo: ${p.artigo.titulo}`, conteudo: p.artigo.corpo }],
        maxTokensSaida: 4_000,
    })

    /// Título E corpo: o nome da tela está no título, e é um termo legítimo
    /// para a resposta citar.
    const noArtigo = dobrar(`${p.artigo.titulo}\n${p.artigo.corpo}`)
    const escalar = exigeEscalonamento(p.artigo)

    return dados.casos.slice(0, p.quantas).map((c, i) => {
        /**
         * Duas peneiras, e as duas por experiência de 20/11/2026.
         *
         * A primeira: termo que não existe no artigo sai, senão o gabarito
         * exige o que a base não diz e a bateria reprova um agente certo.
         *
         * A segunda: termo que a RESPOSTA é proibida de dizer sai também. O
         * gerador devolveu `["OWNER","ADMIN","GESTOR"]` lido da tabela de
         * papéis — e exigir isso seria exigir que o agente vaze nome técnico
         * ao cliente, que é justamente o que a bateria reprova em outra linha.
         */
        /**
         * A terceira peneira: termo que o CLIENTE JÁ DISSE na pergunta não
         * serve de gabarito.
         *
         * O gerador escolhia a mensagem de erro que a própria pergunta citava
         * ("apareceu que preciso criar o agente primeiro"), e aí a bateria
         * media se o agente ECOA o cliente — não se ele acrescenta algo. A
         * resposta que explica sem repetir a mensagem é melhor, e era reprovada.
         */
        const naPergunta = dobrar(`${c.assunto}\n${c.mensagem}`)

        const grupos = c.precisaDizer
            .map((grupo) =>
                grupo.filter(
                    (t) => noArtigo.includes(dobrar(t)) && servePraCliente(t) && !naPergunta.includes(dobrar(t))
                )
            )
            .filter((grupo) => grupo.length > 0)

        /// O artigo de origem decide, e a pergunta gerada pode sobrepor: um
        /// artigo neutro rende pergunta financeira ou de defeito.
        const desfechoForcado = escalar ? ('escalou-humano' as const) : desfechoPelaPergunta(c.assunto, c.mensagem)

        return {
            id: `${p.categoria}-${p.app}-${p.artigo.chave.replace(/[^a-z0-9]+/gi, '-').slice(-24)}-${i + 1}`,
            app: p.app,
            categoria: p.categoria,
            assunto: c.assunto,
            mensagem: c.mensagem,
            ...(p.rota === undefined ? {} : { rota: p.rota }),
            gabarito:
                desfechoForcado !== null
                    ? /// De quem escala não se exige conteúdo: o escalonamento
                      /// É a resposta.
                      { desfecho: desfechoForcado, artigoEsperado: p.artigo.chave }
                    : { desfecho: 'respondeu' as const, precisaDizer: grupos, artigoEsperado: p.artigo.chave },
        }
    })
}

/** Até quantas palavras um termo de gabarito pode ter. */
const PALAVRAS_NO_TERMO = 6

/**
 * O termo pode aparecer numa resposta ao cliente?
 *
 * Fora: nome em MAIÚSCULAS (papel, constante), identificador em camelCase,
 * arquivo, rota de API, símbolo solto, e frase comprida. Tudo isso é proibido
 * na resposta por outra regra — pôr no gabarito seria pedir o erro.
 */
export function servePraCliente(termo: string): boolean {
    const t = termo.trim()
    if (t.length < 2) return false
    if (!/[\p{L}]/u.test(t)) return false
    if (/^[A-Z][A-Z_]{2,}$/.test(t)) return false
    if (/^[a-z]+[A-Z]/.test(t)) return false
    if (/\.(?:tsx?|mjs|json|sql)\b|\/api\//.test(t)) return false
    if (t.split(/\s+/).length > PALAVRAS_NO_TERMO) return false
    return true
}

/**
 * Os artigos cujo assunto a instrução manda ESCALAR, não responder.
 *
 * A seção 4 obriga chamar uma pessoa em cobrança, dado pessoal (LGPD),
 * suspeita de vazamento e ameaça de cancelamento. Gerar desses artigos uma
 * pergunta com gabarito "respondeu" põe a bateria contra a própria instrução do
 * agente — e foi o que aconteceu em 20/11/2026 com o artigo de e-mails de
 * cobrança: o agente escalou certo e a bateria o reprovou.
 */
/**
 * Os assuntos que a instrução do agente manda entregar a uma pessoa.
 *
 * Espelha `CASOS_DE_HUMANO` de `src/agente/instrucoes.ts`, eixo por eixo, e é
 * por isso que existe: medido em 20/11/2026, quatro das cinco falhas de
 * permissão do Conecta eram o agente OBEDECENDO aquela lista — pergunta sobre
 * cartão (financeiro), sobre colega vendo conversa alheia e sobre link direto
 * que burla permissão (suspeita de vazamento) — enquanto o gabarito pedia
 * resposta. Uma bateria que pune a instrução não mede o agente.
 *
 * As frases são deliberadamente específicas. "conversa de outro colega" é
 * suspeita de vazamento; "quem vê qual conversa" é dúvida de produto, e a base
 * responde.
 */
const ASSUNTO_DE_PESSOA = new RegExp(
    [
        /// financeiro
        'cobran|pagament|fatura|mensalidade|reembols|comprar|compra de|cart[ãa]o|boleto|pix',
        /// LGPD e titularidade
        'lgpd|dados pessoais|titularidade|propriet[^ ]* (saiu|deixou|mudou)',
        /// fim de contrato
        'cancelamento|encerrar contrato|somente-leitura',
        /// suspeita de vazamento ou de permissão burlada
        'vazament|conversa (de|do|da) outr[oa] (colega|usu[áa]ri|atendente|pessoa)',
        'dados (de|do|da) outr[oa] (cliente|usu[áa]ri|empresa|loja|unidade)',
        'sem (eu|a gente|ningu[ée]m) (liberar|autorizar|dar acesso)|burlar|bypass',
        'link direto',
        /// pedido explícito de pessoa e indisponibilidade geral
        'falar com (algu[ée]m|uma pessoa|um humano|atendente humano)',
        'ningu[ée]m consegue (entrar|acessar)|sistema (todo )?(fora|caiu)',
    ].join('|'),
    'i'
)

export function exigeEscalonamento(artigo: { chave: string; titulo: string; corpo: string }): boolean {
    /// Pelo título e pelo começo do corpo: o assunto do artigo, não uma menção
    /// de passagem no meio dele.
    return ASSUNTO_DE_PESSOA.test(`${artigo.titulo}\n${artigo.corpo.slice(0, 400)}`)
}

/**
 * A pergunta GERADA também decide o desfecho, não só o artigo de origem.
 *
 * Medido em 20/11/2026: de um artigo neutro de e-mails o gerador tirou "o
 * atendimento foi pausado por falta de pagamento, perdi as conversas?", e o
 * gabarito saiu como "respondeu". O agente escalou — porque a instrução dele
 * manda escalar assunto financeiro — e a bateria o reprovou por obedecer.
 */
export function desfechoPelaPergunta(assunto: string, mensagem: string): 'escalou-humano' | 'escalou-engenharia' | null {
    const texto = `${assunto}\n${mensagem}`
    if (ASSUNTO_DE_PESSOA.test(texto)) return 'escalou-humano'
    /**
     * Pergunta que descreve DEFEITO não tem resposta na base, e o gerador
     * inventava algumas: "cliquei no menu e a página fica em branco" saiu de um
     * artigo de tela. O agente escalou para engenharia, certo, e era reprovado.
     */
    if (SINTOMA_DE_DEFEITO.test(texto)) return 'escalou-engenharia'
    return null
}

const SINTOMA_DE_DEFEITO =
    /(p[áa]gina|tela)[^,.!?]{0,24}(branco|branca)|fica carregando|n[ãa]o carrega|erro interno|erro inesperado|erro 500|algo deu errado|sumiu (tudo|os dados)|voltou a aparecer|n[ãa]o bate com|(sistema|p[áa]gina|tela|app|site) travou|travou (tudo|o sistema)|n[ãa]o abre nada|parou de funcionar/i

/**
 * Quais artigos alimentam cada categoria.
 *
 * Não é só organização: cada categoria mede uma capacidade diferente, e tirar
 * todas as perguntas das telas daria um número alto sobre uma habilidade só.
 */
export function fonteDaCategoria(chave: string): CategoriaDaBateria | null {
    if (chave.startsWith('derivado:faq:')) return 'duvida'
    if (chave.startsWith('derivado:produto:')) return 'duvida'
    if (chave === 'derivado:planos' || chave === 'derivado:emails') return 'duvida'
    if (chave === 'derivado:papeis') return 'permissao'
    if (chave.startsWith('derivado:tela:')) {
        /// Telas de integração e de agente medem outra coisa: configuração que
        /// depende de terceiro (WhatsApp, Google, provedor de DNS).
        if (/integracoes|agentes|remetentes|canais/.test(chave)) return 'integracao'
        return 'uso'
    }
    return null
}

/** Os técnicos, nomeados para o app. */
export function tecnicosDoApp(app: string): CasoDaBateria[] {
    return TECNICOS.map((c) => ({ ...c, app, id: `${c.id}-${app}` }))
}

export { DISTRIBUICAO }
