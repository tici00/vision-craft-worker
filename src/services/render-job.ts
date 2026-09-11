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

// The worker is intentionally single-job at a time. FFmpeg is CPU-heavy and
// running several long renders concurrently on a small instance causes severe
// contention and makes otherwise healthy jobs appear stuck.
let renderQueue = Promise.resolve();

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

function enqueueRenderJob(job: RenderJob, videoUrl: string, protocol: string, host: string) {
  renderQueue = renderQueue
    .catch(() => {})
    .then(() => processRenderJob(job, videoUrl, protocol, host));
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
  console.log(`[render-job] queued id=${id} clips=${clips.length}`);
  enqueueRenderJob(job, videoUrl, protocol, host);
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
  console.log(`[render-job] retry queued id=${jobId} clips=${failed.length}`);
  enqueueRenderJob(job, videoUrl, protocol, host);
  return job;
}

async function processRenderJob(job: RenderJob, videoUrl: string, protocol: string, host: string) {
  const jobDir = path.join(tempDir, 'jobs', job.id);
  const outputDir = path.join(tempDir, 'outputs');
  const startedAt = Date.now();

  try {
    await fs.mkdir(outputDir, { recursive: true });
    job.status = 'downloading';
    job.error = undefined;
    updateJob(job);
    console.log(`[render-job] start id=${job.id} clips=${job.total}`);

    const sourceFile = await downloadVideo(videoUrl, jobDir);

    job.status = 'rendering';
    updateJob(job);
    console.log(`[render-job] source-ready id=${job.id}`);

    for (const clip of job.clips) {
      if (clip.status === 'completed') continue;
      clip.status = 'rendering';
      updateJob(job);
      console.log(`[render-job] clip-start job=${job.id} start=${clip.start.toFixed(3)} end=${clip.end.toFixed(3)}`);

      try {
        const outputId = uuid();
        const outputFile = path.join(outputDir, `${outputId}.mp4`);
        await renderClip(sourceFile, outputFile, clip.start, clip.end);
        clip.status = 'completed';
        clip.id = outputId;
        clip.url = publicMediaUrl(protocol, host, outputId);
        delete clip.error;
        console.log(`[render-job] clip-complete job=${job.id} output=${outputId}`);
      } catch (error) {
        clip.status = 'failed';
        clip.error = error instanceof Error ? error.message : 'Falha ao renderizar o corte.';
        console.error(`[render-job] clip-failed job=${job.id} error=${clip.error}`);
      }
      updateProgress(job);
    }

    job.status = job.failed === 0 ? 'completed' : job.completed > 0 ? 'partial' : 'failed';
    updateProgress(job);
    console.log(`[render-job] finished id=${job.id} status=${job.status} completed=${job.completed} failed=${job.failed} elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`);
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Falha ao processar o job.';
    console.error(`[render-job] failed id=${job.id} error=${job.error}`);
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
