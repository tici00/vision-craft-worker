import { spawn } from "node:child_process";

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} falhou (código ${code}): ${stderr.slice(-1500)}`));
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
    "-preset", "medium",
    "-crf", "20",
    "-c:a", "aac",
    "-movflags", "+faststart",
    output
  ]);
}
