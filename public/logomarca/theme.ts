export type VennTheme = "system" | "light" | "dark";
export const VENN_THEME_STORAGE_KEY = "venn360-theme";

export function applyVennTheme(theme: VennTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  try {
    if (typeof window !== "undefined") {
      if (theme === "system") window.localStorage.removeItem(VENN_THEME_STORAGE_KEY);
      else window.localStorage.setItem(VENN_THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
}

export function readVennTheme(): VennTheme {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(VENN_THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export const VENN_AREAS = {
  TI: { key: "ti", label: "Consultoria e Auditoria de TI", accentToken: "--vds-ti" },
  MKT: { key: "mkt", label: "Marketing de Performance", accentToken: "--vds-mkt" },
  SIS: { key: "sis", label: "Arquitetura e Desenvolvimento de Sistemas", accentToken: "--vds-sis" },
  INT: { key: "int", label: "Oferta integrada", accentToken: "--vds-int" },
} as const;
