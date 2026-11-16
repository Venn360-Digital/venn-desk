import type { ReactNode } from 'react'

/**
 * Primitivos do Console. Escritos à mão, no idioma do shadcn/ui (mesmos tokens,
 * mesmas classes utilitárias), em vez de instalar os componentes: o Console
 * mínimo da Fase 1 usa quatro deles. Quando a tela crescer — tabelas com
 * ordenação, diálogos, combobox — vale trazer o shadcn de verdade, e nada aqui
 * atravanca essa troca.
 */

export function Botao({
    children,
    onClick,
    tipo = 'button',
    variante = 'solido',
    desabilitado,
}: {
    children: ReactNode
    onClick?: () => void
    tipo?: 'button' | 'submit'
    variante?: 'solido' | 'leve' | 'perigo'
    desabilitado?: boolean
}) {
    const estilos = {
        solido: 'bg-destaque text-white hover:opacity-90',
        leve: 'border border-borda bg-white text-tinta hover:bg-fundo',
        perigo: 'border border-urgente text-urgente hover:bg-urgente/5',
    }[variante]

    return (
        <button
            type={tipo}
            onClick={onClick}
            disabled={desabilitado}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${estilos}`}
        >
            {children}
        </button>
    )
}

export function Campo({
    rotulo,
    valor,
    onChange,
    tipo = 'text',
    requerido,
}: {
    rotulo: string
    valor: string
    onChange: (v: string) => void
    tipo?: string
    requerido?: boolean
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-medium text-tinta-fraca">{rotulo}</span>
            <input
                type={tipo}
                value={valor}
                required={requerido}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-md border border-borda bg-white px-3 py-2 text-sm outline-none focus:border-destaque"
            />
        </label>
    )
}

const CORES: Record<string, string> = {
    NOVO: 'bg-destaque/10 text-destaque',
    ABERTO: 'bg-destaque/10 text-destaque',
    AGUARDANDO_USUARIO: 'bg-atencao/15 text-atencao',
    EM_ESPERA: 'bg-atencao/15 text-atencao',
    RESOLVIDO: 'bg-calmo/15 text-calmo',
    FECHADO: 'bg-tinta/10 text-tinta-fraca',
    URGENTE: 'bg-urgente/10 text-urgente',
    ALTA: 'bg-atencao/15 text-atencao',
    NORMAL: 'bg-tinta/5 text-tinta-fraca',
    BAIXA: 'bg-tinta/5 text-tinta-fraca',
}

export function Selo({ children }: { children: string }) {
    const cor = CORES[children] ?? 'bg-tinta/5 text-tinta-fraca'
    return (
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cor}`}>
            {children.toLowerCase().replace(/_/g, ' ')}
        </span>
    )
}

export function Aviso({ children }: { children: ReactNode }) {
    return (
        <p className="rounded-md border border-urgente/30 bg-urgente/5 px-3 py-2 text-sm text-urgente">
            {children}
        </p>
    )
}

export function Vazio({ children }: { children: ReactNode }) {
    return <p className="py-10 text-center text-sm text-tinta-fraca">{children}</p>
}

/** Data e hora no fuso de quem olha, curtas — a fila é lida de relance. */
export function Quando({ iso }: { iso: string }) {
    const d = new Date(iso)
    return (
        <time dateTime={iso} title={d.toLocaleString('pt-BR')} className="text-xs text-tinta-fraca">
            {d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </time>
    )
}
