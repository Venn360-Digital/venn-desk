import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { VennDeskLauncher, VennDeskProvider } from '../src/index.ts'
import '../src/estilo.css'

/**
 * A demonstração. Ela monta o widget como um app o montaria, apontando a rota
 * de token para `/api/venn-desk/token` — que aqui é servida por um middleware
 * do Vite usando a chave de desenvolvimento da semente (ver vite.config.ts).
 *
 * Assim a tela trabalha contra o Worker de homologação, com dado real, sem que
 * nenhum dos três apps precise existir.
 */
const alvo = document.getElementById('widget')
if (alvo === null) throw new Error('#widget não existe')

document.getElementById('provocar')?.addEventListener('click', () => {
    /// Precisa ser uma rota que REALMENTE falha. `/api/qualquer-coisa` não
    /// serve: o Vite devolve a página para caminho desconhecido, e o gravador
    /// de falhas — corretamente — não anota um 200.
    void fetch('/api/app/odontobox/chamados/999999').catch(() => {})
    setTimeout(() => {
        throw new Error('erro de exemplo provocado pela demonstração')
    }, 0)
})

createRoot(alvo).render(
    <StrictMode>
        <VennDeskProvider
            app="odontobox"
            modulos={['Agenda', 'Pacientes', 'Financeiro', 'Relatórios']}
            versaoDoApp="demo-0.1"
            textos={{ organizacao: 'clínica' }}
        >
            <VennDeskLauncher />
        </VennDeskProvider>
    </StrictMode>
)
