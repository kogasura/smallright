import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ProfileManager, SiteProfile, ZoneDefinition } from "../types.js";

function getProfilesDir(): string {
  return path.join(os.homedir(), ".config", "smallright", "profiles");
}

function sanitizeDomain(domain: string): string {
  const sanitized = domain.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!sanitized || sanitized.startsWith('.') || sanitized.includes('..')) {
    throw new Error(`Invalid domain name: "${domain}"`);
  }
  return sanitized;
}

function getProfilePath(domain: string): string {
  return path.join(getProfilesDir(), `${sanitizeDomain(domain)}.json`);
}

export function createProfileManager(): ProfileManager {
  return {
    async load(domain: string): Promise<SiteProfile | null> {
      const filePath = getProfilePath(domain);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        return JSON.parse(content) as SiteProfile;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }
    },

    async save(domain: string, zones: ZoneDefinition[]): Promise<void> {
      const dir = getProfilesDir();
      await fs.mkdir(dir, { recursive: true });

      const filePath = getProfilePath(domain);
      const now = new Date().toISOString();

      let createdAt = now;
      try {
        const existing = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(existing) as SiteProfile;
        createdAt = parsed.createdAt;
      } catch {
        // File does not exist yet; use current time as createdAt
      }

      const profile: SiteProfile = {
        domain,
        zones,
        createdAt,
        updatedAt: now,
      };

      await fs.writeFile(filePath, JSON.stringify(profile, null, 2), "utf-8");
    },

    async list(): Promise<SiteProfile[]> {
      const dir = getProfilesDir();
      try {
        const entries = await fs.readdir(dir);
        const profiles: SiteProfile[] = [];
        for (const entry of entries) {
          if (!entry.endsWith(".json")) continue;
          const filePath = path.join(dir, entry);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            profiles.push(JSON.parse(content) as SiteProfile);
          } catch {
            // Skip files that cannot be read
          }
        }
        return profiles;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw err;
      }
    },

    async delete(domain: string): Promise<boolean> {
      const filePath = getProfilePath(domain);
      try {
        await fs.unlink(filePath);
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return false;
        }
        throw err;
      }
    },
  };
}
