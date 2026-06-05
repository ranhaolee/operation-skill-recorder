// Shared config + tiny helpers for the server.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/  ->  project root
export const ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(ROOT, 'server', 'data');
export const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
export const SKILLS_DIR = path.join(ROOT, 'skills');

export const PORT = Number(process.env.OSR_PORT || 3737);

// Optional LLM synthesis. If OSR_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) is set
// AND ?engine=llm is requested, the LLM synthesizer is used; otherwise rule-based.
export const ANTHROPIC_API_KEY =
  process.env.OSR_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
export const LLM_MODEL = process.env.OSR_LLM_MODEL || 'claude-opus-4-8';

// Header / field names that must never be persisted in clear text.
export const REDACT_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];
export const REDACT_BODY_KEYS = ['password', 'passwd', 'pwd', 'token', 'secret', 'otp'];
