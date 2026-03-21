import { cfg } from "./config";
import { handlerLogin, handlerRefresh, handlerRevoke } from "./api/auth";
import {
  errorHandlingMiddleware,
  noCacheMiddleware,
  withConfig,
} from "./api/middleware";
import { handlerUsersCreate } from "./api/users";
import {
  handlerVideoGet,
  handlerVideoMetaCreate,
  handlerVideoMetaDelete,
  handlerVideosRetrieve,
} from "./api/video-meta";
import { handlerUploadVideo } from "./api/videos";
import { handlerUploadThumbnail } from "./api/thumbnails";
import { handlerReset } from "./api/reset";
import { ensureAssetsDir } from "./api/assets";
import spa from "./app/index.html";

ensureAssetsDir(cfg);

Bun.serve({
  port: Number(cfg.port),
  development: cfg.platform === "dev",
  routes: {
    "/": spa,
    "/api/login": {
      POST: withConfig(cfg, handlerLogin),
    },
    "/api/refresh": {
      POST: withConfig(cfg, handlerRefresh),
    },
    "/api/revoke": {
      POST: withConfig(cfg, handlerRevoke),
    },
    "/api/users": {
      POST: withConfig(cfg, handlerUsersCreate),
    },
    "/api/videos": {
      GET: withConfig(cfg, handlerVideosRetrieve),
      POST: withConfig(cfg, handlerVideoMetaCreate),
    },
    "/api/videos/:videoId": {
      GET: withConfig(cfg, handlerVideoGet),
      DELETE: withConfig(cfg, handlerVideoMetaDelete),
    },
    "/api/thumbnail_upload/:videoId": {
      POST: withConfig(cfg, handlerUploadThumbnail),
    },
    "/api/video_upload/:videoId": {
      POST: withConfig(cfg, handlerUploadVideo),
    },
    "/admin/reset": {
      POST: withConfig(cfg, handlerReset),
    },
  },

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path.startsWith("/assets")) {
      return noCacheMiddleware(() =>
        serveStaticFile(path.replace("/assets/", ""), cfg.assetsRoot)
      )(req);
    }

    return new Response("Not Found", { status: 404 });
  },

  error(err) {
    return errorHandlingMiddleware(cfg, err);
  },
});

console.log(`Server running at http://localhost:${cfg.port}`);

async function serveStaticFile(relativePath: string, basePath: string) {
  const filePath = `${basePath}/${relativePath}`;

  try {
    const f = Bun.file(filePath);
    return new Response(await f.bytes(), {
      headers: { "Content-Type": f.type || "application/octet-stream" },
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}
