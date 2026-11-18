import Script from "next/script";

/** Place once in the root layout to avoid a flash of the wrong theme before hydration. */
export function ThemeBootstrap() {
  const code = `try { var t = localStorage.getItem('venn360-theme'); document.documentElement.dataset.theme = (t === 'light' || t === 'dark') ? t : 'system'; } catch (_) { document.documentElement.dataset.theme = 'system'; }`;
  return <Script id="venn360-theme-bootstrap" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: code }} />;
}
