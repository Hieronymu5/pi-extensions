#!/usr/bin/env node
/**
 * Spring Initializr CLI Generator
 *
 * Fetches metadata from https://start.spring.io, determines compatible
 * dependencies for the selected Spring Boot version, downloads a starter
 * ZIP and extracts it to disk.
 *
 * Usage:
 *   node generate.js [options]
 *
 * Options:
 *   --group-id       <id>    Group ID             (default: com.example)
 *   --artifact-id    <id>    Artifact ID          (default: demo)
 *   --description    <text>  Project description  (default: "Demo project for Spring Boot")
 *   --java-version   <ver>   Java version         (default: 25 or highest available)
 *   --boot-version   <ver>   Spring Boot version  (default: latest stable from metadata)
 *   --packaging      <pkg>   jar | war            (default: jar)
 *   --language       <lang>  java | kotlin | groovy (default: java)
 *   --type           <type>  maven-project | gradle-project | … (default: maven-project)
 *   --dependencies   <deps>  Extra comma-separated dep IDs merged with mandatory set
 *   --output-dir     <dir>   Extraction root      (default: ./<artifactId>)
 *   --list-deps             Print available dependencies and exit
 *   --metadata-file  <path>  Path to a local metadata.json fallback
 */

"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const https = require("node:https");
const http  = require("node:http");

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parser
// ─────────────────────────────────────────────────────────────────────────────

function parseCliArgs(argv) {
  const result = { _flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      // camelCase the key so --artifact-id → artifactId
      result[toCamel(key)] = next;
      i++;
    } else {
      result._flags.add(key);
    }
  }
  return result;
}

function toCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata fetching
// ─────────────────────────────────────────────────────────────────────────────

const SPRING_INITIALIZR_URL = "https://start.spring.io";
const FETCH_TIMEOUT_MS = 10_000;

async function fetchMetadata(metadataFilePath) {
  // 1. Try the live Spring Initializr endpoint
  try {
    const body = await httpGet(SPRING_INITIALIZR_URL, {
      Accept: "application/json",
    });
    return JSON.parse(body);
  } catch (e) {
    console.warn(`[warn] Could not reach start.spring.io: ${e.message}`);
  }

  // 2. Fall back to the provided local file
  if (metadataFilePath) {
    try {
      return JSON.parse(fs.readFileSync(metadataFilePath, "utf8"));
    } catch (e) {
      console.warn(`[warn] Could not read metadata file "${metadataFilePath}": ${e.message}`);
    }
  }

  // 3. Fall back to metadata.json next to this script
  const scriptDir = path.dirname(path.resolve(__filename));
  const localPath = path.join(path.dirname(scriptDir), "metadata.json");
  if (fs.existsSync(localPath)) {
    try {
      return JSON.parse(fs.readFileSync(localPath, "utf8"));
    } catch (e) {
      console.warn(`[warn] Could not parse ${localPath}: ${e.message}`);
    }
  }

  return null;
}

// Simple promise-based HTTP(S) GET that returns the full body as a string.
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(url, { headers, timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect
        resolve(httpGet(res.headers.location, headers));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
  });
}

// Download as raw Buffer
function httpGetBuffer(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpGetBuffer(res.headers.location));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Download timed out"));
    });
    req.on("error", reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Spring version comparison & range checking
//
// Version format: MAJOR.MINOR.PATCH.QUALIFIER
// Qualifier order (ascending): M{n} < RC{n} < RELEASE < BUILD-SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

function parseSpringVersion(v) {
  const parts = String(v).trim().split(".");
  const major = parseInt(parts[0] ?? "0", 10) || 0;
  const minor = parseInt(parts[1] ?? "0", 10) || 0;
  const patch = parseInt(parts[2] ?? "0", 10) || 0;
  const qualifier = parts.slice(3).join(".").toUpperCase();

  let qualOrder;
  if (qualifier === "" || qualifier === "RELEASE") {
    qualOrder = 2000;
  } else if (qualifier === "BUILD-SNAPSHOT" || qualifier === "SNAPSHOT") {
    qualOrder = 3000;
  } else if (qualifier.startsWith("M")) {
    qualOrder = parseInt(qualifier.slice(1), 10) || 1;
  } else if (qualifier.startsWith("RC")) {
    qualOrder = 1000 + (parseInt(qualifier.slice(2), 10) || 1);
  } else {
    qualOrder = 2000;
  }

  return { major, minor, patch, qualOrder };
}

function compareSpringVersions(a, b) {
  const pa = parseSpringVersion(a);
  const pb = parseSpringVersion(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  return pa.qualOrder - pb.qualOrder;
}

function isVersionInRange(version, range) {
  const r = range.trim();
  if (!r.startsWith("[") && !r.startsWith("(")) {
    return compareSpringVersions(version, r) >= 0;
  }

  const inclusiveLower = r.startsWith("[");
  const inclusiveUpper = r.endsWith("]");
  const inner = r.slice(1, -1);
  const commaIdx = inner.indexOf(",");

  if (commaIdx === -1) {
    return compareSpringVersions(version, inner.trim()) === 0;
  }

  const lower = inner.slice(0, commaIdx).trim();
  const upper = inner.slice(commaIdx + 1).trim();

  if (lower) {
    const cmp = compareSpringVersions(version, lower);
    if (inclusiveLower ? cmp < 0 : cmp <= 0) return false;
  }
  if (upper) {
    const cmp = compareSpringVersions(version, upper);
    if (inclusiveUpper ? cmp > 0 : cmp >= 0) return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns all dependency entries (flat) compatible with bootVersion. */
function getCompatibleDependencies(meta, bootVersion) {
  const result = [];
  for (const cat of meta?.dependencies?.values ?? []) {
    for (const dep of cat.values ?? []) {
      if (dep.versionRange && !isVersionInRange(bootVersion, dep.versionRange)) {
        continue;
      }
      result.push({
        id: dep.id,
        name: dep.name,
        description: dep.description ?? "",
        category: cat.name,
        versionRange: dep.versionRange ?? "",
      });
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Version selection helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Picks the best default Spring Boot version from metadata:
 * prefer the latest stable (RELEASE) version; if none, the latest snapshot.
 */
function pickDefaultBootVersion(meta) {
  const versions = meta?.bootVersion?.values ?? [];
  const releases = versions.filter(
    (v) => v.id.endsWith(".RELEASE") && !v.id.includes("SNAPSHOT"),
  );
  if (releases.length > 0) {
    return releases.reduce((best, v) =>
      compareSpringVersions(v.id, best.id) > 0 ? v : best,
    ).id;
  }
  // Fall back to whatever the metadata says is default
  return meta?.bootVersion?.default ?? versions[0]?.id ?? "";
}

/**
 * Picks the best Java version: prefers "25" if available, otherwise the
 * numerically highest available version.
 */
function pickDefaultJavaVersion(meta, preferredVersion = "25") {
  const versions = (meta?.javaVersion?.values ?? []).map((v) => v.id);
  if (versions.includes(preferredVersion)) return preferredVersion;
  if (versions.length === 0) return "17";
  return versions.reduce((best, v) =>
    parseInt(v, 10) > parseInt(best, 10) ? v : best,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// URL builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a Spring Initializr metadata version ID into the Maven-compatible
 * version string used in the download URL.
 *
 *   4.0.6.RELEASE        → 4.0.6
 *   4.0.7.BUILD-SNAPSHOT → 4.0.7-SNAPSHOT
 *   4.1.0.RC1            → 4.1.0-RC1
 *   4.1.0.M2             → 4.1.0-M2
 */
function cleanBootVersion(version) {
  if (version.endsWith(".RELEASE")) return version.slice(0, -".RELEASE".length);
  if (version.endsWith(".BUILD-SNAPSHOT"))
    return version.slice(0, -".BUILD-SNAPSHOT".length) + "-SNAPSHOT";
  return version.replace(/\.((?:RC|M)\d+)$/, "-$1");
}

function buildDownloadUrl(meta, params) {
  const linkHref =
    meta?._links?.[params.type]?.href ??
    `${SPRING_INITIALIZR_URL}/starter.zip?type=${encodeURIComponent(params.type)}`;

  // Strip the RFC-6570 template suffix, e.g. "{&dependencies,…}"
  const baseUrl = linkHref.replace(/\{[^}]*\}$/, "");

  const pairs = [
    `language=${encodeURIComponent(params.language)}`,
    `bootVersion=${encodeURIComponent(cleanBootVersion(params.bootVersion))}`,
    `groupId=${encodeURIComponent(params.groupId)}`,
    `artifactId=${encodeURIComponent(params.artifactId)}`,
    `name=${encodeURIComponent(params.name)}`,
    `description=${encodeURIComponent(params.description)}`,
    `packageName=${encodeURIComponent(params.packageName)}`,
    `packaging=${encodeURIComponent(params.packaging)}`,
    `javaVersion=${encodeURIComponent(params.javaVersion)}`,
  ];

  if (params.dependencies.length > 0) {
    pairs.push(
      `dependencies=${params.dependencies.map(encodeURIComponent).join(",")}`,
    );
  }

  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}${pairs.join("&")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP extractor (pure Node.js – no external dependencies)
//
// Spring Initializr ZIPs use data descriptors (flag bit 3), so the
// compressed/uncompressed sizes in local file headers are zero.
// We read all sizes from the Central Directory, then seek back to find
// the data offset.
// ─────────────────────────────────────────────────────────────────────────────

function parseZipCentralDirectory(buf) {
  // Scan backwards for the End of Central Directory signature 0x06054b50
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Invalid ZIP: EOCD not found");

  const numEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset   = buf.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let pos = cdOffset;

  for (let i = 0; i < numEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50)
      throw new Error(`Invalid ZIP: bad central-directory signature at ${pos}`);

    const compression       = buf.readUInt16LE(pos + 10);
    const compressedSize    = buf.readUInt32LE(pos + 20);
    const uncompressedSize  = buf.readUInt32LE(pos + 24);
    const filenameLen       = buf.readUInt16LE(pos + 28);
    const extraLen          = buf.readUInt16LE(pos + 30);
    const commentLen        = buf.readUInt16LE(pos + 32);
    const externalAttr      = buf.readUInt32LE(pos + 38);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const filename = buf.subarray(pos + 46, pos + 46 + filenameLen).toString("utf8");
    const unixMode = (externalAttr >>> 16) & 0xffff;

    entries.push({ filename, compression, compressedSize, uncompressedSize,
                   localHeaderOffset, unixMode });
    pos += 46 + filenameLen + extraLen + commentLen;
  }

  return entries;
}

function extractZip(zipBuffer, targetDir) {
  const entries = parseZipCentralDirectory(zipBuffer);
  let fileCount = 0;

  for (const entry of entries) {
    const parts = entry.filename.split("/").filter((p) => p !== "" && p !== "..");
    if (parts.length === 0) continue;

    const fullPath = path.join(targetDir, ...parts);

    if (entry.filename.endsWith("/")) {
      fs.mkdirSync(fullPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    const lfhFilenameLen = zipBuffer.readUInt16LE(entry.localHeaderOffset + 26);
    const lfhExtraLen    = zipBuffer.readUInt16LE(entry.localHeaderOffset + 28);
    const dataOffset     = entry.localHeaderOffset + 30 + lfhFilenameLen + lfhExtraLen;
    const compressed     = zipBuffer.subarray(dataOffset, dataOffset + entry.compressedSize);

    let fileData;
    if (entry.compression === 0) {
      fileData = Buffer.from(compressed);
    } else if (entry.compression === 8) {
      fileData = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(
        `Unsupported compression method ${entry.compression} for "${entry.filename}"`,
      );
    }

    fs.writeFileSync(fullPath, fileData);

    if (entry.unixMode !== 0) {
      try { fs.chmodSync(fullPath, entry.unixMode & 0o777); } catch { /* non-fatal */ }
    }

    fileCount++;
  }

  return fileCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const MANDATORY_DEP_IDS = ["web", "springdoc-openapi", "modulith"];

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const listDepsMode = opts._flags.has("list-deps");

  // ── Load metadata ────────────────────────────────────────────────────────
  process.stdout.write("Fetching Spring Initializr metadata…\n");
  const meta = await fetchMetadata(opts.metadataFile);

  if (!meta) {
    console.error(
      "Error: Could not load metadata from start.spring.io or a local fallback.\n" +
      "Ensure you have internet access or pass --metadata-file <path>.",
    );
    process.exit(1);
  }

  // ── Resolve defaults ─────────────────────────────────────────────────────
  const bootVersion =
    opts.bootVersion ?? pickDefaultBootVersion(meta);
  const javaVersion =
    opts.javaVersion ?? pickDefaultJavaVersion(meta, "25");
  const language    = opts.language    ?? "java";
  const type        = opts.type        ?? "maven-project";
  const packaging   = opts.packaging   ?? "jar";
  const groupId     = opts.groupId     ?? "com.example";
  const artifactId  = opts.artifactId  ?? "demo";
  const description = opts.description ?? "Demo project for Spring Boot";
  const packageName = `${groupId}.${artifactId}`;

  // ── Validate selected boot version exists ────────────────────────────────
  const knownVersionIds = (meta.bootVersion?.values ?? []).map((v) => v.id);
  if (!knownVersionIds.includes(bootVersion)) {
    console.error(
      `Error: Boot version "${bootVersion}" is not in the metadata.\n` +
      `Available versions:\n` +
      knownVersionIds.map((v) => `  ${v}`).join("\n"),
    );
    process.exit(1);
  }

  // ── Resolve compatible deps ───────────────────────────────────────────────
  const compatibleDeps = getCompatibleDependencies(meta, bootVersion);

  // ── List-deps mode ───────────────────────────────────────────────────────
  if (listDepsMode) {
    console.log(`\nDependencies compatible with Spring Boot ${bootVersion}:\n`);
    let currentCat = "";
    for (const dep of compatibleDeps) {
      if (dep.category !== currentCat) {
        console.log(`\n[${dep.category}]`);
        currentCat = dep.category;
      }
      const available = MANDATORY_DEP_IDS.includes(dep.id) ? " ★" : "";
      const desc = dep.description ? ` — ${dep.description}` : "";
      console.log(`  ${dep.id}${available}${desc}`);
    }
    console.log("\n★ = mandatory default dependency");
    process.exit(0);
  }

  // ── Build mandatory deps (filtered to compatible ones) ───────────────────
  const compatibleIds = new Set(compatibleDeps.map((d) => d.id));
  const mandatoryDeps = MANDATORY_DEP_IDS.filter((id) => compatibleIds.has(id));
  const skippedMandatory = MANDATORY_DEP_IDS.filter((id) => !compatibleIds.has(id));

  if (skippedMandatory.length > 0) {
    console.warn(
      `[warn] The following default dependencies are not available for Boot ${bootVersion}` +
      ` and will be skipped:\n  ${skippedMandatory.join(", ")}`,
    );
  }

  // ── Merge with user-provided extra deps ──────────────────────────────────
  const extraDeps = opts.dependencies
    ? opts.dependencies.split(",").map((d) => d.trim()).filter(Boolean)
    : [];

  const unknownDeps = extraDeps.filter((id) => !compatibleIds.has(id));
  if (unknownDeps.length > 0) {
    console.warn(
      `[warn] The following extra dependencies are not available for Boot ${bootVersion}` +
      ` and will be skipped:\n  ${unknownDeps.join(", ")}`,
    );
  }

  const allDeps = [
    ...new Set([...mandatoryDeps, ...extraDeps.filter((id) => compatibleIds.has(id))]),
  ];

  // ── Print resolved configuration ─────────────────────────────────────────
  console.log("\nProject configuration:");
  console.log(`  Project type   : ${type}`);
  console.log(`  Language       : ${language}`);
  console.log(`  Spring Boot    : ${bootVersion}`);
  console.log(`  Java version   : ${javaVersion}`);
  console.log(`  Group ID       : ${groupId}`);
  console.log(`  Artifact ID    : ${artifactId}`);
  console.log(`  Packaging      : ${packaging}`);
  console.log(`  Dependencies   : ${allDeps.join(", ") || "(none)"}`);

  // ── Build download URL ────────────────────────────────────────────────────
  const params = {
    type,
    language,
    bootVersion,
    groupId,
    artifactId,
    name: artifactId,
    description,
    packageName,
    packaging,
    javaVersion,
    dependencies: allDeps,
  };

  const downloadUrl = buildDownloadUrl(meta, params);
  console.log(`\nDownload URL:\n  ${downloadUrl}\n`);

  // ── Download ──────────────────────────────────────────────────────────────
  console.log(`Downloading ${artifactId}.zip…`);
  let zipBuffer;
  try {
    zipBuffer = await httpGetBuffer(downloadUrl);
  } catch (e) {
    console.error(`Error: Download failed — ${e.message}`);
    process.exit(1);
  }
  console.log(`Downloaded ${(zipBuffer.length / 1024).toFixed(1)} KB`);

  // ── Determine output directory ────────────────────────────────────────────
  const outputDir = opts.outputDir
    ? path.resolve(opts.outputDir)
    : path.resolve(process.cwd(), artifactId);

  console.log(`\nExtracting to ${outputDir}…`);
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const fileCount = extractZip(zipBuffer, outputDir);
    console.log(`\n✓ Successfully extracted ${fileCount} files to:\n  ${outputDir}`);
  } catch (e) {
    console.error(`Error: Extraction failed — ${e.message}`);
    process.exit(1);
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("\nNext steps:");
  if (type === "maven-project") {
    console.log(`  cd ${path.relative(process.cwd(), outputDir) || "."}`);
    console.log("  ./mvnw spring-boot:run");
  } else if (type.startsWith("gradle")) {
    console.log(`  cd ${path.relative(process.cwd(), outputDir) || "."}`);
    console.log("  ./gradlew bootRun");
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
