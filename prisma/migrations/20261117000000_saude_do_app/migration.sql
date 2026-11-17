-- Endereços do app: o público, e o que a verificação de saúde consulta.
-- Ambos nulos por omissão: app sem url_saude não é verificado, que é como um
-- app novo entra sem disparar incidente antes de existir.
ALTER TABLE "apps" ADD COLUMN "url_app" TEXT;
ALTER TABLE "apps" ADD COLUMN "url_saude" TEXT;
