import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'

import { api, SessaoExpirada, type Agente } from './api.ts'
import { Entrar } from './paginas/Entrar.tsx'
import { Fila } from './paginas/Fila.tsx'
import { Chamado } from './paginas/Chamado.tsx'
import { Apps } from './paginas/Apps.tsx'
import { Portal } from './paginas/Portal.tsx'
import { Sla } from './paginas/Sla.tsx'
import { Credenciais } from './paginas/Credenciais.tsx'
import { Aparencia } from './paginas/Aparencia.tsx'
import { Base } from './paginas/Base.tsx'
import { Shell } from './componentes/Shell.tsx'
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

/** O título da barra superior. Sai da rota, para não repetir em cada página. */
function tituloDaRota(caminho: string): string {
    if (caminho.startsWith('/metas')) return 'Metas de atendimento'
    if (caminho.startsWith('/credenciais')) return 'Credenciais do MCP'
    if (caminho.startsWith('/base')) return 'Base de conhecimento'
    if (caminho.startsWith('/aparencia')) return 'Aparência do widget'
    if (caminho.startsWith('/apps')) return 'Apps'
    if (caminho.includes('/chamados/')) return 'Chamado'
    return 'Fila de atendimento'
}

function Console() {
    const local = useLocation()
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

    async function sair() {
        await api('/sessao', { metodo: 'DELETE' }).catch(() => {})
        setSessao(null)
    }

    if (sessao === 'carregando') return <Vazio>carregando…</Vazio>
    if (sessao === null) return <Entrar aoEntrar={() => void conferirSessao()} />

    return (
        <Shell agente={sessao} titulo={tituloDaRota(local.pathname)} aoSair={() => void sair()}>
            <Routes>
                <Route path="/" element={<Fila />} />
                <Route
                    path="/app/:app/chamados/:numero"
                    element={<Chamado papel={sessao.papel} />}
                />
                <Route path="/metas" element={<Sla papel={sessao.papel} />} />
                <Route path="/metas/:app" element={<Sla papel={sessao.papel} />} />
                <Route path="/credenciais" element={<Credenciais papel={sessao.papel} />} />
                <Route path="/credenciais/:app" element={<Credenciais papel={sessao.papel} />} />
                <Route path="/base" element={<Base papel={sessao.papel} />} />
                <Route path="/base/:app" element={<Base papel={sessao.papel} />} />
                <Route path="/aparencia" element={<Aparencia papel={sessao.papel} />} />
                <Route path="/aparencia/:app" element={<Aparencia papel={sessao.papel} />} />
                <Route path="/apps" element={<Apps papel={sessao.papel} />} />
                {/* O caminho antigo, de quando a fila era por app. */}
                <Route path="/app/:app" element={<Navigate to="/" replace />} />
                <Route path="/app/:app/sla" element={<ParaMetas />} />
                <Route path="*" element={<Vazio>Página não encontrada.</Vazio>} />
            </Routes>
        </Shell>
    )
}

/** Favorito antigo de `/app/<slug>/sla` continua funcionando. */
function ParaMetas() {
    const { app } = useParams<{ app: string }>()
    return <Navigate to={`/metas/${app ?? ''}`} replace />
}
