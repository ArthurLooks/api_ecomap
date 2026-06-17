-- Ecomap Database Schema
-- Run with: psql -U postgres -f schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop tables if exist (for clean setup)
DROP TABLE IF EXISTS inscricao_missao CASCADE;
DROP TABLE IF EXISTS notificacoes CASCADE;
DROP TABLE IF EXISTS fila_sync_offline CASCADE;
DROP TABLE IF EXISTS apoios CASCADE;
DROP TABLE IF EXISTS ocorrencias CASCADE;
DROP TABLE IF EXISTS missoes_gamificacao CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

-- Enums
DO $$ BEGIN
  CREATE TYPE role_usuario AS ENUM ('CIDADAO', 'GESTOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE status_ocorrencia AS ENUM ('ABERTA', 'EM_ANALISE', 'EM_ANDAMENTO', 'RESOLVIDA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE categoria_ocorrencia AS ENUM ('LIXO_ENTULHO', 'BURACO_VIA', 'ARVORE_RISCO', 'VAZAMENTO_AGUA', 'ILUMINACAO_PUBLICA', 'OUTROS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela de Usuários
CREATE TABLE usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  role role_usuario NOT NULL DEFAULT 'CIDADAO',
  xp_atual INTEGER DEFAULT 0,
  titulo_nivel VARCHAR(100) DEFAULT 'Novato Cívico',
  departamento VARCHAR(255),
  matricula VARCHAR(100),
  data_cadastro TIMESTAMP DEFAULT NOW(),
  ativo BOOLEAN DEFAULT TRUE
);

-- Tabela de Ocorrências
CREATE TABLE ocorrencias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cidadao_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  gestor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  descricao TEXT,
  categoria categoria_ocorrencia NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  foto_url VARCHAR(500),
  foto_resolucao_url VARCHAR(500),
  status status_ocorrencia DEFAULT 'ABERTA',
  total_apoios INTEGER DEFAULT 0,
  ticket_erp_id VARCHAR(100),
  data_abertura TIMESTAMP DEFAULT NOW(),
  data_atualizacao TIMESTAMP DEFAULT NOW()
);

-- Índice espacial aproximado
CREATE INDEX idx_ocorrencias_localizacao ON ocorrencias(latitude, longitude);
CREATE INDEX idx_ocorrencias_status ON ocorrencias(status);
CREATE INDEX idx_ocorrencias_categoria ON ocorrencias(categoria);
CREATE INDEX idx_ocorrencias_data ON ocorrencias(data_abertura DESC);

-- Tabela de Apoios (upvotes)
CREATE TABLE apoios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ocorrencia_id UUID NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  cidadao_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em TIMESTAMP DEFAULT NOW(),
  UNIQUE(ocorrencia_id, cidadao_id)
);

-- Tabela de Notificações
CREATE TABLE notificacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ocorrencia_id UUID REFERENCES ocorrencias(id) ON DELETE SET NULL,
  titulo VARCHAR(255) NOT NULL,
  mensagem TEXT NOT NULL,
  lida BOOLEAN DEFAULT FALSE,
  data_envio TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notificacoes_usuario ON notificacoes(usuario_id, lida);

-- Tabela de Fila de Sincronização Offline
CREATE TABLE fila_sync_offline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cidadao_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  payload_json JSONB NOT NULL,
  data_captura TIMESTAMP NOT NULL,
  tentativas INTEGER DEFAULT 0,
  processada BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMP DEFAULT NOW()
);

-- Tabela de Missões
CREATE TABLE missoes_gamificacao (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT NOT NULL,
  condicao_conclusao TEXT NOT NULL,
  categoria_alvo categoria_ocorrencia,
  quantidade_alvo INTEGER NOT NULL DEFAULT 1,
  recompensa_xp INTEGER NOT NULL,
  ativa BOOLEAN DEFAULT TRUE,
  data_criacao TIMESTAMP DEFAULT NOW()
);

-- Tabela de Inscrições em Missões (progresso)
CREATE TABLE inscricao_missao (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cidadao_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  missao_id UUID NOT NULL REFERENCES missoes_gamificacao(id) ON DELETE CASCADE,
  progresso INTEGER DEFAULT 0,
  concluida BOOLEAN DEFAULT FALSE,
  data_inscricao TIMESTAMP DEFAULT NOW(),
  data_conclusao TIMESTAMP,
  UNIQUE(cidadao_id, missao_id)
);

-- Trigger para atualizar data_atualizacao
CREATE OR REPLACE FUNCTION update_data_atualizacao()
RETURNS TRIGGER AS $$
BEGIN
  NEW.data_atualizacao = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_ocorrencias_update
  BEFORE UPDATE ON ocorrencias
  FOR EACH ROW EXECUTE FUNCTION update_data_atualizacao();

-- Seed: Missões padrão
INSERT INTO missoes_gamificacao (titulo, descricao, condicao_conclusao, categoria_alvo, quantidade_alvo, recompensa_xp) VALUES
('Boas-vindas Cívicas', 'Registre sua primeira ocorrência na cidade.', 'Registrar 1 ocorrência', NULL, 1, 50),
('Combate à Dengue', 'Identifique 3 focos de lixo acumulado.', 'Registrar 3 ocorrências de Lixo/Entulho', 'LIXO_ENTULHO', 3, 150),
('Caça-Buracos', 'Reporte 5 buracos nas vias.', 'Registrar 5 ocorrências de Buraco na Via', 'BURACO_VIA', 5, 200),
('Guardião das Árvores', 'Sinalize 2 árvores em risco.', 'Registrar 2 ocorrências de Árvore em Risco', 'ARVORE_RISCO', 2, 120),
('Vigilante da Iluminação', 'Identifique 3 pontos de iluminação pública com problemas.', 'Registrar 3 ocorrências de Iluminação Pública', 'ILUMINACAO_PUBLICA', 3, 130),
('Herói da Cidade', 'Registre 10 ocorrências no total.', 'Registrar 10 ocorrências', NULL, 10, 500);

-- Seed: Usuário Admin (Gestor)
INSERT INTO usuarios (nome, email, senha_hash, role, departamento, matricula) VALUES
('Admin Gestor', 'gestor@ecomap.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'GESTOR', 'Infraestrutura Urbana', 'GES-001'),
('admin3', 'admin3@ecomap.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'CIDADAO', NULL, NULL);

-- password for both: 'password'
