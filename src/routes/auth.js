import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { generateToken } from "../middleware/auth.js";

const router = Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { nome, email, senha } = req.body;

  if (!nome || !email || !senha) {
    return res
      .status(400)
      .json({ error: "Campos obrigatórios: nome, email, senha" });
  }

  try {
    const existing = await query("SELECT id FROM usuarios WHERE email = $1", [
      email,
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "E-mail já cadastrado" });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const result = await query(
      `INSERT INTO usuarios (nome, email, senha_hash, role)
       VALUES ($1, $2, $3, 'CIDADAO')
       RETURNING id, nome, email, role, xp_atual, titulo_nivel, data_cadastro`,
      [nome, email, senhaHash],
    );

    const user = result.rows[0];

    // Inscrever nas missões ativas
    const missoes = await query(
      "SELECT id FROM missoes_gamificacao WHERE ativa = TRUE",
    );
    for (const missao of missoes.rows) {
      await query(
        "INSERT INTO inscricao_missao (cidadao_id, missao_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [user.id, missao.id],
      );
    }

    const token = generateToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
  }

  try {
    const result = await query(
      "SELECT * FROM usuarios WHERE email = $1 AND ativo = TRUE",
      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(senha, user.senha_hash);

    if (!valid) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const token = generateToken(user);
    const { senha_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const jwt = await import("jsonwebtoken");
    const decoded = jwt.default.verify(
      token,
      process.env.JWT_SECRET || "ecomap_secret_key_2024",
    );
    const result = await query(
      "SELECT id, nome, email, role, xp_atual, titulo_nivel, departamento, matricula, data_cadastro FROM usuarios WHERE id = $1",
      [decoded.id],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Usuário não encontrado" });
    res.json(result.rows[0]);
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
});

export default router;
