/**
 * Claro, escuro ou o do sistema — o `theme.ts` que veio com a marca, adaptado.
 *
 * O original é de um app Next e usa a mesma chave de armazenamento
 * (`venn360-theme`) e o mesmo atributo (`data-theme`) que o `tokens.css`
 * espera. Mantive os dois nomes: trocar qualquer um faria o Console divergir
 * do resto da Venn360 sem ganho nenhum.
 *
 * O padrão é `system`, como o estudo visual recomenda.
 */
export type Tema = 'system' | 'light' | 'dark'

export const CHAVE_DO_TEMA = 'venn360-theme'

export function aplicarTema(tema: Tema): void {
    document.documentElement.dataset['theme'] = tema
    try {
        if (tema === 'system') localStorage.removeItem(CHAVE_DO_TEMA)
        else localStorage.setItem(CHAVE_DO_TEMA, tema)
    } catch {
        /// Aba anônima com armazenamento bloqueado: o tema vale esta visita.
    }
}

export function lerTema(): Tema {
    try {
        const valor = localStorage.getItem(CHAVE_DO_TEMA)
        return valor === 'light' || valor === 'dark' ? valor : 'system'
    } catch {
        return 'system'
    }
}
