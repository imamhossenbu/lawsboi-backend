import multer from "multer";
import { badRequest } from "../../lib/errors.js";
import { ALLOWED_TYPES, MAX_FILE_BYTES, MAX_FILES } from "./schemas.js";

/** Attachments as the reader's form allows them: up to three PNG, JPEG or PDF files of 2 MB each, held in memory
 * just long enough to go to storage. */
export const attachments = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(badRequest("Only PNG, JPEG and PDF files can be attached.", { files: "type" }));
  },
}).array("files", MAX_FILES);
