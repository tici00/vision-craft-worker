import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 30 * 60 * 1000);
const MAX_STDERR_CHARS = 4000;

function tail(value: string, max = MAX_STDERR_CHARS) {
  return value.length <= max ? value : value.slice(-max);
}

function run(command: string, args: string[], timeoutMs = FFMPEG_TIMEOUT_MS) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    let lastProgressLog = 0;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // FFmpeg progress is deliberately sampled so Render logs stay useful
      // without being flooded by one line per frame.
      if (text.includes("out_time_ms=") || text.includes("progress=")) {
        const now = Date.now();
        if (now - lastProgressLog >= 15000 || text.includes("progress=end")) {
          lastProgressLog = now;
          const match = text.match(/out_time_ms=(\d+)/);
          const seconds = match ? Number(match[1]) / 1_000_000 : null;
          console.log(
            `[ffmpeg] progress elapsed=${Math.round((now - startedAt) / 1000)}s${
              seconds != null ? ` output=${Math.round(seconds)}s` : ""
            }`,
          );
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = tail(stderr + chunk.toString());
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`FFmpeg excedeu o tempo limite de ${Math.round(timeoutMs / 60000)} minutos.`)));
    }, timeoutMs);

    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code, signal) => {
      if (code === 0) {
        console.log(`[ffmpeg] completed elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`);
        finish(resolve);
      } else {
        const reason = signal ? `sinal ${signal}` : `código ${code}`;
        finish(() => reject(new Error(`${command} falhou (${reason}): ${tail(stderr, 1500)}`)));
      }
    });
  });
}

export async function getFfmpegVersion() {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-version"]);
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output.split("\n")[0] || "FFmpeg disponível");
      else reject(new Error("FFmpeg não está disponível."));
    });
  });
}

export async function extractAudio(input: string, output: string) {
  await run("ffmpeg", [
    "-y",
    "-i", input,
    "-vn",
    "-acodec", "libmp3lame",
    "-q:a", "4",
    output,
  ]);
}

export async function renderClip(input: string, output: string, start: number, end: number) {
  const duration = end - start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || duration <= 0) {
    throw new Error("Intervalo de corte inválido.");
  }

  console.log(
    `[ffmpeg] render start=${start.toFixed(3)} end=${end.toFixed(3)} duration=${duration.toFixed(3)}s`,
  );

  await run("ffmpeg", [
    "-y",
    "-ss", String(start),
    "-i", input,
    "-t", String(duration),
    "-c:v", "libx264",
    "-preset", process.env.FFMPEG_PRESET || "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    output,
  ]);

  const stat = await fs.stat(output).catch(() => null);
  if (!stat || stat.size === 0) {
    throw new Error("FFmpeg terminou sem produzir um arquivo de vídeo válido.");
  }
}
