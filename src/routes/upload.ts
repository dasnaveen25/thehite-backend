import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import { randomBytes } from "crypto";
import fs from "fs";
import { requireAdmin, requireWriter } from "../middleware/requireRole";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/") ||
      file.mimetype === "application/pdf"
    )
      cb(null, true);
    else cb(new Error("Only image, video, and PDF files are allowed"));
  },
});

function handleUploadError(err: unknown, res: import("express").Response): void {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File is too large" });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
}

function buildUrl(_req: import("express").Request, filename: string) {
  if (process.env.BASE_URL) {
    return `${process.env.BASE_URL.replace(/\/$/, "")}/uploads/${filename}`;
  }
  return `/uploads/${filename}`;
}

const router: IRouter = Router();

// Admin upload (images + videos, up to 200 MB)
router.post("/admin/upload", requireAdmin, (req, res): void => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) { handleUploadError(err, res); return; }
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    res.json({ url: buildUrl(req, req.file.filename) });
  });
});

// Writer upload — only images, max 10 MB
const writerUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

router.post("/upload/writer", requireWriter, (req, res): void => {
  writerUpload.single("file")(req, res, (err: unknown) => {
    if (err) { handleUploadError(err, res); return; }
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    res.json({ url: buildUrl(req, req.file.filename) });
  });
});

// Delete a previously uploaded file (image/video removed from article body)
router.delete("/upload/:filename", requireWriter, (req, res): void => {
  const rawFilename = req.params.filename;
  if (typeof rawFilename !== "string") {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filename = path.basename(rawFilename);
  if (filename !== rawFilename || !filename) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filePath = path.resolve(UPLOADS_DIR, filename);
  if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      res.status(500).json({ error: "Failed to delete file" });
      return;
    }
    res.json({ success: true });
  });
});

export default router;
