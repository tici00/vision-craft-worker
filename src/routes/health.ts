import { Router } from "express";
import { getFfmpegVersion } from "../services/ffmpeg.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const ffmpegVersion = await getFfmpegVersion();
    res.json({
      ok: true,
      service: "vision-craft-worker",
      ffmpeg: ffmpegVersion,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      service: "vision-craft-worker",
      error: error instanceof Error ? error.message : "Erro desconhecido"
    });
  }
});

export default router;
