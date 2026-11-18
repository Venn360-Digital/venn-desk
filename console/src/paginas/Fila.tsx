import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, ChevronsUp, Minus, Search, X } from 'lucide-react'

import { api, type ChamadoNaFila, type OpcoesDeFiltro, type Prioridade } from '../api.ts'
import { Quando, Selo, Vazio } from '../componentes/ui.tsx'
import { SeloDeSla } from '../componentes/sla.tsx'

/**
 * A fila — UMA, com os três apps juntos.
 *
 * Era uma fila por app, escolhida numa aba do cabeçalho. O atendente é um só e
 * atende os três produtos: separar obrigava a passear pelas abas para saber
 * onde estava o fogo, e escondia o caso mais comum — a manhã em que o urgente
 * está no app que não está na tela. O app virou coluna, que é o que ele é: um
 * atributo do chamado, não um modo da tela.
 *
 * **Todo filtro vai ao servidor.** Filtrar no cliente mostraria "nenhum
 * resultado" quando o que houve foi a lista vir cortada no teto.
 */

const STATUS_ABERTOS = ['NOVO', 'ABERTO', 'AGUARDANDO_USUARIO', 'EM_ESPERA']

const RECORTES = [
    { chave: '', rotulo: 'Em aberto' },
    { chave: 'em_risco', rotulo: 'SLA em risco' },
    { chave: 'estourado', rotulo: 'Prazo estourado' },
] as const

interface Filtros {
    sla: string
    app: string
    empresa: string
    conta: string
    status: string
    prioridade: string
    numero: string
}

const VAZIO: Filtros = {
    sla: '',
    app: '',
    empresa: '',
    conta: '',
    status: '',
    prioridade: '',
    numero: '',
}

export function Fila() {
    const [filtros, setFiltros] = useState<Filtros>(VAZIO)
    const [numeroDigitado, setNumeroDigitado] = useState('')

    const opcoes = useQuery({
        queryKey: ['filtros'],
        queryFn: () => api<OpcoesDeFiltro>('/filtros'),
        staleTime: 5 * 60_000,
    })

    const busca = new URLSearchParams(
        Object.entries(filtros).filter(([, v]) => v !== '')
    ).toString()

    const { data, isPending, error } = useQuery({
        queryKey: ['fila', busca],
        queryFn: () => api<{ chamados: ChamadoNaFila[] }>(`/fila${busca === '' ? '' : `?${busca}`}`),
        refetchInterval: 20_000,
    })

    const mudar = (campo: keyof Filtros, valor: string) =>
        setFiltros((atual) => ({ ...atual, [campo]: valor }))

    /// As empresas e as contas são por app: com um app escolhido, só as dele
    /// aparecem. Sem app, aparecem todas — e é aí que a lista pode ficar longa.
    const empresas = (opcoes.data?.empresas ?? []).filter(
        (e) => filtros.app === '' || e.app === filtros.app
    )
    const contas = (opcoes.data?.contas ?? []).filter(
        (ct) => filtros.app === '' || ct.app === filtros.app
    )

    const chamados = data?.chamados ?? []
    const algumFiltro = Object.values(filtros).some((v) => v !== '')

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1">
                {RECORTES.map(({ chave, rotulo }) => (
                    <button
                        key={chave}
                        onClick={() => mudar('sla', chave)}
                        aria-pressed={filtros.sla === chave}
                        className={
                            filtros.sla === chave
                                ? 'rounded-sm bg-tinta px-3 py-1.5 text-xs font-medium text-fundo'
                                : 'rounded-sm border border-borda bg-superficie px-3 py-1.5 text-xs text-tinta-fraca transition hover:text-tinta'
                        }
                    >
                        {rotulo}
                    </button>
                ))}

                <form
                    className="ml-auto flex items-center gap-1"
                    onSubmit={(e) => {
                        e.preventDefault()
                        mudar('numero', numeroDigitado.trim())
                    }}
                >
                    <div className="relative">
                        <Search
                            size={14}
                            aria-hidden
                            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tinta-sutil"
                        />
                        <input
                            value={numeroDigitado}
                            onChange={(e) => setNumeroDigitado(e.target.value)}
                            placeholder="Número (ODB-1042)"
                            aria-label="Buscar por número do chamado"
                            className="w-48 rounded-sm border border-borda bg-superficie py-1.5 pr-2 pl-8 text-xs outline-none focus:border-destaque"
                        />
                    </div>
                </form>
            </div>

            <div className="flex flex-wrap items-end gap-2">
                <Seletor
                    rotulo="App"
                    valor={filtros.app}
                    onChange={(v) => {
                        /// Trocar o app zera empresa e conta: a escolhida era
                        /// do app anterior e devolveria lista vazia sem dizer
                        /// por quê.
                        setFiltros((a) => ({ ...a, app: v, empresa: '', conta: '' }))
                    }}
                    opcoes={(opcoes.data?.apps ?? []).map((a) => ({ valor: a.slug, rotulo: a.nome }))}
                />
                <Seletor
                    rotulo="Conta"
                    valor={filtros.conta}
                    onChange={(v) => mudar('conta', v)}
                    opcoes={contas.map((ct) => ({ valor: ct.id, rotulo: ct.nome }))}
                    vazioPorque={contas.length === 0 ? 'nenhuma conta informada ainda' : undefined}
                />
                <Seletor
                    rotulo="Empresa"
                    valor={filtros.empresa}
                    onChange={(v) => mudar('empresa', v)}
                    opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))}
                />
                <Seletor
                    rotulo="Status"
                    valor={filtros.status}
                    onChange={(v) => mudar('status', v)}
                    opcoes={[...STATUS_ABERTOS, 'RESOLVIDO', 'FECHADO'].map((s) => ({
                        valor: s,
                        rotulo: s.toLowerCase().replace(/_/g, ' '),
                    }))}
                />
                <Seletor
                    rotulo="Prioridade"
                    valor={filtros.prioridade}
                    onChange={(v) => mudar('prioridade', v)}
                    opcoes={['URGENTE', 'ALTA', 'NORMAL', 'BAIXA'].map((p) => ({
                        valor: p,
                        rotulo: p.toLowerCase(),
                    }))}
                />

                {algumFiltro ? (
                    <button
                        onClick={() => {
                            setFiltros(VAZIO)
                            setNumeroDigitado('')
                        }}
                        className="flex items-center gap-1 px-1 py-1.5 text-xs text-tinta-fraca transition hover:text-tinta"
                    >
                        <X size={13} aria-hidden /> limpar
                    </button>
                ) : null}

                <span className="ml-auto text-xs text-tinta-sutil">
                    {isPending ? '…' : `${chamados.length} chamado${chamados.length === 1 ? '' : 's'}`}
                </span>
            </div>

            {error ? <Vazio>{error.message}</Vazio> : null}
            {isPending ? <Vazio>carregando…</Vazio> : null}

            {!isPending && !error && chamados.length === 0 ? (
                <Vazio>
                    {algumFiltro
                        ? 'Nenhum chamado com esses filtros.'
                        : 'Nenhum chamado em aberto em nenhum app.'}
                </Vazio>
            ) : null}

            {chamados.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-borda text-left text-xs text-tinta-sutil">
                                <th className="py-2 font-medium">Número</th>
                                <th className="py-2 font-medium">Empresa</th>
                                <th className="py-2 font-medium">Assunto</th>
                                <th className="py-2 font-medium">App</th>
                                <th className="py-2 font-medium">Status</th>
                                <th className="py-2 text-center font-medium">
                                    <span className="sr-only">Prioridade</span>
                                    <span aria-hidden title="Prioridade">
                                        !
                                    </span>
                                </th>
                                <th className="py-2 font-medium">Prazo</th>
                                <th className="py-2 font-medium">Atualizado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {chamados.map((c) => (
                                <tr
                                    key={`${c.app.slug}-${c.numero}`}
                                    className="border-b border-borda/60 transition hover:bg-superficie-2"
                                >
                                    <td className="py-2 font-mono text-xs whitespace-nowrap">
                                        <Link
                                            to={`/app/${c.app.slug}/chamados/${c.sequencial}`}
                                            className="text-destaque hover:underline"
                                        >
                                            {c.numero}
                                        </Link>
                                    </td>
                                    <td className="max-w-40 py-2">
                                        <div className="truncate" title={c.empresa.nome}>
                                            {c.empresa.nome}
                                        </div>
                                        {c.conta ? (
                                            <div
                                                className="truncate text-[11px] text-tinta-sutil"
                                                title={`Conta: ${c.conta.nome}`}
                                            >
                                                {c.conta.nome}
                                            </div>
                                        ) : null}
                                    </td>
                                    <td className="max-w-80 truncate py-2" title={c.assunto}>
                                        {c.assunto}
                                    </td>
                                    <td className="py-2 text-xs whitespace-nowrap text-tinta-fraca">
                                        {c.app.nome}
                                    </td>
                                    <td className="py-2">
                                        <Selo>{c.status}</Selo>
                                    </td>
                                    <td className="py-2 text-center">
                                        <IconeDePrioridade prioridade={c.prioridade} />
                                    </td>
                                    <td className="py-2 whitespace-nowrap">
                                        <SeloDeSla sla={c.sla} />
                                    </td>
                                    <td className="py-2 whitespace-nowrap">
                                        <Quando iso={c.atualizadoEm} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </div>
    )
}

/**
 * A prioridade como ícone.
 *
 * Economiza a largura que a palavra ocupava, e numa coluna estreita a FORMA é
 * lida antes do texto: a seta dupla salta de uma varredura vertical de um jeito
 * que "URGENTE" escrito não salta.
 *
 * Só o urgente e o alto recebem cor — a direção da marca manda a cor sinalizar,
 * não decorar, e normal e baixa são a maioria das linhas. Nenhum significado
 * fica APENAS na cor: a forma distingue os quatro em preto e branco, e cada um
 * tem nome acessível.
 */
const PRIORIDADES: Record<
    Prioridade,
    { Icone: typeof Minus; classe: string; rotulo: string }
> = {
    URGENTE: { Icone: ChevronsUp, classe: 'text-urgente', rotulo: 'Urgente' },
    ALTA: { Icone: ChevronUp, classe: 'text-atencao', rotulo: 'Alta' },
    NORMAL: { Icone: Minus, classe: 'text-tinta-sutil', rotulo: 'Normal' },
    BAIXA: { Icone: ChevronDown, classe: 'text-tinta-sutil', rotulo: 'Baixa' },
}

export function IconeDePrioridade({ prioridade }: { prioridade: Prioridade }) {
    const { Icone, classe, rotulo } = PRIORIDADES[prioridade] ?? PRIORIDADES.NORMAL

    return (
        <span title={`Prioridade: ${rotulo}`} className={`inline-flex ${classe}`}>
            <Icone size={16} strokeWidth={2.25} aria-hidden />
            <span className="sr-only">Prioridade: {rotulo}</span>
        </span>
    )
}

function Seletor({
    rotulo,
    valor,
    onChange,
    opcoes,
    vazioPorque,
}: {
    rotulo: string
    valor: string
    onChange: (v: string) => void
    opcoes: { valor: string; rotulo: string }[]
    vazioPorque?: string | undefined
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] text-tinta-sutil">{rotulo}</span>
            <select
                value={valor}
                onChange={(e) => onChange(e.target.value)}
                disabled={opcoes.length === 0 && vazioPorque !== undefined}
                className="min-w-32 rounded-sm border border-borda bg-superficie px-2 py-1.5 text-xs text-tinta outline-none focus:border-destaque disabled:text-tinta-sutil"
            >
                {/* O rótulo do "sem filtro" diz o que ele FAZ, não "—". */}
                <option value="">{vazioPorque ?? `todos`}</option>
                {opcoes.map((o) => (
                    <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                    </option>
                ))}
            </select>
        </label>
    )
}
