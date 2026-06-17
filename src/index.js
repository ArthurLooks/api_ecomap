import express from "express";
import cors from "cors";
import path from "path";
import process from "node:process";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import ocorrenciasRoutes from "./routes/ocorrencias.js";
import notificacoesRoutes from "./routes/notificacoes.js";
import perfilRoutes from "./routes/perfil.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT;

// Middlewares globais
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Servir uploads estáticos
app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));

// Rotas da API
app.use("/api/auth", authRoutes);
app.use("/api/ocorrencias", ocorrenciasRoutes);
app.use("/api/notificacoes", notificacoesRoutes);
app.use("/api/perfil", perfilRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

// Error handler global
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

app.listen(PORT, () => {
  console.log(`🌱 Ecomap Backend rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV}`);
});

export default app;
