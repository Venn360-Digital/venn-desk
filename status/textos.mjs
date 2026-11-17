/**
 * Os textos da página de status, nas três línguas dos e-mails (seção 7).
 *
 * Ficam em dados, e não no HTML, por duas razões: a página é gerada e a
 * tradução não deve exigir editar marcação; e o idioma é escolhido no
 * navegador do visitante, em tempo de leitura, porque a página é UMA para
 * todos — ela é estática.
 */
export const IDIOMAS = ['pt-BR', 'en', 'es']

export const TEXTOS = {
    'pt-BR': {
        titulo: 'Status dos sistemas Venn360',
        subtitulo: 'Esta página roda fora da infraestrutura dos aplicativos.',
        operacional: 'Operacional',
        fora: 'Fora do ar',
        naoMedido: 'Ainda não verificado',
        desconhecido: 'Não foi possível verificar',
        desde: 'desde',
        verificadoEm: 'última verificação',
        semAlcance:
            'Não foi possível alcançar o Venn Desk. Enquanto este aviso aparecer, o estado abaixo pode estar desatualizado — e a falha pode ser maior que um aplicativo.',
        carregando: 'Consultando…',
        verDetalhes: 'Ver detalhes',
        voltar: 'Todos os sistemas',
        historico: 'Histórico de indisponibilidade',
        semHistorico: 'Nenhuma indisponibilidade registrada.',
        colunaInicio: 'Início',
        colunaFim: 'Fim',
        colunaDuracao: 'Duração',
        emAberto: 'em aberto',
        duracao: 'duração',
        afetadoTitulo: 'Também fui afetado',
        afetadoTexto:
            'Informe o e-mail que você usa no aplicativo. Se ele estiver cadastrado, abrimos um chamado em seu nome e avisamos quando o problema for resolvido.',
        afetadoRotulo: 'Seu e-mail no aplicativo',
        afetadoBotao: 'Avisar que fui afetado',
        afetadoEnviando: 'Enviando…',
        afetadoErro: 'Não foi possível registrar agora. Tente novamente em um minuto.',
        abrirApp: 'Abrir o aplicativo',
        portalTitulo: 'Preciso falar com o suporte',
        portalTexto:
            'Seus chamados continuam acessíveis fora do aplicativo. O acesso é por um link enviado ao e-mail que você usa nele.',
        portalBotao: 'Acessar meus chamados',
        rodape: 'Página gerada em',
        minutos: 'min',
        horas: 'h',
    },
    en: {
        titulo: 'Venn360 system status',
        subtitulo: 'This page runs outside the applications’ infrastructure.',
        operacional: 'Operational',
        fora: 'Down',
        naoMedido: 'Not checked yet',
        desconhecido: 'Could not be checked',
        desde: 'since',
        verificadoEm: 'last check',
        semAlcance:
            'Venn Desk could not be reached. While this notice is showing, the state below may be out of date — and the failure may be larger than one application.',
        carregando: 'Checking…',
        verDetalhes: 'See details',
        voltar: 'All systems',
        historico: 'Downtime history',
        semHistorico: 'No downtime recorded.',
        colunaInicio: 'Start',
        colunaFim: 'End',
        colunaDuracao: 'Duration',
        emAberto: 'ongoing',
        duracao: 'duration',
        afetadoTitulo: 'I was affected too',
        afetadoTexto:
            'Enter the email you use in the application. If it is registered, we open a ticket on your behalf and let you know when the problem is fixed.',
        afetadoRotulo: 'Your email in the application',
        afetadoBotao: 'Report that I was affected',
        afetadoEnviando: 'Sending…',
        afetadoErro: 'Could not register right now. Please try again in a minute.',
        abrirApp: 'Open the application',
        portalTitulo: 'I need to talk to support',
        portalTexto:
            'Your tickets stay reachable outside the application. Access is through a link sent to the email you use in it.',
        portalBotao: 'Open my tickets',
        rodape: 'Page generated on',
        minutos: 'min',
        horas: 'h',
    },
    es: {
        titulo: 'Estado de los sistemas Venn360',
        subtitulo: 'Esta página funciona fuera de la infraestructura de las aplicaciones.',
        operacional: 'Operativo',
        fora: 'Fuera de servicio',
        naoMedido: 'Aún no verificado',
        desconhecido: 'No se pudo verificar',
        desde: 'desde',
        verificadoEm: 'última verificación',
        semAlcance:
            'No se pudo contactar con Venn Desk. Mientras aparezca este aviso, el estado de abajo puede estar desactualizado — y la falla puede ser mayor que una aplicación.',
        carregando: 'Consultando…',
        verDetalhes: 'Ver detalles',
        voltar: 'Todos los sistemas',
        historico: 'Historial de indisponibilidad',
        semHistorico: 'Ninguna indisponibilidad registrada.',
        colunaInicio: 'Inicio',
        colunaFim: 'Fin',
        colunaDuracao: 'Duración',
        emAberto: 'en curso',
        duracao: 'duración',
        afetadoTitulo: 'También me afectó',
        afetadoTexto:
            'Indique el correo que usa en la aplicación. Si está registrado, abrimos un caso en su nombre y le avisamos cuando se resuelva el problema.',
        afetadoRotulo: 'Su correo en la aplicación',
        afetadoBotao: 'Avisar que me afectó',
        afetadoEnviando: 'Enviando…',
        afetadoErro: 'No se pudo registrar ahora. Inténtelo de nuevo en un minuto.',
        abrirApp: 'Abrir la aplicación',
        portalTitulo: 'Necesito hablar con soporte',
        portalTexto:
            'Sus casos siguen accesibles fuera de la aplicación. El acceso es por un enlace enviado al correo que usa en ella.',
        portalBotao: 'Acceder a mis casos',
        rodape: 'Página generada el',
        minutos: 'min',
        horas: 'h',
    },
}
