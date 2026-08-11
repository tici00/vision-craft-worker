import type { NextFunction, Request, Response } from "express";

export function requireWorkerToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.VIDEO_WORKER_TOKEN;
  const received = req.header("x-worker-token");

  if (!expected) {
    return res.status(500).json({
      ok: false,
      error: "VIDEO_WORKER_TOKEN não está configurado."
    });
  }

  if (!received || received !== expected) {
    return res.status(401).json({
      ok: false,
      error: "Token do worker inválido."
    });
  }

  next();
}
