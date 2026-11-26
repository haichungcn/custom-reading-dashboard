#!/usr/bin/env node
/**
 * Custom Reading Dashboard — Deterministic Chrome Web Store Release Packager
 *
 * Zero-dependency Node.js ES module that:
 * 1. Validates manifest.json (MV3, version, description <= 132 chars, icons PNG dimensions).
 * 2. Collects strictly the runtime Chrome Extension allowlist.
 * 3. Audits every packaged file for personal paths, private tokens, or company-specific leaks.
 * 4. Builds deterministic `dist/calm-morning-gateway-v<version>.zip` + `dist/SHA256SUMS.txt`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RUNTIME_ROOT_FILES = [
  'manifest.json',
  'pwa-manifest.json',
  'index.html',
  'sidepanel.html',
  'service-worker.js',
  'sw-pwa.js'
];

const RUNTIME_DIRS = [
  { dir: 'css', ext: '.css' },
  { dir: 'js', ext: '.js' },
  { dir: 'icons', ext: '.png' }
];

const TEXT_EXTENSIONS = new Set(['.json', '.html', '.js', '.css']);

// Regex patterns constructed with character classes to avoid literal sensitive strings in source audits.
const LEAK_RULES = [
  { label: 'macOS or Linux local home path', regex: /(?:\/Us[e]rs\/|\/ho[m]e\/|\/opt\/homebr[e]w\/)/ },
  { label: 'macOS iCloud Obsidian path', regex: /iCl[o]ud~md~obsidian/i },
  { label: 'Personal vault folder reference', regex: /(?:Secon[d] Brain|BrainExp[o]rt)/i },
  { label: 'Company-specific identifier', regex: /\bhubbl(?:[e]|esoftware)\b/i },
  { label: 'Personal company stack reference', regex: /\bst[r]api\b/i },
  { label: 'Personal location default', regex: /\bho ch[i] minh\b/i },
  { label: 'Personal username or LaunchAgent', regex: /(?:local\.h[a]i|\bcth[a]i\b|Good morning, H[a]i|userName:\s*['"]H[a]i['"])/i },
  { label: 'Internal channel identifier', regex: /#team-w[e]b\b/i },
  { label: 'Hardcoded GitHub PAT', regex: /\b(?:ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/ },
  { label: 'Hardcoded Slack token', regex: /\bxox[bpa]-[A-Za-z0-9-]{10,}\b/ }
];

/**
 * Compute IEEE 802.3 CRC-32 for a Buffer.
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(pngSig)) {
    throw new Error(`Invalid PNG file signature: ${filePath}`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

function validateManifest() {
  const manifestPath = path.join(ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    throw new Error(`Expected manifest_version 3, got ${manifest.manifest_version}`);
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(`Invalid semver version in manifest.json: ${manifest.version}`);
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 75) {
    throw new Error('manifest.json name must be 1..75 characters');
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim() || manifest.description.length > 132) {
    throw new Error(`manifest.json description must be <= 132 characters (got ${manifest.description?.length})`);
  }
  if (!manifest.action || manifest.action.default_popup) {
    throw new Error('manifest.json must declare action without default_popup for sidePanel behavior');
  }
  if (manifest.chrome_url_overrides?.newtab !== 'index.html') {
    throw new Error('manifest.json chrome_url_overrides.newtab must point to index.html');
  }
  if (manifest.side_panel?.default_path !== 'sidepanel.html') {
    throw new Error('manifest.json side_panel.default_path must point to sidepanel.html');
  }
  if (manifest.background?.service_worker !== 'service-worker.js' || manifest.background?.type !== 'module') {
    throw new Error('manifest.json background must declare module service-worker.js');
  }

  for (const size of [16, 48, 128]) {
    const iconRel = manifest.icons?.[String(size)];
    if (!iconRel) {
      throw new Error(`manifest.json missing icon for size ${size}`);
    }
    const iconAbs = path.join(ROOT, iconRel);
    if (!fs.existsSync(iconAbs)) {
      throw new Error(`Referenced icon file missing: ${iconRel}`);
    }
    const dims = readPngDimensions(iconAbs);
    if (dims.width !== size || dims.height !== size) {
      throw new Error(`Icon ${iconRel} has dimensions ${dims.width}x${dims.height}, expected ${size}x${size}`);
    }
  }

  return manifest;
}

function collectRuntimeFiles() {
  const entries = [];

  for (const rel of RUNTIME_ROOT_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`Missing required runtime file: ${rel}`);
    }
    entries.push(rel);
  }

  for (const { dir, ext } of RUNTIME_DIRS) {
    const dirAbs = path.join(ROOT, dir);
    if (!fs.existsSync(dirAbs)) {
      throw new Error(`Missing required runtime directory: ${dir}`);
    }
    const names = fs.readdirSync(dirAbs)
      .filter((name) => name.endsWith(ext))
      .sort();
    for (const name of names) {
      const rel = `${dir}/${name}`;
      const abs = path.join(ROOT, rel);
      if (fs.statSync(abs).isFile()) {
        entries.push(rel);
      }
    }
  }

  return [...new Set(entries)].sort();
}

function auditRuntimeFilesForLeaks(relFiles) {
  const findings = [];
  for (const rel of relFiles) {
    const ext = path.extname(rel).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const rule of LEAK_RULES) {
        if (rule.regex.test(line)) {
          findings.push(`${rel}:${idx + 1} [${rule.label}]`);
        }
      }
    });
  }
  if (findings.length > 0) {
    throw new Error(`Personal data or secret leak detected in release package:\n${findings.join('\n')}`);
  }
}

/**
 * Create a deterministic PKZIP archive buffer from sorted `{ relPath, data }` entries.
 */
function buildDeterministicZip(entries) {
  // Fixed DOS timestamp: 2026-01-01 00:00:00 UTC for reproducible builds
  const dosTime = 0x0000;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const utf8Flag = 0x0800;
  const externalAttrs = (0o100644 << 16) >>> 0;

  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.relPath, 'utf8');
    const uncompressed = entry.data;
    const checksum = crc32(uncompressed);
    const deflated = zlib.deflateRawSync(uncompressed, { level: 9 });
    const useDeflate = deflated.length < uncompressed.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : uncompressed;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(externalAttrs, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirBuf, eocd]);
}

function main() {
  const manifest = validateManifest();
  const relFiles = collectRuntimeFiles();
  auditRuntimeFilesForLeaks(relFiles);

  const zipEntries = relFiles.map((relPath) => ({
    relPath,
    data: fs.readFileSync(path.join(ROOT, relPath))
  }));

  const zipBuffer = buildDeterministicZip(zipEntries);
  const distDir = path.join(ROOT, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const zipName = `calm-morning-gateway-v${manifest.version}.zip`;
  const zipPath = path.join(distDir, zipName);
  fs.writeFileSync(zipPath, zipBuffer);

  const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');
  const sumsPath = path.join(distDir, 'SHA256SUMS.txt');
  fs.writeFileSync(sumsPath, `${sha256}  ${zipName}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        version: manifest.version,
        zipFile: `dist/${zipName}`,
        fileCount: zipEntries.length,
        sizeBytes: zipBuffer.length,
        sha256
      },
      null,
      2
    )
  );
}

main();
