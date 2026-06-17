import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// GET /api/notificacoes
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, ocorrencia_id, titulo, mensagem, lida, data_envio
       FROM notificacoes
       WHERE usuario_id = $1
       ORDER BY data_envio DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar notificações' });
  }
});

// PATCH /api/notificacoes/:id/lida
router.patch('/:id/lida', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE notificacoes SET lida = TRUE WHERE id = $1 AND usuario_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Notificação marcada como lida' });
  } catch {
    res.status(500).json({ error: 'Erro ao marcar notificação' });
  }
});

// PATCH /api/notificacoes/todas/lida
router.patch('/todas/lida', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE notificacoes SET lida = TRUE WHERE usuario_id = $1',
      [req.user.id]
    );
    res.json({ message: 'Todas marcadas como lidas' });
  } catch {
    res.status(500).json({ error: 'Erro ao marcar notificações' });
  }
});

export default router;
