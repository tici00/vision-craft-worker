import { spawn } from "node:child_process";

const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 30 * 60 * 1000);
const MAX_STDERR_CHARS = 4000;

function tail(value: string, max = MAX_STDERR_CHARS) {
  return value.length <= max ? value : value.slice(-max);
}

function run(command: string, args: string[], timeoutMs = FFMPEG_TIMEOUT_MS) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = tail(stderr + chunk.toString());
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`FFmpeg excedeu o tempo limite de ${Math.round(timeoutMs / 60000)} minutos.`)));
    }, timeoutMs);

    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      if (code === 0) finish(resolve);
      else finish(() => reject(new Error(`${command} falhou (código ${code}): ${tail(stderr, 1500)}`)));
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
    output
  ]);
}

export async function renderClip(input: string, output: string, start: number, end: number) {
  const duration = end - start;

  await run("ffmpeg", [
    "-y",
    "-ss", String(start),
    "-i", input,
    "-t", String(duration),
    "-c:v", "libx264",
    "-preset", process.env.FFMPEG_PRESET || "medium",
    "-crf", "20",
    "-c:a", "aac",
    "-movflags", "+faststart",
    output
  ]);
}
