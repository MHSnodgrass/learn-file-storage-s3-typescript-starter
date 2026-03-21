import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "node:path";
import { randomBytes } from "node:crypto";

const THUMBNAIL_MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail") as File | null;
  if (!file) {
    throw new BadRequestError("No thumbnail file provided");
  }

  const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file is too large");
  }

  const data = await file.arrayBuffer();
  const video = getVideo(cfg.db, videoId);

  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (video.userID !== userID) {
    throw new UserForbiddenError("You don't have permission to upload a thumbnail for this video");
  }

  // Convert ArrayBuffer to Buffer
  const buffer = Buffer.from(data);

  const extension = THUMBNAIL_MIME_TO_EXTENSION[file.type];
  if (!extension) {
    throw new BadRequestError("The Thumbnail needs to be either a JPEG or PNG");
  }

  const filename = `${randomBytes(32).toString("base64url")}.${extension}`;
  const savePath = path.join(cfg.assetsRoot, filename);

  // Save blob as a file
  await Bun.write(savePath, buffer);

  const thumbnailURL = new URL(`/assets/${filename}`, req.url).toString();

  updateVideo(cfg.db, {
    ...video,
    thumbnailURL,
  });

  return respondWithJSON(200, getVideo(cfg.db, videoId));
}
