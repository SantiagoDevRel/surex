// Finding the MCP server definition that a tool call came from.
//
// The hook payload carries `tool_name` and no server name and no server config
// (FRICTION-LOG C3), so the gate has to rediscover both. Everything here is
// read from configuration on disk — the gate NEVER runs or connects to an MCP
// server to identify it. That is what makes SessionStart prefetch possible at
// all: SessionStart fires before MCP connections exist.
//
// Config shapes below were read off a real machine, not from docs:
//   user scope    ~/.claude.json  → .mcpServers
//   local scope   ~/.claude.json  → .projects["<root>"].mcpServers
//   project scope <root>/.mcp.json → .mcpServers
// Project keys in ~/.claude.json use FORWARD SLASHES even on Windows.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** ~/.claude.json keys projects by forward-slashed absolute path. */
function toProjectKey(dir) {
  return resolve(dir).replace(/\\/g, '/');
}

/** Walk up from `cwd` to the filesystem root, nearest first. */
function ancestors(cwd) {
  const out = [];
  let dir = resolve(cwd);
  for (;;) {
    out.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

/**
 * `${VAR}` expansion, as the client does it before launching a server.
 * Unset variables are left as the literal token rather than blanked: blanking
 * would silently merge two different servers onto one fingerprint.
 */
export function expandVars(value, env = process.env) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g, (whole, name, fallback) => {
      if (env[name] !== undefined) return env[name];
      if (fallback) return fallback.slice(2);
      return whole;
    });
  }
  if (Array.isArray(value)) return value.map((v) => expandVars(v, env));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandVars(v, env);
    return out;
  }
  return value;
}

/**
 * Every MCP server visible from `cwd`, with the scope it came from.
 *
 * Precedence, highest first — and it is NOT a merge. The first scope that
 * defines a name owns that name entirely, because a half-merged definition
 * would fingerprint as a server that exists nowhere.
 */
export function discoverServers(cwd = process.cwd(), opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.homedir ?? homedir();
  const claudeJson = readJson(join(home, '.claude.json')) ?? {};
  const found = new Map(); // name -> {name, def, scope, source}
  const sources = [];

  const take = (name, def, scope, source) => {
    if (found.has(name)) return; // first scope wins, entirely
    found.set(name, { name, def: expandVars(def, env), scope, source });
  };

  // 1. local scope — per-project, in ~/.claude.json. Nearest ancestor wins.
  for (const dir of ancestors(cwd)) {
    const entry = claudeJson.projects?.[toProjectKey(dir)];
    if (!entry) continue;
    const disabled = new Set(entry.disabledMcpjsonServers ?? []);
    for (const [name, def] of Object.entries(entry.mcpServers ?? {})) {
      if (disabled.has(name)) continue;
      take(name, def, 'local', `${join(home, '.claude.json')} → projects["${toProjectKey(dir)}"]`);
    }
    if (entry.mcpServers) sources.push({ scope: 'local', at: toProjectKey(dir) });
  }

  // 2. project scope — .mcp.json committed alongside the code.
  for (const dir of ancestors(cwd)) {
    const path = join(dir, '.mcp.json');
    if (!existsSync(path)) continue;
    const json = readJson(path);
    if (!json?.mcpServers) continue;
    // A server listed in .mcp.json the user declined is not running, so it is
    // not a server we have anything to say about.
    const entry = claudeJson.projects?.[toProjectKey(dir)] ?? {};
    const disabled = new Set(entry.disabledMcpjsonServers ?? []);
    for (const [name, def] of Object.entries(json.mcpServers)) {
      if (disabled.has(name)) continue;
      take(name, def, 'project', path);
    }
    sources.push({ scope: 'project', at: path });
    break; // nearest .mcp.json only
  }

  // 3. user scope — global, in ~/.claude.json.
  for (const [name, def] of Object.entries(claudeJson.mcpServers ?? {})) {
    take(name, def, 'user', join(home, '.claude.json'));
  }
  if (claudeJson.mcpServers) sources.push({ scope: 'user', at: join(home, '.claude.json') });

  return { servers: [...found.values()], sources };
}

/**
 * Resolve one server by the name parsed out of a tool_name.
 *
 * Plugin-provided servers are named `mcp__plugin_<plugin>_<server>__<tool>` and
 * their definitions live inside the plugin, not in any of the scopes above.
 * We can name them but not fingerprint them, and saying so is better than
 * guessing — a wrong fingerprint reads as `unknown`, which is a silent miss.
 */
export function findServer(serverName, cwd = process.cwd(), opts = {}) {
  const { servers, sources } = discoverServers(cwd, opts);
  const hit = servers.find((s) => s.name === serverName);
  return { server: hit ?? null, servers, sources };
}
