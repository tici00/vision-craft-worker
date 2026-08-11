import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import healthRouter from "./routes/health.js";
import mediaRouter from "./routes/media.js";

const app = express();
const port = Number(process.env.PORT || 10000);
const tempDir = process.env.TEMP_DIR || "/tmp/vision-craft";

await fs.mkdir(tempDir, { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use("/health", healthRouter);
app.use("/media", express.static(path.join(tempDir, "outputs")));
app.use("/", mediaRouter);

app.listen(port, "0.0.0.0", () => {
  console.log(`Vision Craft Worker rodando na porta ${port}`);
});
