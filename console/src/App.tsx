import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api, SessaoExpirada, type Agente, type AppCadastrado } from './api.ts'
import { Entrar } from './paginas/Entrar.tsx'
import { Fila } from './paginas/Fila.tsx'
import { Chamado } from './paginas/Chamado.tsx'
import { Apps } from './paginas/Apps.tsx'
import { Portal } from './paginas/Portal.tsx'
import { Vazio } from './componentes/ui.tsx'

/**
 * O Console. Uma SPA porque é tela interna, atrás de login, sem SEO e sem SSR
 * (ADR 0008) — e porque assim ela builda e roda nesta máquina, onde o Worker
 * não roda.
 */
export function App() {
    const local = useLocation()

    /**
     * O portal de contingência sai ANTES da sessão, e isso não é otimização: é
     * o requisito. Ele é a central de suporte de quem não consegue entrar em
     * lugar nenhum, e pedir sessão de agente a um cliente seria exigir
     * justamente a porta que está fechada.
     *
     * A ramificação fica aqui, com `App` sem nenhum outro hook, para a ordem
     * dos hooks do Console não depender da rota.
     */
    if (local.pathname.startsWith('/portal/')) {
        return (
            <Routes>
                <Route path="/portal/:app" element={<Portal />} />
            </Routes>
        )
    }

    return <Console />
}

function Console() {
    const [sessao, setSessao] = useState<Agente | null | 'carregando'>('carregando')

    async function conferirSessao() {
        try {
            const r = await api<{ agente: Agente }>('/sessao')
            setSessao(r.agente)
        } catch (erro) {
            setSessao(erro instanceof SessaoExpirada ? null : null)
        }
    }

    useEffect(() => {
        void conferirSessao()
    }, [])

    if (sessao === 'carregando') return <Vazio>carregando…</Vazio>
    if (sessao === null) return <Entrar aoEntrar={() => void conferirSessao()} />

    return <Dentro agente={sessao} aoSair={() => setSessao(null)} />
}

function Dentro({ agente, aoSair }: { agente: Agente; aoSair: () => void }) {
    const { data } = useQuery({
        queryKey: ['apps'],
        queryFn: () => api<{ apps: AppCadastrado[] }>('/apps'),
    })
    const apps = data?.apps ?? []

    async function sair() {
        await api('/sessao', { metodo: 'DELETE' }).catch(() => {})
        aoSair()
    }

    return (
        <div className="min-h-screen">
            <header className="border-b border-borda bg-white">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
                    <Link to="/" className="font-semibold">
                        Venn Desk
                    </Link>
                    <nav className="flex flex-wrap items-center gap-3 text-sm">
                        {apps.map((app) => (
                            <AbaDoApp key={app.slug} slug={app.slug} nome={app.nome} />
                        ))}
                        <Link to="/apps" className="text-tinta-fraca hover:text-tinta">
                            Apps
                        </Link>
                    </nav>
                    <div className="ml-auto flex items-center gap-3 text-xs text-tinta-fraca">
                        <span>
                            {agente.nome} · {agente.papel.toLowerCase()}
                        </span>
                        <button onClick={() => void sair()} className="hover:text-tinta hover:underline">
                            sair
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl px-4 py-6">
                <Routes>
                    <Route
                        path="/"
                        element={
                            apps[0] ? <Navigate to={`/app/${apps[0].slug}`} replace /> : <Vazio>Nenhum app cadastrado.</Vazio>
                        }
                    />
                    <Route path="/app/:app" element={<Fila />} />
                    <Route path="/app/:app/chamados/:numero" element={<Chamado />} />
                    <Route path="/apps" element={<Apps papel={agente.papel} />} />
                    <Route path="*" element={<Vazio>Página não encontrada.</Vazio>} />
                </Routes>
            </main>
        </div>
    )
}

function AbaDoApp({ slug, nome }: { slug: string; nome: string }) {
    const local = useLocation()
    const ativo = local.pathname.startsWith(`/app/${slug}`)
    return (
        <Link
            to={`/app/${slug}`}
            className={ativo ? 'font-medium text-destaque' : 'text-tinta-fraca hover:text-tinta'}
        >
            {nome}
        </Link>
    )
}

/** Exportado só para o roteador não reclamar de import não usado em dev. */
export { useParams }
