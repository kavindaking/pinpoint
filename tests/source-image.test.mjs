import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedSourceUrl,
  decodeBrowserSourceImage,
  inspectSourceImage,
  sourceImageQa,
} from "../server/source-image.js";

test("allows only approved Wikimedia Commons source hosts", () => {
  assert.equal(
    allowedSourceUrl("https://commons.wikimedia.org/wiki/Special:Redirect/file/example.jpg").hostname,
    "commons.wikimedia.org",
  );
  assert.equal(
    allowedSourceUrl("https://upload.wikimedia.org/wikipedia/commons/example.jpg").hostname,
    "upload.wikimedia.org",
  );
  assert.throws(
    () => allowedSourceUrl("https://commons.wikimedia.org.evil.example/image.jpg"),
    /Wikimedia Commons/,
  );
  assert.throws(() => allowedSourceUrl("http://commons.wikimedia.org/image.jpg"), /HTTPS/);
  assert.throws(() => allowedSourceUrl("https://user@commons.wikimedia.org/image.jpg"), /connection details/);
});

test("validates browser fallback image payloads", () => {
  assert.deepEqual(decodeBrowserSourceImage(Buffer.from("image bytes").toString("base64")), Buffer.from("image bytes"));
  assert.throws(() => decodeBrowserSourceImage("not base64!"), /invalid/);
  assert.throws(() => decodeBrowserSourceImage("A".repeat(4 * 1024 * 1024 + 4)), /3 MB/);
});

test("detects PNG dimensions from the downloaded bytes", () => {
  const png = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(1152, 16);
  png.writeUInt32BE(907, 20);
  assert.deepEqual(inspectSourceImage(png), {
    mimeType: "image/png",
    extension: "png",
    width: 1152,
    height: 907,
  });
  assert.throws(() => inspectSourceImage(Buffer.from("not an image")), /supported PNG, JPEG or WebP/);
});

test("creates deterministic QA fingerprints and flags small images", () => {
  const bytes = Buffer.from("same image bytes");
  const details = { mimeType: "image/jpeg", extension: "jpg", width: 500, height: 700 };
  const checkedAt = new Date("2026-07-22T00:00:00.000Z");
  const first = sourceImageQa(bytes, details, "CT", checkedAt);
  const second = sourceImageQa(bytes, details, "CT", checkedAt);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.status, "warning");
  assert.deepEqual(first.warnings, ["The image is below 512 pixels on its shortest side."]);
  assert.equal(first.checkedAt, checkedAt.toISOString());
});
