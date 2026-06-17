import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// GET /api/perfil/gamificacao - XP, missões, título
router.get('/gamificacao', authenticate, async (req, res) => {
  try {
    const user = await query(
      'SELECT xp_atual, titulo_nivel FROM usuarios WHERE id = $1',
      [req.user.id]
    );

    const missoes = await query(
      `SELECT mg.id, mg.titulo, mg.descricao, mg.recompensa_xp, mg.quantidade_alvo,
              im.progresso, im.concluida
       FROM inscricao_missao im
       JOIN missoes_gamificacao mg ON mg.id = im.missao_id
       WHERE im.cidadao_id = $1 AND mg.ativa = TRUE
       ORDER BY im.concluida ASC, mg.recompensa_xp DESC`,
      [req.user.id]
    );

    const NIVEIS = [
      { titulo: 'Novato Cívico', min: 0, proximo: 'Vigilante', xpProximo: 50 },
      { titulo: 'Vigilante', min: 50, proximo: 'Guardião do Bairro', xpProximo: 200 },
      { titulo: 'Guardião do Bairro', min: 200, proximo: 'Protetor da Cidade', xpProximo: 500 },
      { titulo: 'Protetor da Cidade', min: 500, proximo: 'Herói Urbano', xpProximo: 1000 },
      { titulo: 'Herói Urbano', min: 1000, proximo: 'Lenda Cívica', xpProximo: 2000 },
      { titulo: 'Lenda Cívica', min: 2000, proximo: null, xpProximo: null },
    ];

    const xp = user.rows[0]?.xp_atual || 0;
    const nivelAtual = NIVEIS.reduce((acc, n) => xp >= n.min ? n : acc, NIVEIS[0]);

    res.json({
      xpAtual: xp,
      tituloNivel: user.rows[0]?.titulo_nivel,
      proximoNivel: nivelAtual.proximo,
      xpParaProximo: nivelAtual.xpProximo ? nivelAtual.xpProximo - xp : 0,
      missoes: missoes.rows
    });
  } catch (err) {
    console.error('Gamificacao error:', err);
    res.status(500).json({ error: 'Erro ao buscar dados de gamificação' });
  }
});

// GET /api/perfil/ranking
router.get('/ranking', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT nome, titulo_nivel, xp_atual,
              ROW_NUMBER() OVER (ORDER BY xp_atual DESC) as posicao
       FROM usuarios
       WHERE role = 'CIDADAO' AND ativo = TRUE
       ORDER BY xp_atual DESC
       LIMIT 10`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar ranking' });
  }
});

export default router;
