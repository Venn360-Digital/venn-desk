import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from './App.tsx'
import './estilo.css'

const raiz = document.getElementById('raiz')
if (raiz === null) throw new Error('elemento #raiz não existe no index.html')

/**
 * `retry: false` de propósito: numa tela de operação, repetir uma requisição
 * que falhou esconde o erro por segundos e faz o atendente achar que travou.
 * Melhor mostrar a mensagem do servidor na hora.
 */
const fila = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
})

createRoot(raiz).render(
    <StrictMode>
        <QueryClientProvider client={fila}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </QueryClientProvider>
    </StrictMode>
)
