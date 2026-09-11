import { Router } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { requireWorkerToken } from "../services/auth.js";
import { extractAudio, renderClip } from "../services/ffmpeg.js";
import { createRenderJob, getRenderJob, retryFailedClips } from "../services/render-job.js";

const router = Router();
const tempDir = process.env.TEMP_DIR || "/tmp/vision-craft";
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 2048);

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(tempDir, "uploads");
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${uuid()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
  }
});

const upload = multer({ storage, limits: { fileSize: maxUploadMb * 1024 * 1024 } });

router.post("/extract-audio", requireWorkerToken, upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Envie o arquivo no campo multipart 'video'." });
  try {
    const outputDir = path.join(tempDir, "outputs");
    await fs.mkdir(outputDir, { recursive: true });
    const id = uuid();
    const outputFile = path.join(outputDir, `${id}.mp3`);
    await extractAudio(req.file.path, outputFile);
    return res.json({ ok: true, audioId: id, audioUrl: `${req.protocol}://${req.get("host")}/media/${id}.mp3` });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Falha ao extrair áudio" });
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
});

router.post("/render-jobs", requireWorkerToken, async (req, res) => {
  try {
    const { videoUrl, clips } = req.body || {};
    const job = createRenderJob(videoUrl, clips, req.protocol, req.get("host") || "");
    return res.status(202).json({ ok: true, jobId: job.id, job });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Falha ao criar job de renderização" });
  }
});

router.get("/render-jobs/:id", requireWorkerToken, (req, res) => {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = getRenderJob(jobId);
  if (!job) return res.status(404).json({ ok: false, error: "Job não encontrado." });
  return res.json({ ok: true, job });
});

router.post("/render-jobs/:id/retry", requireWorkerToken, (req, res) => {
  try {
    const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const job = retryFailedClips(jobId, req.protocol, req.get("host") || "");
    return res.status(202).json({ ok: true, jobId: job.id, job });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Falha ao repetir os cortes" });
  }
});

router.post("/render-clips", requireWorkerToken, upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Envie o arquivo no campo multipart 'video'." });
  let clips: Array<{ start: number; end: number; name?: string }>;
  try {
    clips = JSON.parse(String(req.body.clips || "[]"));
    if (!Array.isArray(clips) || clips.length === 0) return res.status(400).json({ ok: false, error: "Informe pelo menos um corte em 'clips'." });
  } catch {
    return res.status(400).json({ ok: false, error: "O campo 'clips' precisa conter JSON válido." });
  }
  try {
    const outputDir = path.join(tempDir, "outputs");
    await fs.mkdir(outputDir, { recursive: true });
    const results = [];
    for (const [index, clip] of clips.entries()) {
      if (!(clip.end > clip.start) || clip.start < 0) throw new Error(`Corte inválido na posição ${index}.`);
      const id = uuid();
      const outputFile = path.join(outputDir, `${id}.mp4`);
      await renderClip(req.file.path, outputFile, clip.start, clip.end);
      results.push({ id, start: clip.start, end: clip.end, url: `${req.protocol}://${req.get("host")}/media/${id}.mp4` });
    }
    return res.json({ ok: true, clips: results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Falha ao renderizar os cortes" });
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
});

export default router;
