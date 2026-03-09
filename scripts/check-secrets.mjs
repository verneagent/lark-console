#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "tmp",
  "coverage",
  "dist",
  "build"
]);

const SKIP_FILES = new Set([
  "package-lock.json"
]);

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".jsonc",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".toml",
  ".env",
  ".gitignore"
]);

const RULES = [
  {
    name: "Private key block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g
  },
  {
    name: "OpenAI-style secret",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g
  },
  {
    name: "GitHub personal access token",
    pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g
  },
  {
    name: "AWS access key id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    name: "Bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g
  },
  {
    name: "Generic credential assignment",
    pattern: /\b(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9._~+\/=-]{12,}/gi
  }
];

async function walk(dirPath, relativeDir = "") {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".gitignore") {
      if (entry.isDirectory()) {
        continue;
      }
    }

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...await walk(path.join(dirPath, entry.name), path.join(relativeDir, entry.name)));
      continue;
    }

    const relativePath = path.join(relativeDir, entry.name);
    if (SKIP_FILES.has(entry.name)) {
      continue;
    }
    files.push(relativePath);
  }

  return files;
}

function shouldScan(filePath) {
  const ext = path.extname(filePath);
  return TEXT_EXTENSIONS.has(ext) || path.basename(filePath).startsWith(".env");
}

function collectFindings(content) {
  const findings = [];
  for (const rule of RULES) {
    const matches = content.match(rule.pattern);
    if (!matches?.length) {
      continue;
    }
    findings.push({
      rule: rule.name,
      count: matches.length
    });
  }
  return findings;
}

async function main() {
  const files = await walk(ROOT);
  const findings = [];

  for (const relativePath of files) {
    if (!shouldScan(relativePath)) {
      continue;
    }

    const absolutePath = path.join(ROOT, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    const fileFindings = collectFindings(content);
    if (!fileFindings.length) {
      continue;
    }

    findings.push({
      file: relativePath,
      findings: fileFindings
    });
  }

  if (!findings.length) {
    console.log("No obvious secrets found.");
    return;
  }

  console.error("Potential secrets found:");
  for (const item of findings) {
    const summary = item.findings
      .map((finding) => `${finding.rule} x${finding.count}`)
      .join(", ");
    console.error(`- ${item.file}: ${summary}`);
  }
  process.exitCode = 1;
}

await main();
