"use client";

import { useEffect, useState } from "react";
import { applyVennTheme, readVennTheme, type VennTheme } from "../theme";

const options: Array<{ value: VennTheme; label: string }> = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<VennTheme>("system");

  useEffect(() => {
    const saved = readVennTheme();
    setTheme(saved);
    applyVennTheme(saved);
  }, []);

  function chooseTheme(value: VennTheme) {
    setTheme(value);
    applyVennTheme(value);
  }

  return (
    <div className={`vds-theme-switch${compact ? " vds-theme-switch--compact" : ""}`} role="group" aria-label="Tema de aparência">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={theme === option.value}
          onClick={() => chooseTheme(option.value)}
          title={`Usar tema ${option.label.toLowerCase()}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
