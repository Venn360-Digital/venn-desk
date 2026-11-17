-- Saúde dos apps (seção 7). Duas tabelas com papéis diferentes: `health_states`
-- guarda o veredito corrente de cada app e é SOBRESCRITA; `health_episodes`
-- guarda os intervalos de queda e só recebe escrita quando o estado muda.

CREATE TABLE "health_states" (
    "app_id" TEXT NOT NULL,
    "saudavel" BOOLEAN NOT NULL,
    "falhas_seguidas" INTEGER NOT NULL DEFAULT 0,
    "desde_em" TIMESTAMP(3) NOT NULL,
    "verificado_em" TIMESTAMP(3) NOT NULL,
    "latencia_ms" INTEGER,
    "detalhe" TEXT,

    CONSTRAINT "health_states_pkey" PRIMARY KEY ("app_id")
);

CREATE TABLE "health_episodes" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "iniciado_em" TIMESTAMP(3) NOT NULL,
    "terminado_em" TIMESTAMP(3),
    "detalhe" TEXT,
    "problem_id" TEXT,

    CONSTRAINT "health_episodes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "health_episodes_app_id_iniciado_em_idx" ON "health_episodes"("app_id", "iniciado_em");

ALTER TABLE "health_states" ADD CONSTRAINT "health_states_app_id_fkey"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "health_episodes" ADD CONSTRAINT "health_episodes_app_id_fkey"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "health_episodes" ADD CONSTRAINT "health_episodes_problem_id_fkey"
    FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;
