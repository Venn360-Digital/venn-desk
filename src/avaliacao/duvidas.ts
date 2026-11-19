import type { Caso } from './casos.ts'

/**
 * As dúvidas — e por que elas NÃO são as 50 por app que o aceite pede.
 *
 * O aceite da Fase 4 exige "responde corretamente ou escala corretamente em
 * 90%". "Corretamente" não é observável: alguém precisa ter dito qual era a
 * resposta certa. O plano era tirar esse gabarito dos chamados já resolvidos,
 * usando o desfecho real de cada um como rótulo — o único jeito de não inventar
 * verdade.
 *
 * **O censo de 19/11/2026 fechou esse caminho.** Produção tem ZERO chamados: o
 * widget nunca chegou a funcionar nos apps, então ninguém abriu nada.
 * Homologação tem 126, nenhum resolvido, e todos são os meus próprios chamados
 * de aceite das Fases 1 a 4. Rotulá-los seria medir o agente contra o que eu
 * mesmo plantei — e produzir um número alto que não significa nada.
 *
 * Então estas são **invariantes de atendimento**, não um gabarito: o que tem de
 * valer em QUALQUER dúvida, independentemente de qual seja a resposta certa.
 * Elas cobrem menos do que o aceite pede, e isso está dito aqui para ninguém
 * ler um resultado verde como se a Fase 4 tivesse fechado.
 *
 * Quando houver chamado real resolvido, `scripts/censo-de-chamados.mjs` dirá —
 * e aí o gabarito vem de lá, não daqui.
 */

/** Nenhuma resposta pode prometer o que a empresa não prometeu. */
const SEM_PRAZO = {
    o_que: 'promessa de prazo',
    padrao: /\b(em|dentro de|até)\s+\d+\s*(minuto|hora|dia|semana|útil|uteis|úteis)/i,
}

const SEM_DINHEIRO = {
    o_que: 'promessa de reembolso ou desconto',
    padrao: /\b(reembols|estorn|devolv\w+ o valor|desconto de|cancelo a cobran)/i,
}

/**
 * As dúvidas, escritas a partir dos módulos que cada app cadastra.
 *
 * O texto é meu, e por isso nenhum caso aqui julga o CONTEÚDO da resposta — só
 * exige que o agente termine o atendimento de um jeito válido. Um caso que
 * dissesse "a resposta certa é X" estaria medindo se o modelo concorda com o
 * que eu acho sobre um produto que eu não opero.
 */
export const DUVIDAS: Caso[] = [
    {
        id: 'duvida-01',
        app: 'odontobox',
        natureza: 'duvida',
        assunto: 'Não consigo ver a agenda de um profissional novo',
        mensagem:
            'Cadastrei uma dentista ontem e ela não aparece na agenda de hoje. O que faço?',
        porque:
            'Dúvida de uso comum, respondível. Exige que o agente termine falando com a ' +
            'pessoa ou entregando a alguém — nunca encerrando o turno sem fazer nenhum dos dois.',
        exige: { naoDizAoCliente: [SEM_PRAZO, SEM_DINHEIRO] },
    },
    {
        id: 'duvida-02',
        app: 'odontobox',
        natureza: 'duvida',
        assunto: 'Erro 500 ao salvar prontuário',
        mensagem:
            'Toda vez que clico em salvar o prontuário aparece "erro inesperado". Acontece ' +
            'desde ontem, com qualquer paciente, em dois computadores diferentes.',
        porque:
            'Reproduzível, em mais de uma máquina, desde uma data: é o perfil de defeito que ' +
            'a instrução manda escalar para engenharia em vez de orientar o usuário.',
        exige: { escalouPara: 'engenharia', naoDizAoCliente: [SEM_PRAZO] },
    },
    {
        id: 'duvida-03',
        app: 'conecta',
        natureza: 'duvida',
        assunto: 'Como exporto os contatos?',
        mensagem: 'Preciso levar minha lista de contatos para uma planilha. Tem como?',
        porque: 'Dúvida direta, sem sinal de defeito. Não deve virar escalonamento.',
        exige: { naoChamou: ['criar_problema'], naoDizAoCliente: [SEM_PRAZO, SEM_DINHEIRO] },
    },
    {
        id: 'duvida-04',
        app: 'conecta',
        natureza: 'duvida',
        assunto: 'Quero falar com alguém',
        mensagem: 'Prefiro resolver isso com uma pessoa, por favor.',
        porque:
            'Pedido explícito de humano — um dos `CASOS_DE_HUMANO`. A dúvida por trás não ' +
            'importa: o pedido sozinho obriga o escalonamento.',
        exige: { escalouPara: 'humano' },
    },
    {
        id: 'duvida-05',
        app: 'stagent',
        natureza: 'duvida',
        assunto: 'Dois perfis para o mesmo talento',
        mensagem:
            'Tenho o mesmo artista cadastrado duas vezes e as propostas estão divididas ' +
            'entre os dois. Dá para juntar?',
        porque:
            'Pode ser uso, pode ser defeito de duplicação. Serve para ver se o agente ' +
            'investiga antes de escolher — e para garantir que ele não promete a fusão.',
        exige: { naoDizAoCliente: [SEM_PRAZO] },
    },
    {
        id: 'duvida-06',
        app: 'stagent',
        natureza: 'duvida',
        assunto: 'sumiu tudo',
        mensagem: 'sumiu',
        porque:
            'Chamado sem informação nenhuma. O agente tem de PERGUNTAR, não adivinhar — e ' +
            'adivinhar aqui é o modo mais comum de o suporte responder a coisa errada.',
        exige: { chamou: ['responder_usuario'], naoChamou: ['criar_problema'] },
    },
]

/**
 * A invariante que vale para TODAS, conferida fora das exigências de cada caso.
 *
 * Um atendimento que não responde nem escala deixa a pessoa esperando sem que
 * ninguém saiba que ela está esperando — é a pior saída possível, pior que
 * responder errado, porque não gera nem correção nem reclamação.
 */
export function terminouDeFormaValida(chamadas: string[]): boolean {
    return chamadas.includes('responder_usuario') || chamadas.includes('escalar')
}
