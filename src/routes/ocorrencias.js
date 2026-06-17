import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// Helpers
const NIVEL_XP = [
  { titulo: 'Novato Cívico', min: 0 },
  { titulo: 'Vigilante', min: 50 },
  { titulo: 'Guardião do Bairro', min: 200 },
  { titulo: 'Protetor da Cidade', min: 500 },
  { titulo: 'Herói Urbano', min: 1000 },
  { titulo: 'Lenda Cívica', min: 2000 },
];

const getTituloNivel = (xp) => {
  let titulo = NIVEL_XP[0].titulo;
  for (const nivel of NIVEL_XP) {
    if (xp >= nivel.min) titulo = nivel.titulo;
  }
  return titulo;
};

const atualizarXPeMissoes = async (cidadaoId, categoria) => {
  // XP base por ocorrência
  const XP_POR_OCORRENCIA = 10;

  // Atualizar XP
  const xpResult = await query(
    'UPDATE usuarios SET xp_atual = xp_atual + $1 WHERE id = $2 RETURNING xp_atual',
    [XP_POR_OCORRENCIA, cidadaoId]
  );
  const novoXP = xpResult.rows[0]?.xp_atual || 0;
  const novoTitulo = getTituloNivel(novoXP);
  await query('UPDATE usuarios SET titulo_nivel = $1 WHERE id = $2', [novoTitulo, cidadaoId]);

  // Atualizar progresso nas missões
  const inscricoes = await query(
    `SELECT im.id, im.progresso, mg.quantidade_alvo, mg.recompensa_xp, mg.categoria_alvo
     FROM inscricao_missao im
     JOIN missoes_gamificacao mg ON mg.id = im.missao_id
     WHERE im.cidadao_id = $1 AND im.concluida = FALSE AND mg.ativa = TRUE`,
    [cidadaoId]
  );

  for (const inscricao of inscricoes.rows) {
    const categoriaMatch = !inscricao.categoria_alvo || inscricao.categoria_alvo === categoria;
    if (categoriaMatch) {
      const novoProgresso = inscricao.progresso + 1;
      if (novoProgresso >= inscricao.quantidade_alvo) {
        await query(
          'UPDATE inscricao_missao SET progresso = $1, concluida = TRUE, data_conclusao = NOW() WHERE id = $2',
          [novoProgresso, inscricao.id]
        );
        await query(
          'UPDATE usuarios SET xp_atual = xp_atual + $1 WHERE id = $2',
          [inscricao.recompensa_xp, cidadaoId]
        );
        // Notificação de missão concluída
        await query(
          `INSERT INTO notificacoes (usuario_id, titulo, mensagem) VALUES ($1, $2, $3)`,
          [cidadaoId, '🏆 Missão Concluída!', `Você completou a missão e ganhou ${inscricao.recompensa_xp} XP!`]
        );
      } else {
        await query(
          'UPDATE inscricao_missao SET progresso = $1 WHERE id = $2',
          [novoProgresso, inscricao.id]
        );
      }
    }
  }
};

// GET /api/ocorrencias - listar todas (com filtros)
router.get('/', authenticate, async (req, res) => {
  const { status, categoria, lat, lng, raio = 10, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    let whereConditions = [];
    let params = [];
    let paramIdx = 1;

    if (status) {
      whereConditions.push(`o.status = $${paramIdx++}`);
      params.push(status);
    }
    if (categoria) {
      whereConditions.push(`o.categoria = $${paramIdx++}`);
      params.push(categoria);
    }

    // Filtro por raio geográfico simples (aproximação)
    if (lat && lng) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      const raioNum = parseFloat(raio);
      const latDelta = raioNum / 111;
      const lngDelta = raioNum / (111 * Math.cos(latNum * Math.PI / 180));
      whereConditions.push(`o.latitude BETWEEN $${paramIdx} AND $${paramIdx + 1}`);
      params.push(latNum - latDelta, latNum + latDelta);
      paramIdx += 2;
      whereConditions.push(`o.longitude BETWEEN $${paramIdx} AND $${paramIdx + 1}`);
      params.push(lngNum - lngDelta, lngNum + lngDelta);
      paramIdx += 2;
    }

    const where = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) FROM ocorrencias o ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT o.id, o.descricao, o.categoria, o.latitude, o.longitude,
              o.foto_url, o.foto_resolucao_url, o.status, o.total_apoios,
              o.data_abertura, o.data_atualizacao, o.ticket_erp_id,
              u.nome as cidadao_nome
       FROM ocorrencias o
       JOIN usuarios u ON u.id = o.cidadao_id
       ${where}
       ORDER BY o.data_abertura DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('List ocorrencias error:', err);
    res.status(500).json({ error: 'Erro ao listar ocorrências' });
  }
});

// GET /api/ocorrencias/feed - feed da vizinhança
router.get('/feed', authenticate, async (req, res) => {
  const { lat, lng, raio = 5 } = req.query;
  try {
    let whereConditions = ["o.status != 'CANCELADA'"];
    let params = [];
    let paramIdx = 1;

    if (lat && lng) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      const raioNum = parseFloat(raio);
      const latDelta = raioNum / 111;
      const lngDelta = raioNum / (111 * Math.cos(latNum * Math.PI / 180));
      whereConditions.push(`o.latitude BETWEEN $${paramIdx} AND $${paramIdx + 1}`);
      params.push(latNum - latDelta, latNum + latDelta);
      paramIdx += 2;
      whereConditions.push(`o.longitude BETWEEN $${paramIdx} AND $${paramIdx + 1}`);
      params.push(lngNum - lngDelta, lngNum + lngDelta);
      paramIdx += 2;
    }

    const where = `WHERE ${whereConditions.join(' AND ')}`;

    const result = await query(
      `SELECT o.id, o.descricao, o.categoria, o.latitude, o.longitude,
              o.foto_url, o.status, o.total_apoios, o.data_abertura,
              CASE WHEN a.cidadao_id IS NOT NULL THEN TRUE ELSE FALSE END as apoiou
       FROM ocorrencias o
       LEFT JOIN apoios a ON a.ocorrencia_id = o.id AND a.cidadao_id = $${paramIdx}
       ${where}
       ORDER BY o.data_abertura DESC
       LIMIT 50`,
      [...params, req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Feed error:', err);
    res.status(500).json({ error: 'Erro ao carregar feed' });
  }
});

// GET /api/ocorrencias/minhas - ocorrências do cidadão logado
router.get('/minhas', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, descricao, categoria, latitude, longitude, foto_url,
              foto_resolucao_url, status, total_apoios, data_abertura, data_atualizacao
       FROM ocorrencias
       WHERE cidadao_id = $1
       ORDER BY data_abertura DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Minhas ocorrencias error:', err);
    res.status(500).json({ error: 'Erro ao buscar suas ocorrências' });
  }
});

// GET /api/ocorrencias/stats - estatísticas para o gestor
router.get('/stats', authenticate, requireRole('GESTOR'), async (req, res) => {
  try {
    const stats = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ABERTA') as total_abertas,
        COUNT(*) FILTER (WHERE status = 'EM_ANALISE') as total_em_analise,
        COUNT(*) FILTER (WHERE status = 'EM_ANDAMENTO') as total_em_andamento,
        COUNT(*) FILTER (WHERE status = 'RESOLVIDA') as total_resolvidas,
        COUNT(*) as total_geral,
        categoria,
        COUNT(*) as total_categoria
      FROM ocorrencias
      GROUP BY categoria
    `);

    const totais = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ABERTA') as abertas,
        COUNT(*) FILTER (WHERE status = 'EM_ANALISE') as em_analise,
        COUNT(*) FILTER (WHERE status = 'EM_ANDAMENTO') as em_andamento,
        COUNT(*) FILTER (WHERE status = 'RESOLVIDA') as resolvidas,
        COUNT(*) as total
      FROM ocorrencias
    `);

    const porCategoria = await query(`
      SELECT categoria, COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'RESOLVIDA') as resolvidas
      FROM ocorrencias
      GROUP BY categoria
      ORDER BY total DESC
    `);

    const recentes = await query(`
      SELECT o.id, o.categoria, o.status, o.data_abertura, o.total_apoios, u.nome as cidadao_nome
      FROM ocorrencias o JOIN usuarios u ON u.id = o.cidadao_id
      ORDER BY o.data_abertura DESC LIMIT 10
    `);

    res.json({
      totais: totais.rows[0],
      porCategoria: porCategoria.rows,
      recentes: recentes.rows
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// GET /api/ocorrencias/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT o.*, u.nome as cidadao_nome,
              g.nome as gestor_nome
       FROM ocorrencias o
       JOIN usuarios u ON u.id = o.cidadao_id
       LEFT JOIN usuarios g ON g.id = o.gestor_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ocorrência não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar ocorrência' });
  }
});

// POST /api/ocorrencias
router.post('/', authenticate, requireRole('CIDADAO'), async (req, res) => {
  const { descricao, categoria, latitude, longitude, foto_url } = req.body;

  if (!categoria || !latitude || !longitude) {
    return res.status(400).json({ error: 'Campos obrigatórios: categoria, latitude, longitude' });
  }

  try {
    const result = await query(
      `INSERT INTO ocorrencias (cidadao_id, descricao, categoria, latitude, longitude, foto_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, descricao, categoria, latitude, longitude, foto_url]
    );

    const ocorrencia = result.rows[0];

    // Atualizar XP e missões
    await atualizarXPeMissoes(req.user.id, categoria);

    // Notificação de criação
    await query(
      'INSERT INTO notificacoes (usuario_id, ocorrencia_id, titulo, mensagem) VALUES ($1, $2, $3, $4)',
      [req.user.id, ocorrencia.id, '✅ Ocorrência registrada!', `Sua ocorrência de ${categoria.replace('_', ' ')} foi registrada com sucesso.`]
    );

    res.status(201).json(ocorrencia);
  } catch (err) {
    console.error('Create ocorrencia error:', err);
    res.status(500).json({ error: 'Erro ao criar ocorrência' });
  }
});

// PATCH /api/ocorrencias/:id/status - atualizar status (gestor)
router.patch('/:id/status', authenticate, requireRole('GESTOR'), async (req, res) => {
  const { status, foto_resolucao_url } = req.body;
  const statusValidos = ['ABERTA', 'EM_ANALISE', 'EM_ANDAMENTO', 'RESOLVIDA', 'CANCELADA'];

  if (!statusValidos.includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  try {
    let updateQuery = 'UPDATE ocorrencias SET status = $1, gestor_id = $2';
    let params = [status, req.user.id];

    if (status === 'RESOLVIDA' && foto_resolucao_url) {
      updateQuery += ', foto_resolucao_url = $3 WHERE id = $4 RETURNING *';
      params.push(foto_resolucao_url, req.params.id);
    } else {
      updateQuery += ' WHERE id = $3 RETURNING *, cidadao_id';
      params.push(req.params.id);
    }

    const result = await query(updateQuery, params);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Ocorrência não encontrada' });

    const oc = result.rows[0];

    // Notificar cidadão sobre mudança de status
    const mensagens = {
      'EM_ANALISE': 'Sua ocorrência está sendo analisada pela equipe.',
      'EM_ANDAMENTO': 'Uma equipe foi designada para resolver sua ocorrência!',
      'RESOLVIDA': '🎉 Sua ocorrência foi resolvida! Veja a foto da resolução.',
      'CANCELADA': 'Sua ocorrência foi cancelada pela equipe gestora.',
    };

    if (mensagens[status] && oc.cidadao_id) {
      await query(
        'INSERT INTO notificacoes (usuario_id, ocorrencia_id, titulo, mensagem) VALUES ($1, $2, $3, $4)',
        [oc.cidadao_id, oc.id, `Status atualizado: ${status.replace('_', ' ')}`, mensagens[status]]
      );

      // Bônus XP quando resolvida
      if (status === 'RESOLVIDA') {
        await query('UPDATE usuarios SET xp_atual = xp_atual + 20 WHERE id = $1', [oc.cidadao_id]);
      }
    }

    res.json(oc);
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

// POST /api/ocorrencias/:id/apoiar
router.post('/:id/apoiar', authenticate, requireRole('CIDADAO'), async (req, res) => {
  try {
    await query(
      'INSERT INTO apoios (ocorrencia_id, cidadao_id) VALUES ($1, $2)',
      [req.params.id, req.user.id]
    );
    await query(
      'UPDATE ocorrencias SET total_apoios = total_apoios + 1 WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'Apoio registrado' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Você já apoiou esta ocorrência' });
    res.status(500).json({ error: 'Erro ao registrar apoio' });
  }
});

// DELETE /api/ocorrencias/:id/apoiar
router.delete('/:id/apoiar', authenticate, requireRole('CIDADAO'), async (req, res) => {
  try {
    await query('DELETE FROM apoios WHERE ocorrencia_id = $1 AND cidadao_id = $2', [req.params.id, req.user.id]);
    await query('UPDATE ocorrencias SET total_apoios = GREATEST(total_apoios - 1, 0) WHERE id = $1', [req.params.id]);
    res.json({ message: 'Apoio removido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover apoio' });
  }
});

export default router;
