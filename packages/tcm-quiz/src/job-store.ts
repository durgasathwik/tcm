import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Job, type Job as JobType } from "@tcm/shared";

export function jobsDir(dataDir: string): string {
  return join(dataDir, "jobs");
}

export function jobPath(dataDir: string, id: string): string {
  return join(jobsDir(dataDir), `${id}.json`);
}

export function writeJob(dataDir: string, job: JobType): void {
  mkdirSync(jobsDir(dataDir), { recursive: true });
  const path = jobPath(dataDir, job.id);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(job, null, 2), "utf8");
  renameSync(tmp, path);
}

export function readJob(dataDir: string, id: string): JobType | null {
  const path = jobPath(dataDir, id);
  if (!existsSync(path)) return null;
  try {
    const parsed = Job.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function listJobs(dataDir: string): JobType[] {
  const dir = jobsDir(dataDir);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));
  const out: JobType[] = [];
  for (const f of files) {
    try {
      const parsed = Job.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (parsed.success) out.push(parsed.data);
    } catch {
      // skip corrupt
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
