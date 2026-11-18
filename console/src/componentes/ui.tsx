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
        solido: 'bg-destaque text-white hover:bg-destaque-forte',
        leve: 'border border-borda bg-superficie text-tinta hover:bg-superficie-2',
        perigo: 'border border-urgente text-urgente hover:bg-urgente-fundo',
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
                className="w-full rounded-sm border border-borda bg-superficie px-3 py-2 text-sm text-tinta outline-none focus:border-destaque"
            />
        </label>
    )
}

/**
 * Os pares cor/fundo vêm prontos da marca (`--vds-*-bg`), em vez de serem
 * derivados com transparência.
 *
 * `bg-urgente/10` parecia equivalente e não é: sobre fundo escuro, 10% de uma
 * cor clara dá um cinza lavado, e o par que a marca entrega já foi escolhido
 * para funcionar nos dois temas.
 */
const CORES: Record<string, string> = {
    NOVO: 'bg-informe-fundo text-informe',
    ABERTO: 'bg-informe-fundo text-informe',
    AGUARDANDO_USUARIO: 'bg-atencao-fundo text-atencao',
    EM_ESPERA: 'bg-atencao-fundo text-atencao',
    RESOLVIDO: 'bg-calmo-fundo text-calmo',
    FECHADO: 'bg-superficie-3 text-tinta-fraca',
    URGENTE: 'bg-urgente-fundo text-urgente',
    ALTA: 'bg-atencao-fundo text-atencao',
    NORMAL: 'bg-superficie-3 text-tinta-fraca',
    BAIXA: 'bg-superficie-3 text-tinta-fraca',
}

/**
 * O rótulo é escrito, não derivado do enum.
 *
 * `AGUARDANDO_USUARIO.toLowerCase().replace(/_/g,' ')` dava "aguardando
 * usuario" — sem acento, porque o enum do banco não tem. Derivar texto de
 * identificador economiza um mapa e entrega português errado na tela.
 */
const ROTULOS: Record<string, string> = {
    NOVO: 'novo',
    ABERTO: 'aberto',
    AGUARDANDO_USUARIO: 'aguardando usuário',
    EM_ESPERA: 'em espera',
    RESOLVIDO: 'resolvido',
    FECHADO: 'fechado',
    URGENTE: 'urgente',
    ALTA: 'alta',
    NORMAL: 'normal',
    BAIXA: 'baixa',
}

export function Selo({ children }: { children: string }) {
    const cor = CORES[children] ?? 'bg-superficie-3 text-tinta-fraca'
    return (
        <span
            className={`inline-block rounded-xs px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cor}`}
        >
            {ROTULOS[children] ?? children.toLowerCase().replace(/_/g, ' ')}
        </span>
    )
}

export function Aviso({ children }: { children: ReactNode }) {
    return (
        <p className="rounded-sm border border-urgente/30 bg-urgente-fundo px-3 py-2 text-sm text-urgente">
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
