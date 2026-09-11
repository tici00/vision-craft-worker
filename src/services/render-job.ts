import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { downloadVideo } from "./download.js";
import { renderClip } from "./ffmpeg.js";
import { findJob, saveJob, updateJob } from "./job-store.js";

type ClipInput = { start: number; end: number; name?: string };
type ClipStatus = ClipInput & { id: string; status: 'queued' | 'rendering' | 'completed' | 'failed'; url?: string; error?: string };

type RenderJob = {
  id: string;
  status: 'queued' | 'downloading' | 'rendering' | 'completed' | 'partial' | 'failed';
  progress: number;
  total: number;
  completed: number;
  failed: number;
  createdAt: string;
  updatedAt: string;
  clips: ClipStatus[];
  error?: string;
};

const sourceUrls = new Map<string, string>();
const tempDir = process.env.TEMP_DIR || '/tmp/vision-craft';

function publicMediaUrl(protocol: string, host: string, id: string) {
  return `${protocol}://${host}/media/${id}.mp4`;
}

function updateProgress(job: RenderJob) {
  job.completed = job.clips.filter((clip) => clip.status === 'completed').length;
  job.failed = job.clips.filter((clip) => clip.status === 'failed').length;
  job.progress = job.total === 0 ? 100 : Math.round(((job.completed + job.failed) / job.total) * 100);
  job.updatedAt = new Date().toISOString();
  updateJob(job);
}

export function getRenderJob(id: string) {
  return findJob<RenderJob>(id);
}

export function createRenderJob(videoUrl: string, clips: ClipInput[], protocol: string, host: string) {
  if (!videoUrl) throw new Error('Informe videoUrl.');
  if (!Array.isArray(clips) || clips.length === 0) throw new Error('Informe pelo menos um corte em clips.');

  for (const [index, clip] of clips.entries()) {
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || !(clip.end > clip.start)) {
      throw new Error(`Corte inválido na posição ${index}.`);
    }
  }

  const id = uuid();
  const now = new Date().toISOString();
  const job: RenderJob = {
    id,
    status: 'queued',
    progress: 0,
    total: clips.length,
    completed: 0,
    failed: 0,
    createdAt: now,
    updatedAt: now,
    clips: clips.map((clip) => ({ ...clip, id: uuid(), status: 'queued' }))
  };

  sourceUrls.set(id, videoUrl);
  saveJob(job);
  void processRenderJob(job, videoUrl, protocol, host);
  return job;
}

export function retryFailedClips(jobId: string, protocol: string, host: string) {
  const job = findJob<RenderJob>(jobId);
  const videoUrl = sourceUrls.get(jobId);
  if (!job || !videoUrl) throw new Error('Job não encontrado ou fonte indisponível.');

  const failed = job.clips.filter((clip) => clip.status === 'failed');
  if (failed.length === 0) throw new Error('O job não possui cortes com falha para repetir.');

  failed.forEach((clip) => {
    clip.status = 'queued';
    delete clip.error;
  });
  job.error = undefined;
  job.status = 'queued';
  updateProgress(job);
  void processRenderJob(job, videoUrl, protocol, host);
  return job;
}

async function processRenderJob(job: RenderJob, videoUrl: string, protocol: string, host: string) {
  const jobDir = path.join(tempDir, 'jobs', job.id);
  const outputDir = path.join(tempDir, 'outputs');

  try {
    await fs.mkdir(outputDir, { recursive: true });
    job.status = 'downloading';
    job.error = undefined;
    updateJob(job);
    const sourceFile = await downloadVideo(videoUrl, jobDir);

    job.status = 'rendering';
    updateJob(job);

    for (const clip of job.clips) {
      if (clip.status === 'completed') continue;
      clip.status = 'rendering';
      updateJob(job);

      try {
        const outputId = uuid();
        const outputFile = path.join(outputDir, `${outputId}.mp4`);
        await renderClip(sourceFile, outputFile, clip.start, clip.end);
        clip.status = 'completed';
        clip.id = outputId;
        clip.url = publicMediaUrl(protocol, host, outputId);
        delete clip.error;
      } catch (error) {
        clip.status = 'failed';
        clip.error = error instanceof Error ? error.message : 'Falha ao renderizar o corte.';
      }
      updateProgress(job);
    }

    job.status = job.failed === 0 ? 'completed' : job.completed > 0 ? 'partial' : 'failed';
    updateProgress(job);
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Falha ao processar o job.';
    job.clips.forEach((clip) => {
      if (clip.status === 'queued' || clip.status === 'rendering') {
        clip.status = 'failed';
        clip.error = job.error;
      }
    });
    updateProgress(job);
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
