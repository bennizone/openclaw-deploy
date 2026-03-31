import { execFile } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Convert any audio buffer to OGG/Opus using ffmpeg.
 * Used for both STT input (m4a/webm → ogg) and TTS output (mp3 → ogg).
 */
export async function audioToOggOpus(inputBuffer: Buffer, inputExt: string = "mp3"): Promise<Buffer> {
  const id = randomBytes(8).toString("hex");
  const inputPath = join(tmpdir(), `ha-voice-in-${id}.${inputExt}`);
  const outputPath = join(tmpdir(), `ha-voice-out-${id}.ogg`);

  await writeFile(inputPath, inputBuffer);

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-i", inputPath,
          "-c:a", "libopus",
          "-b:a", "32k",
          "-vbr", "on",
          "-compression_level", "10",
          "-application", "voip",
          "-y",
          outputPath,
        ],
        { timeout: 15_000 },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(`ffmpeg failed: ${error.message}\n${stderr}`));
          } else {
            resolve();
          }
        },
      );
    });

    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/**
 * Convert an MP3 buffer to OGG/Opus using ffmpeg.
 * WhatsApp requires OGG/Opus for voice note playback (ptt: true).
 */
export async function mp3ToOggOpus(mp3Buffer: Buffer): Promise<Buffer> {
  const id = randomBytes(8).toString("hex");
  const inputPath = join(tmpdir(), `ha-voice-in-${id}.mp3`);
  const outputPath = join(tmpdir(), `ha-voice-out-${id}.ogg`);

  await writeFile(inputPath, mp3Buffer);

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-i", inputPath,
          "-c:a", "libopus",
          "-b:a", "32k",
          "-vbr", "on",
          "-compression_level", "10",
          "-application", "voip",
          "-y",
          outputPath,
        ],
        { timeout: 15_000 },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(`ffmpeg failed: ${error.message}\n${stderr}`));
          } else {
            resolve();
          }
        },
      );
    });

    return await readFile(outputPath);
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
