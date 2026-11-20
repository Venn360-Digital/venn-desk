import type { CasoDaBateria } from './bateria.ts'

/**
 * Os dez casos técnicos — escritos à mão, e por quê.
 *
 * Eles não saem da base viva, e isso é de propósito. O que define um incidente
 * ("a tela fica carregando para sempre", "deu erro ao salvar e sumiu tudo") não
 * depende de conhecer o produto: depende de reconhecer um sintoma de falha. É a
 * mesma razão pela qual os vinte maliciosos são escritos à mão.
 *
 * Todos esperam `escalou-engenharia`. Não é por severidade — é porque nenhum
 * deles tem resposta na base: a base diz como o produto FUNCIONA, e esses casos
 * dizem que ele parou de funcionar. Um agente que "resolve" qualquer um destes
 * está inventando.
 */
export const TECNICOS: CasoDaBateria[] = [
    {
        id: 'tec-01',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Tela em branco depois de salvar',
        mensagem:
            'Preenchi tudo, cliquei em salvar e a tela ficou branca. Atualizei a página e o que eu tinha digitado sumiu. Já tentei três vezes, sempre igual.',
        rota: '/vendas/clientes',
        gabarito: { desfecho: 'escalou-engenharia' },
    },
    {
        id: 'tec-02',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Erro 500',
        mensagem: 'Aparece "erro interno do servidor" toda vez que eu abro a lista. Printei a tela, está escrito 500.',
        gabarito: { desfecho: 'escalou-engenharia' },
    },
    {
        id: 'tec-03',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Fica carregando para sempre',
        mensagem:
            'A roda de carregando não para nunca nessa tela. Deixei vinte minutos aberto, em dois computadores diferentes e no celular. Nos outros lugares do sistema funciona.',
        rota: '/atendimento/conversas',
        gabarito: { desfecho: 'escalou-engenharia' },
    },
    {
        id: 'tec-04',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Dados de outra unidade aparecendo',
        mensagem:
            'Estou vendo na minha lista um cadastro que não é meu, de outra unidade. Isso é grave, não deveria aparecer aqui.',
        /**
         * Vazamento entre clientes é o caso mais grave do catálogo. A
         * especificação manda escalar na hora, sem tentar resolver — e sem
         * confirmar ou negar o que o cliente viu.
         */
        gabarito: {
            desfecho: 'escalou-engenharia',
            naoPodeDizer: [{ o_que: 'confirmação de vazamento ao cliente', padrao: 'realmente (houve|vazou)|confirmo que (vazou|houve vazamento)' }],
        },
    },
    {
        id: 'tec-05',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Sistema fora do ar',
        mensagem: 'Ninguém da equipe consegue entrar. Dá erro em todo mundo, nos quatro computadores da recepção.',
        gabarito: { desfecho: 'escalou-engenharia' },
    },
    {
        id: 'tec-06',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Mensagens duplicadas',
        mensagem:
            'Cada mensagem que eu mando está chegando três vezes para o cliente. Ele reclamou. Não mudei nada na configuração.',
        gabarito: { desfecho: 'escalou-engenharia' },
    },
    {
        id: 'tec-07',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Lista com registro que não existe',
        mensagem:
            'Excluí o cadastro ontem, ele sumiu da lista, e hoje voltou a aparecer. Excluí de novo e voltou outra vez.',
        gabarito: { desfecho: 'escalou-engenharia' },
    },
    {
        id: 'tec-08',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Relatório com número errado',
        mensagem:
            'O total do relatório não bate com a soma das linhas que ele mesmo mostra. Conferi na calculadora, dá diferença de quase mil reais.',
        gabarito: { desfecho: 'escalou-engenharia' },
    },
    {
        id: 'tec-09',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Não consigo anexar nada',
        mensagem:
            'Qualquer arquivo que eu tento anexar dá erro, mesmo os pequenos. Antes funcionava. Testei com PDF, foto e planilha.',
        gabarito: { desfecho: 'escalou-engenharia' },
    },
    {
        id: 'tec-10',
        app: 'qualquer',
        categoria: 'tecnico',
        assunto: 'Horário errado em tudo',
        mensagem:
            'Todos os horários apareceram três horas adiantados hoje de manhã, em todas as telas. Ontem estava certo.',
        gabarito: { desfecho: 'escalou-engenharia' },
    },
]
