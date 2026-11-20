-- A base viva: artigos DERIVADOS do repositório do produto, regenerados a cada
-- mudança em `main`, e artigos SUGERIDOS a partir do atendimento.
--
-- Nada aqui apaga ou reescreve linha existente: colunas novas com default ou
-- nulas, tabelas novas, e a troca de dimensão de uma coluna que nunca foi
-- escrita. Todo artigo que já existe passa a ser `MANUAL`, que é o que ele era.

-- De onde o artigo veio. Decide quem pode editá-lo (só o manual) e como ele se
-- mantém atual (o derivado é refeito pela sincronização; o sugerido espera uma
-- pessoa aprovar).
CREATE TYPE "kb_origem" AS ENUM ('MANUAL', 'DERIVADO', 'SUGERIDO');

ALTER TABLE "kb_articles"
    ADD COLUMN "origem" "kb_origem" NOT NULL DEFAULT 'MANUAL',
    -- Chave estável do artigo derivado dentro do app (`derivado:faq:<slug>`).
    -- Nula no manual. É o que faz a re-sincronização ser um upsert e não uma
    -- duplicata.
    ADD COLUMN "chave" TEXT,
    -- De onde saiu: {repositorio, caminhos, sha, commit, versaoDoExtrator,
    -- extraidoPor} no derivado; {ticketId} ou {lacuna} no sugerido.
    ADD COLUMN "fonte" JSONB,
    -- O JSON estruturado de que o corpo foi renderizado. Permite re-renderizar
    -- sem re-extrair, e é de onde "Novidades" continua a lista anterior.
    ADD COLUMN "dados" JSONB,
    ADD COLUMN "sincronizado_em" TIMESTAMP(3),
    -- `agent:<id>` quando uma pessoa fixou o status de um artigo derivado
    -- (despublicou). A sincronização não mexe no status de artigo fixado.
    ADD COLUMN "status_fixado_por" TEXT;

CREATE UNIQUE INDEX "kb_articles_app_id_chave_key" ON "kb_articles"("app_id", "chave");
CREATE INDEX "kb_articles_app_id_origem_status_idx" ON "kb_articles"("app_id", "origem", "status");

-- O embedding passa a 1024 dimensões: é o tamanho do `bge-m3` do Workers AI,
-- escolhido em 19/11/2026 por não exigir chave nova. A coluna nunca foi escrita,
-- então a troca de tipo não toca dado nenhum.
ALTER TABLE "kb_articles" ALTER COLUMN "embedding" TYPE vector(1024);
CREATE INDEX "kb_articles_embedding_idx" ON "kb_articles" USING hnsw ("embedding" vector_cosine_ops);

-- Onde o app mora dentro do monorepo (`apps/odontobox360`), e a chave pública
-- com que o app confere o token que o Desk assina para `consultar_conta`.
ALTER TABLE "apps"
    ADD COLUMN "pasta_no_repositorio" TEXT,
    ADD COLUMN "chave_publica_do_desk" JSONB;

-- Uma sincronização: um app, um commit, o que aconteceu.
CREATE TABLE "kb_sincronizacoes" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "repositorio" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    -- 'cron' ou 'agent:<id>'.
    "pedida_por" TEXT NOT NULL,
    "forcada" BOOLEAN NOT NULL DEFAULT false,
    -- pedida | em_andamento | aguardando_lote | concluida | falhou
    "estado" TEXT NOT NULL DEFAULT 'pedida',
    -- O lote do Message Batches, enquanto a extração espera o modelo.
    "lote_id" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciada_em" TIMESTAMP(3),
    "terminada_em" TIMESTAMP(3),
    "resultado" JSONB,
    "erro" TEXT,

    CONSTRAINT "kb_sincronizacoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kb_sincronizacoes_app_id_criada_em_idx" ON "kb_sincronizacoes"("app_id", "criada_em");
CREATE INDEX "kb_sincronizacoes_app_id_commit_sha_idx" ON "kb_sincronizacoes"("app_id", "commit_sha");

ALTER TABLE "kb_sincronizacoes" ADD CONSTRAINT "kb_sincronizacoes_app_id_fkey"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A trilha dos artigos. Artigo não tem chamado, então não cabe em
-- `ticket_events`. `artigo_id` sem chave estrangeira, pelo mesmo motivo de
-- `kb_consultas.artigo_lido_id`: o evento sobrevive ao artigo.
CREATE TABLE "kb_eventos" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "artigo_id" TEXT NOT NULL,
    "ator" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_eventos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kb_eventos_app_id_artigo_id_criado_em_idx" ON "kb_eventos"("app_id", "artigo_id", "criado_em");

ALTER TABLE "kb_eventos" ADD CONSTRAINT "kb_eventos_app_id_fkey"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
