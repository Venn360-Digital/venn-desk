import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { api, type ChamadoNaFila } from '../api.ts'
import { Quando, Selo, Vazio } from '../componentes/ui.tsx'

/**
 * A fila de um app. Sem paginação e sem filtro na Fase 1 de propósito: visões
 * salvas, SLA em risco e recorte por tenant são Fase 7, e inventá-los agora
 * seria desenhar sem ver a operação funcionando.
 *
 * A ordem vem do servidor — atualizado mais recente primeiro — porque é a ordem
 * em que um atendente trabalha.
 */
export function Fila() {
    const { app } = useParams<{ app: string }>()

    const { data, isPending, error } = useQuery({
        queryKey: ['fila', app],
        queryFn: () => api<{ chamados: ChamadoNaFila[] }>(`/${app}/fila`),
        refetchInterval: 20_000,
    })

    if (isPending) return <Vazio>carregando…</Vazio>
    if (error) return <Vazio>{error.message}</Vazio>

    const chamados = data?.chamados ?? []
    if (chamados.length === 0) return <Vazio>Nenhum chamado em aberto neste app.</Vazio>

    return (
        <table className="w-full text-sm">
            <thead>
                <tr className="border-b border-borda text-left text-xs text-tinta-fraca">
                    <th className="py-2 font-medium">Número</th>
                    <th className="py-2 font-medium">Assunto</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Prioridade</th>
                    <th className="py-2 font-medium">Nível</th>
                    <th className="py-2 font-medium">Atualizado</th>
                </tr>
            </thead>
            <tbody>
                {chamados.map((c) => (
                    <tr key={c.numero} className="border-b border-borda/60 hover:bg-white">
                        <td className="py-2 font-mono text-xs">
                            <Link to={`/app/${app}/chamados/${c.numero.split('-')[1]}`} className="text-destaque hover:underline">
                                {c.numero}
                            </Link>
                        </td>
                        <td className="max-w-md truncate py-2">{c.assunto}</td>
                        <td className="py-2"><Selo>{c.status}</Selo></td>
                        <td className="py-2"><Selo>{c.prioridade}</Selo></td>
                        <td className="py-2 text-xs text-tinta-fraca">{c.nivel}</td>
                        <td className="py-2"><Quando iso={c.atualizadoEm} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
