import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
import { randomBytes } from "node:crypto";

const VIDEO_MIME_TO_EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
};

async function processVideoForFastStart(inputFilePath: string) {
  const processedFilePath = `${inputFilePath}.processed`;
  const proc = Bun.spawn([
    "ffmpeg",
    "-i",
    inputFilePath,
    "-movflags",
    "faststart",
    "-map_metadata",
    "0",
    "-codec",
    "copy",
    "-f",
    "mp4",
    processedFilePath
  ])

  await proc.exited;
  if (proc.exitCode != 0) {
    const stderrText = await new Response(proc.stderr).text();
    throw new BadRequestError(`Invalid video file, issue processing for fast start: ${stderrText}`);
  }

  return processedFilePath;
}

async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,sample_aspect_ratio",
    "-of",
    "json",
    filePath
  ], {
    stdout: "pipe",
    stderr: "pipe"
  });

  // Wait for the process to finish
  await proc.exited;
  if (proc.exitCode != 0) {
    const stderrText = await new Response(proc.stderr).text();
    throw new BadRequestError(`Invalid video file, issue getting aspect ratio: ${stderrText}`);
  }

  const stdoutText = await new Response(proc.stdout).text();
  const jsonData = JSON.parse(stdoutText);
  const width = jsonData.streams[0].width;
  const height = jsonData.streams[0].height;

  if (Math.floor(16 * (width / 9)) == height) {
    return "portrait";
  } else if (Math.floor(9 * (width / 16)) == height) {
    return "landscape";
  } else {
    return "other";
  }
}

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new BadRequestError("Couldn't find video");
  }

  if (video.userID !== userID) {
    throw new BadRequestError("You don't have permission to upload this video");
  }

  console.log("uploading video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("video") as File | null;
  if (!file) {
    throw new BadRequestError("No video file provided");
  }

  const MAX_UPLOAD_SIZE = 1 << 30 // 1 GB limit
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video file is too large, must be under 1 GB");
  }
  
  const extension = VIDEO_MIME_TO_EXTENSION[file.type];
  if (!extension) {
    throw new BadRequestError("Only MP4 videos are supported");
  }

  const filename = `${randomBytes(32).toString("base64url")}.${extension}`;
  const savePath = `${cfg.assetsRoot}/${filename}`;

  // Write temporary file to disk
  await Bun.write(savePath, file);
  const prefix = await getVideoAspectRatio(savePath);

  // Process it for fast start
  const newSavePath = await processVideoForFastStart(savePath);

  // Create s3 file and write from the temporary file
  const s3File = cfg.s3Client.file(`/${prefix}/${filename}`);
  await s3File.write(Bun.file(newSavePath), {
    type: file.type,
  });

  // Delete the temporary files
  await Bun.file(savePath).delete();
  await Bun.file(newSavePath).delete();

  // Update the video record with the CloudFront domain
  const videoURL = `${cfg.s3CfDistribution}/${prefix}/${filename}`;
  updateVideo(cfg.db, {
    ...video,
    videoURL,
  });

  const updatedVideo = {...video, videoURL};
  return respondWithJSON(200, updatedVideo);
}

