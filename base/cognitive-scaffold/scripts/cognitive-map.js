#!/usr/bin/env node
/**
 * @module 认知地图
 * @brief 统一前端：架构依赖图 + 模块清单 + 决策日志 + 检索
 * @layer 工具
 *
 * 用法:
 *   node cognitive-map.js [--port 3458] [--scan-only]
 *   node cognitive-map.js --scan-dirs lib,server,scripts
 */

import http from 'node:http';
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── 配置 ──────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  const v = i > -1 ? process.argv[i + 1] : undefined;
  return (v && !v.startsWith('--')) ? v : def;
}

const PORT = parseInt(argVal('--port', '3458'));
const SCAN_ONLY = process.argv.includes('--scan-only');
const SCAN_DIRS = argVal('--scan-dirs', 'lib,src,server,scripts').split(',').map(s => s.trim()).filter(Boolean);
const CURATION_PATH = join(__dirname, '..', 'curation.json');
const ADR_DIR = join(PROJECT_ROOT, 'docs', 'adr');

// ─── 状态 ──────────────────────────────────────────────

let graphData = null;
let modulesList = [];
let adrList = [];

// ═══════════════════════════════════════════════════════
//  扫描引擎
// ═══════════════════════════════════════════════════════

async function cruiseProject() {
  const modules = [];
  for (const dir of SCAN_DIRS) {
    const full = join(PROJECT_ROOT, dir);
    if (!existsSync(full)) continue;
    modules.push(full);
  }
  if (modules.length === 0) return [];

  try {
    const { cruise } = await import('dependency-cruiser');
    const result = await cruise(modules, {
      outputType: 'json',
      doNotFollow: { path: ['node_modules'] },
      exclude: { path: ['node_modules', 'test(s)?', '__tests__', 'dist', 'build'] },
    });
    const output = (typeof result.output === 'string') ? JSON.parse(result.output) : result.output;
    return (output && output.modules) ? output.modules : [];
  } catch (_err) {
    // fallback: simple file scanner
    return fallbackScan();
  }
}

/** Fallback when dependency-cruiser not available: basic file listing */
function fallbackScan() {
  const modules = [];
  for (const dir of SCAN_DIRS) {
    const full = join(PROJECT_ROOT, dir);
    if (!existsSync(full)) continue;
    walkDir(full, full, modules);
  }
  return modules.map(m => ({
    source: m.relPath,
    dependencies: m.imports || [],
    dependents: [],
    valid: true,
  }));
}

function walkDir(base, current, out) {
  const entries = readdirSync(current, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = join(current, e.name);
    if (e.isDirectory()) { walkDir(base, full, out); continue; }
    if (!['.js', '.mjs', '.cjs', '.ts', '.mts', '.py'].includes(extname(e.name))) continue;
    const rel = relative(base, full);
    const src = readFileSync(full, 'utf-8');
    out.push({ relPath: rel, fullPath: full, imports: extractImports(src, full) });
  }
}

function extractImports(src, filePath) {
  const deps = [];
  const ext = extname(filePath);
  // JS/TS: import/require patterns
  if (['.js', '.mjs', '.cjs', '.ts', '.mts'].includes(ext)) {
    const importRe = /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    let m;
    while ((m = importRe.exec(src)) !== null) {
      const p = m[1] || m[2];
      if (p && !p.startsWith('node:') && !p.startsWith('@') && !/^[a-z]/.test(p)) deps.push(p);
    }
  }
  // Python: import patterns
  if (ext === '.py') {
    const pyRe = /^(?!#)(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
    let m;
    while ((m = pyRe.exec(src)) !== null) {
      const p = m[1] || m[2];
      if (p && !/^(os|sys|json|re|datetime|pathlib|typing|collections)/.test(p)) deps.push(p);
    }
  }
  return deps;
}

// ─── JSDoc 解析 ────────────────────────────────────────

function parseJSDoc(filePath) {
  try {
    const src = readFileSync(filePath, 'utf-8');
    const jsdocRe = /\/\*\*[\s\S]*?@module\s+(.+?)\s*\n(?:\s*\*\s*@brief\s+([\s\S]*?)\s*\n)?(?:\s*\*\s*@layer\s+(.+?)\s*\n)?/;
    const m = src.match(jsdocRe);
    if (m) {
      return { module: m[1]?.trim(), brief: m[2]?.trim() || '', layer: m[3]?.trim() || '' };
    }
  } catch (_) { /* ignore */ }
  return null;
}

function inferLayer(filePath) {
  const dir = dirname(filePath);
  if (/store|config|util|context|tz|holiday/i.test(dir)) return '基础设施';
  if (/market|fetch|adapter|provider|westock/i.test(dir)) return '数据获取';
  if (/scoring|rule|stop.?loss|countersig|market.?env|decision|feature/i.test(dir)) return '分析引擎';
  if (/pipeline|ai.?review|analy[sz]e|discover|rating|flow|track|train|notif/i.test(dir)) return '业务逻辑';
  if (/server|route|middleware|api/i.test(dir)) return '服务层';
  if (/scripts?/i.test(dir)) return '脚本层';
  return '';
}

// ─── 策展 ──────────────────────────────────────────────

function loadCuration() {
  try {
    const raw = readFileSync(CURATION_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return data.nodes || {};
  } catch (_) { return {}; }
}

function saveCuration(nodes) {
  writeFileSync(CURATION_PATH, JSON.stringify({ nodes }, null, 2) + '\n');
}

// ─── ADR ───────────────────────────────────────────────

function loadADRs() {
  const list = [];
  if (!existsSync(ADR_DIR)) return list;
  const entries = readdirSync(ADR_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md') || e.name === 'template.md') continue;
    try {
      const content = readFileSync(join(ADR_DIR, e.name), 'utf-8');
      const titleRe = /^#\s+(.+)/m;
      const statusRe = /(?:Status|状态)\s*[：:]\s*(\w+)/i;
      const dateRe = /(?:Date|日期)\s*[：:]\s*([\d-]+)/i;
      list.push({
        file: e.name,
        title: (content.match(titleRe) || [,'无标题'])[1],
        status: (content.match(statusRe) || [,'Accepted'])[1],
        date: (content.match(dateRe) || [,''])[1],
        content,
      });
    } catch (_) { /* ignore */ }
  }
  list.sort((a, b) => b.file.localeCompare(a.file));
  return list;
}

// ─── 构建图数据 ────────────────────────────────────────

async function buildGraph() {
  const cruiseModules = await cruiseProject();
  const curation = loadCuration();
  const nodeMap = {};

  for (const cm of cruiseModules) {
    const relPath = cm.source || cm.relPath || '';
    if (!relPath) continue;

    const fullPath = join(PROJECT_ROOT, relPath);
    const jsdoc = parseJSDoc(fullPath);
    const curated = curation[relPath] || {};
    const layer = curated.layer || (jsdoc && jsdoc.layer) || inferLayer(relPath);
    const label = curated.label || (jsdoc && jsdoc.module) || basename(relPath);
    const brief = curated.notes || (jsdoc && jsdoc.brief) || '';
    const deps = (cm.dependencies || []).map(d => {
      if (typeof d === 'string') return d;
      return d.resolved || d.module || '';
    }).filter(Boolean);

    nodeMap[relPath] = {
      id: relPath,
      path: relPath,
      label,
      brief,
      layer: layer || '未分层',
      tags: curated.tags || [],
      hasJSDoc: !!jsdoc,
      hasCuration: !!curated.label || !!curated.notes,
      deps,
      dependents: [],
      depCount: deps.length,
    };
  }

  // 补全反向依赖
  for (const [id, node] of Object.entries(nodeMap)) {
    for (const dep of node.deps) {
      // 匹配最佳路径
      const matched = findBestMatch(dep, nodeMap);
      if (matched && matched !== id) {
        nodeMap[matched].dependents.push(id);
      }
    }
  }

  const nodes = Object.values(nodeMap);
  const edges = [];
  for (const node of nodes) {
    for (const dep of node.deps) {
      const matched = findBestMatch(dep, nodeMap);
      if (matched && matched !== node.id) {
        edges.push({ source: node.id, target: matched });
      }
    }
  }

  return { nodes, edges };
}

function findBestMatch(target, nodeMap) {
  if (nodeMap[target]) return target;
  for (const key of Object.keys(nodeMap)) {
    if (key.endsWith('/' + target) || key.endsWith(target)) return key;
  }
  // 部分匹配
  for (const key of Object.keys(nodeMap)) {
    if (key.includes(target) || target.includes(basename(key))) return key;
  }
  return null;
}

// ═══════════════════════════════════════════════════════
//  HTTP Server
// ═══════════════════════════════════════════════════════

function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    try {
      if (url.pathname === '/' || url.pathname === '/index.html') return serveIndex(res);
      if (url.pathname === '/api/graph') return json(res, graphData);
      if (url.pathname === '/api/modules') return json(res, modulesList);
      if (url.pathname.startsWith('/api/modules/')) return serveModule(res, url.pathname.replace('/api/modules/', ''));
      if (url.pathname === '/api/adrs') return json(res, adrList);
      if (url.pathname === '/api/search') return handleSearch(req, res, url);
      if (url.pathname === '/api/curate' && req.method === 'PUT') return handleCurate(req, res);
      if (url.pathname === '/api/rescan' && req.method === 'POST') { await rescan(); return json(res, { ok: true, count: graphData.nodes.length }); }
      if (url.pathname === '/api/health') return json(res, { status: 'ok', nodeCount: graphData.nodes.length, edgeCount: graphData.edges.length });
      res.writeHead(404); res.end('Not Found');
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(String(err));
    }
  });

  server.listen(PORT, () => {
    console.log(`🧠 认知地图已启动: http://localhost:${PORT}`);
    console.log(`   ${graphData.nodes.length} 个模块, ${graphData.edges.length} 条依赖`);
  });
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveModule(res, encPath) {
  const path = decodeURIComponent(encPath);
  const node = graphData.nodes.find(n => n.id === path);
  if (!node) { res.writeHead(404); return res.end('Module not found'); }
  json(res, node);
}

function handleSearch(_req, res, url) {
  const q = (url.searchParams.get('q') || '').toLowerCase();
  if (!q) return json(res, []);

  const results = [];
  // 搜模块
  for (const n of graphData.nodes) {
    if (n.label.toLowerCase().includes(q) || n.brief.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
      results.push({ type: 'module', path: n.id, label: n.label, brief: n.brief, layer: n.layer });
    }
  }
  // 搜 ADR
  for (const a of adrList) {
    if (a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q)) {
      results.push({ type: 'adr', file: a.file, title: a.title, date: a.date, status: a.status });
    }
  }
  json(res, results.slice(0, 20));
}

function handleCurate(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { path, label, notes, tags } = JSON.parse(body);
      const curation = loadCuration();
      const curated = curation[path] || {};
      if (label !== undefined) curated.label = label;
      if (notes !== undefined) curated.notes = notes;
      if (tags !== undefined) curated.tags = tags;
      curation[path] = curated;
      saveCuration(curation);
      // 更新内存
      const node = graphData.nodes.find(n => n.id === path);
      if (node) {
        node.label = curated.label || node.label;
        node.brief = curated.notes || node.brief;
        node.tags = curated.tags || [];
        node.hasCuration = true;
      }
      json(res, { ok: true });
    } catch (err) {
      res.writeHead(400);
      res.end(String(err));
    }
  });
}

async function rescan() {
  graphData = await buildGraph();
  modulesList = buildModulesList();
  adrList = loadADRs();
}

function buildModulesList() {
  return graphData.nodes.map(n => ({
    path: n.id,
    label: n.label,
    brief: n.brief,
    layer: n.layer,
    depCount: n.depCount,
    dependentCount: n.dependents.length,
    hasJSDoc: n.hasJSDoc,
    hasCuration: n.hasCuration,
    tags: n.tags,
  }));
}

// ═══════════════════════════════════════════════════════
//  前端 HTML（单页应用）
// ═══════════════════════════════════════════════════════

function serveIndex(res) {
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>认知地图</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
/* ═══ Design tokens ═══ */
:root {
  --bg-base: #0d1117;
  --bg-surface: #161b22;
  --bg-elevated: #1c2129;
  --bg-overlay: #21262d;
  --border-default: #30363d;
  --border-muted: #21262d;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #6e7681;
  --accent-blue: #58a6ff;
  --accent-green: #3fb950;
  --accent-orange: #d29922;
  --accent-purple: #a371f7;
  --accent-red: #f85149;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg-base);color:var(--text-primary);overflow:hidden;height:100vh;display:flex;flex-direction:column}

/* ═══ Header ═══ */
header{display:flex;align-items:stretch;background:var(--bg-surface);border-bottom:1px solid var(--border-default);padding:0 var(--space-4);min-height:44px}
header button{padding:var(--space-3) var(--space-4);border:none;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:13px;position:relative;transition:color .15s}
header button:hover{color:var(--text-primary)}
header button.active{color:var(--text-primary);font-weight:600}
header button.active::after{content:'';position:absolute;bottom:0;left:var(--space-2);right:var(--space-2);height:2px;background:var(--accent-blue);border-radius:2px 2px 0 0}
header .spacer{flex:1}
header .info{display:flex;align-items:center;font-size:12px;color:var(--text-muted);padding:0 var(--space-4)}

/* ═══ Layout ═══ */
main{flex:1;display:flex;overflow:hidden}
.tab{display:none;flex:1;overflow:auto}
.tab.active{display:flex}

/* ═══ Graph ═══ */
#graph-svg{width:100%;height:100%}
#graph-svg circle{stroke-width:1.5;cursor:pointer;transition:r .15s}
#graph-svg circle:hover{filter:brightness(1.3)}
#graph-svg circle.core{stroke:var(--accent-orange);stroke-width:2.5}
#graph-svg circle.unlabeled{stroke-dasharray:4 2;stroke:var(--text-muted);opacity:0.6}
#graph-svg line{stroke:var(--border-default);stroke-width:0.8;opacity:0.5}
#graph-svg .edge-label{font-size:9px;fill:var(--text-muted)}
#graph-svg .node-label{font-size:10px;fill:var(--text-primary);pointer-events:none;user-select:none;text-shadow:0 1px 3px var(--bg-base)}
#graph-svg .node-label-bg{fill:var(--bg-base);opacity:0.7;pointer-events:none}
#graph-svg .empty-text{fill:var(--text-muted)}

/* ═══ Side panel ═══ */
.side-panel{width:340px;background:var(--bg-surface);border-left:1px solid var(--border-default);display:none;flex-direction:column;flex-shrink:0}
.side-panel.open{display:flex}
.side-panel-header{padding:var(--space-4);border-bottom:1px solid var(--border-default);display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3)}
.side-panel-header h3{font-size:15px;word-break:break-word;flex:1}
.side-panel-header .path{font-size:11px;color:var(--text-muted);font-family:monospace}
.side-panel-close{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:0 var(--space-1);line-height:1}
.side-panel-close:hover{color:var(--text-primary)}
.side-panel-body{flex:1;overflow-y:auto;padding:var(--space-4)}
.side-panel-body .card{background:var(--bg-elevated);border:1px solid var(--border-muted);border-radius:var(--radius-md);padding:var(--space-4);margin-bottom:var(--space-4)}
.side-panel-body .card:last-child{margin-bottom:0}
.side-panel-body .card-label{display:block;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--space-2)}
.side-panel-body input,.side-panel-body textarea{width:100%;padding:var(--space-2) var(--space-3);background:var(--bg-base);border:1px solid var(--border-default);color:var(--text-primary);border-radius:var(--radius-sm);font-size:13px;outline:none;transition:border-color .15s}
.side-panel-body input:focus,.side-panel-body textarea:focus{border-color:var(--accent-blue)}
.side-panel-body textarea{min-height:80px;resize:vertical;font-family:inherit;line-height:1.5}
.side-panel-body .dep-chip{display:inline-block;background:var(--bg-overlay);border:1px solid var(--border-default);padding:var(--space-1) var(--space-2);border-radius:var(--radius-lg);margin:2px;font-size:11px;color:var(--text-secondary);cursor:pointer;transition:all .15s}
.side-panel-body .dep-chip:hover{border-color:var(--accent-blue);color:var(--accent-blue)}
.side-panel-body .meta-row{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-secondary);padding:var(--space-1) 0}
.side-panel-body .tag{display:inline-block;padding:1px 8px;border-radius:var(--radius-lg);font-size:11px;font-weight:500}
.side-panel-body .tag-core{background:#1a3a5c;color:var(--accent-blue)}
.side-panel-body .tag-tech-debt{background:#3d2e00;color:var(--accent-orange)}
.side-panel-body .tag-needs-split{background:#3d1a3a;color:var(--accent-purple)}
.side-panel-footer{padding:var(--space-4);border-top:1px solid var(--border-default)}
.side-panel-footer button{width:100%;padding:var(--space-2) var(--space-4);background:var(--accent-green);color:#000;border:none;border-radius:var(--radius-sm);font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s}
.side-panel-footer button:hover{opacity:0.9}

/* ═══ Table ═══ */
#table-view{padding:var(--space-4);width:100%}
#table-view .filter-bar{padding:var(--space-2) var(--space-3);background:var(--bg-surface);border:1px solid var(--border-default);color:var(--text-primary);border-radius:var(--radius-sm);width:280px;font-size:13px;margin-bottom:var(--space-4);outline:none}
#table-view .filter-bar:focus{border-color:var(--accent-blue)}
#table-view table{width:100%;border-collapse:collapse;font-size:13px}
#table-view th{text-align:left;padding:var(--space-2) var(--space-3);color:var(--text-muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border-default);position:sticky;top:0;background:var(--bg-base);z-index:1}
#table-view td{padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-muted);vertical-align:top}
#table-view tr:hover td{background:var(--bg-elevated)}
#table-view tr.unlabeled td{opacity:0.5}
#table-view .badge{display:inline-block;padding:1px 8px;border-radius:var(--radius-lg);font-size:11px}
#table-view .badge-warn{border:1px solid var(--accent-orange);color:var(--accent-orange)}

/* ═══ ADR ═══ */
#adr-view{padding:var(--space-4);width:100%;max-width:860px}
#adr-view .adr-item{margin-bottom:var(--space-3);padding:var(--space-4);background:var(--bg-surface);border:1px solid var(--border-muted);border-radius:var(--radius-md);cursor:pointer;transition:all .15s}
#adr-view .adr-item:hover{border-color:var(--border-default)}
#adr-view .adr-title{font-size:15px;font-weight:600;margin-bottom:var(--space-1)}
#adr-view .adr-meta{font-size:11px;color:var(--text-muted);margin-bottom:var(--space-3)}
#adr-view .adr-content{display:none;font-size:13px;line-height:1.7;color:var(--text-secondary);padding-top:var(--space-3);border-top:1px solid var(--border-muted)}
#adr-view .adr-content.open{display:block}
#adr-view .adr-content h1,.adr-content h2{font-size:14px;color:var(--text-primary);margin:var(--space-3) 0 var(--space-1)}
#adr-view .adr-content ul,.adr-content ol{margin:var(--space-1) 0;padding-left:var(--space-5)}
#adr-view .adr-content code{background:var(--bg-elevated);padding:1px 5px;border-radius:3px;font-size:12px}
#adr-view .adr-content pre{background:var(--bg-elevated);padding:var(--space-3);border-radius:var(--radius-sm);overflow-x:auto;font-size:12px}

/* ═══ Search ═══ */
#search-view{padding:var(--space-4);width:100%;max-width:860px}
#search-view .search-bar{width:100%;padding:var(--space-3) var(--space-4);background:var(--bg-surface);border:1px solid var(--border-default);color:var(--text-primary);border-radius:var(--radius-md);font-size:15px;margin-bottom:var(--space-4);outline:none}
#search-view .search-bar:focus{border-color:var(--accent-blue)}
#search-view .result-item{padding:var(--space-4);margin-bottom:var(--space-2);background:var(--bg-surface);border:1px solid var(--border-muted);border-radius:var(--radius-md);cursor:pointer;transition:all .15s}
#search-view .result-item:hover{border-color:var(--border-default)}
#search-view .result-type{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--space-1)}
#search-view .result-title{font-size:14px;font-weight:600}
#search-view .result-detail{font-size:12px;color:var(--text-secondary);margin-top:var(--space-1)}

/* ═══ Empty states ═══ */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;height:220px;color:var(--text-muted);text-align:center;padding:var(--space-8)}
.empty-state .empty-icon{font-size:32px;margin-bottom:var(--space-3);opacity:0.3}
.empty-state .empty-title{font-size:14px;color:var(--text-secondary);margin-bottom:var(--space-1)}
.empty-state .empty-hint{font-size:12px}

/* ═══ Layer colors ═══ */
.layer-基础设施{fill:#6b7280}
.layer-数据获取{fill:#58a6ff}
.layer-分析引擎{fill:#d29922}
.layer-业务逻辑{fill:#3fb950}
.layer-脚本层{fill:#e879f9}
.layer-服务层{fill:#a371f7}
.layer-未分层{fill:#484f58}
</style>
</head>
<body>
<header role="tablist">
  <button role="tab" aria-selected="true" class="active" data-tab="graph">依赖图</button>
  <button role="tab" aria-selected="false" data-tab="table">模块清单</button>
  <button role="tab" aria-selected="false" data-tab="adr">决策日志</button>
  <button role="tab" aria-selected="false" data-tab="search">检索</button>
  <span class="spacer"></span>
  <span class="info" id="graph-info"></span>
</header>
<main>
  <div id="tab-graph" class="tab active" role="tabpanel">
    <svg id="graph-svg"></svg>
  </div>
  <div id="tab-table" class="tab" role="tabpanel"><div id="table-view"></div></div>
  <div id="tab-adr" class="tab" role="tabpanel"><div id="adr-view"></div></div>
  <div id="tab-search" class="tab" role="tabpanel"><div id="search-view"></div></div>
  <aside class="side-panel" id="side-panel" aria-label="模块详情">
    <div class="side-panel-header">
      <div><h3 id="sp-title"></h3><div class="path" id="sp-path"></div></div>
      <button class="side-panel-close" onclick="document.getElementById('side-panel').classList.remove('open')" aria-label="关闭面板">&times;</button>
    </div>
    <div class="side-panel-body">
      <div class="card"><label class="card-label">标注名称</label><input id="edit-label"></div>
      <div class="card"><label class="card-label">备注</label><textarea id="edit-notes" rows="3"></textarea></div>
      <div class="card"><label class="card-label">标签（逗号分隔）</label><input id="edit-tags"></div>
      <div class="card"><label class="card-label">统计</label><div class="meta-row" id="sp-meta"></div></div>
      <div class="card"><label class="card-label">被依赖</label><div id="sp-deps"></div></div>
    </div>
    <div class="side-panel-footer"><button onclick="saveCurate()">保存标注</button></div>
  </aside>
</main>
<script>
let data = { nodes: [], edges: [] };
let selectedNode = null;
const LAYER_CLASSES = {
  '基础设施':'layer-基础设施','数据获取':'layer-数据获取','分析引擎':'layer-分析引擎',
  '业务逻辑':'layer-业务逻辑','服务层':'layer-服务层','脚本层':'layer-脚本层','未分层':'layer-未分层'
};

(async function(){
  const gres = await fetch('api/graph');
  data = await gres.json();
  document.getElementById('graph-info').textContent = data.nodes.length + ' 模块, ' + data.edges.length + ' 依赖';
  if (data.nodes.length) renderGraph();
  renderTable();
  loadADRs();
  bindTabs();
  bindSearch();
})();

function bindTabs(){
  document.querySelectorAll('header button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('header button[data-tab]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active'); btn.setAttribute('aria-selected','true');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'graph') renderGraph();
    });
  });
}

// ═══ Graph ═══
function renderGraph(){
  const svg = document.getElementById('graph-svg');
  const W = svg.clientWidth || 1200, H = svg.clientHeight || 800;
  svg.innerHTML = '';
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label','模块依赖关系图');

  const nodes = data.nodes, edges = data.edges;
  if (!nodes.length) {
    const t = mkSvg('text',{x:W/2,y:H/2,'text-anchor':'middle','class':'empty-text'});
    t.textContent = '未找到模块 — 运行 npm install -D dependency-cruiser 后重新扫描';
    svg.appendChild(t); return;
  }

  const cx = W/2, cy = H/2;

  // Build d3-compatible data with pre-calculated radii
  const simNodes = nodes.map(n => ({
    id: n.id,
    radius: Math.max(7, Math.min(28, 8 + (n.dependents||[]).length * 2))
  }));
  const simEdges = edges.map(e => ({ source: e.source, target: e.target }));

  // d3 force simulation with collision prevention
  const sim = d3.forceSimulation(simNodes)
    .force('link', d3.forceLink(simEdges).id(d => d.id).distance(60))
    .force('charge', d3.forceManyBody().strength(-500))
    .force('center', d3.forceCenter(cx, cy))
    .force('collide', d3.forceCollide().radius(d => d.radius + 8))
    .alphaDecay(0.02)
    .stop();

  // Tick synchronously until settled
  const totalTicks = Math.min(500, Math.max(300, nodes.length * 8));
  for (let i = 0; i < totalTicks; i++) sim.tick();

  // Build position lookup
  const pos = {};
  simNodes.forEach(n => { pos[n.id] = { x: n.x, y: n.y, radius: n.radius }; });

  const edgeSet = new Set();
  for (const e of edges) {
    const key = [e.source, e.target].sort().join('::');
    if (edgeSet.has(key)) continue; edgeSet.add(key);
    if (!pos[e.source] || !pos[e.target]) continue;
    svg.appendChild(mkSvg('line',{x1:pos[e.source].x,y1:pos[e.source].y,x2:pos[e.target].x,y2:pos[e.target].y}));
  }

  for (const n of nodes) {
    const p = pos[n.id]; if (!p) continue;
    const radius = p.radius;
    const depCount = (n.dependents||[]).length;

    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('role','button'); g.setAttribute('tabindex','0');
    g.setAttribute('aria-label', n.label + ' — ' + n.layer + ', ' + depCount + ' 个依赖');

    const circle = mkSvg('circle',{cx:p.x,cy:p.y,r:radius,'data-id':n.id});
    const lc = LAYER_CLASSES[n.layer] || 'layer-未分层';
    circle.classList.add(lc);
    if (!n.hasJSDoc && !n.hasCuration) circle.classList.add('unlabeled');
    if (depCount >= 5) circle.classList.add('core');
    circle.addEventListener('click', () => selectNode(n));

    // background rectangle behind label for readability
    const labelW = n.label.length * 7 + 8;
    const lbg = mkSvg('rect',{x:p.x+radius+2,y:p.y-7,width:labelW,height:14,rx:3,'class':'node-label-bg'});

    const text = mkSvg('text',{x:p.x+radius+6,y:p.y+4,'class':'node-label'});
    text.textContent = n.label;

    g.appendChild(circle); g.appendChild(lbg); g.appendChild(text);
    g.addEventListener('keydown', e => { if (e.key === 'Enter') selectNode(n); });
    g.addEventListener('click', () => selectNode(n));
    svg.appendChild(g);
  }
}

function mkSvg(tag, attrs){
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function selectNode(n){
  selectedNode = n;
  document.getElementById('sp-title').textContent = n.label;
  document.getElementById('sp-path').textContent = n.path;
  document.getElementById('edit-label').value = n.label;
  document.getElementById('edit-notes').value = n.brief || '';
  document.getElementById('edit-tags').value = (n.tags||[]).join(', ');
  document.getElementById('sp-meta').innerHTML =
    '<span>层</span><span>' + esc(n.layer) + '</span>' +
    '<span>被依赖</span><span>' + (n.dependents||[]).length + ' 个模块</span>' +
    '<span>依赖数</span><span>' + n.depCount + ' 个模块</span>';
  document.getElementById('sp-deps').innerHTML = (n.dependents||[]).length
    ? (n.dependents||[]).map(d => '<span class="dep-chip" onclick="selectByPath(\\'' + escAttr(d) + '\\')" tabindex="0" role="button">' + esc(d.split('/').pop()) + '</span>').join('')
    : '<span style="font-size:12px;color:var(--text-muted)">未被任何模块依赖</span>';
  document.getElementById('side-panel').classList.add('open');
}

async function saveCurate(){
  if (!selectedNode) return;
  const label = document.getElementById('edit-label').value;
  const notes = document.getElementById('edit-notes').value;
  const tags = document.getElementById('edit-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
  await fetch('api/curate',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:selectedNode.path,label,notes,tags})});
  const n = data.nodes.find(x => x.id === selectedNode.path);
  if (n) { n.label = label; n.brief = notes; n.tags = tags; n.hasCuration = true; }
  document.getElementById('side-panel').classList.remove('open'); selectedNode = null;
  renderGraph(); renderTable();
}

function selectByPath(p){
  document.querySelectorAll('header button[data-tab]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab=graph]').classList.add('active'); document.querySelector('[data-tab=graph]').setAttribute('aria-selected','true');
  document.getElementById('tab-graph').classList.add('active');
  const n = data.nodes.find(x => x.id === p);
  if (n) selectNode(n);
}

// ═══ Table ═══
function renderTable(filter){
  let rows = data.nodes;
  if (filter) { const q = filter.toLowerCase(); rows = rows.filter(n => n.label.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || n.layer.includes(q)); }
  const container = document.getElementById('table-view');
  container.innerHTML = '<input type="text" class="filter-bar" placeholder="筛选模块..." oninput="renderTable(this.value)" value="' + escAttr(filter||'') + '" aria-label="筛选模块">' +
    '<table><thead><tr><th>模块</th><th>职责</th><th>层</th><th>被依赖</th><th>状态</th></tr></thead><tbody>' +
    rows.map(n =>
      '<tr class="' + (!n.hasJSDoc && !n.hasCuration ? 'unlabeled' : '') + '" onclick="selectByPath(\\'' + escAttr(n.path) + '\\')" tabindex="0" role="button" style="cursor:pointer">' +
      '<td><b>' + esc(n.label) + '</b><br><span style="font-size:10px;color:var(--text-muted)">' + esc(n.path) + '</span></td>' +
      '<td style="max-width:240px">' + esc(n.brief || '—') + '</td>' +
      '<td>' + esc(n.layer) + '</td>' +
      '<td>' + (n.dependents||[]).length + '</td>' +
      '<td>' + (!n.hasJSDoc && !n.hasCuration ? '<span class="badge badge-warn">待标注</span>' : (n.tags||[]).map(t => '<span class="tag tag-' + escAttr(t.replace(/[^a-zA-Z0-9_-]/g,'')) + '">' + esc(t) + '</span>').join('')) + '</td></tr>'
    ).join('') + '</tbody></table>';
}

// ═══ ADR ═══
async function loadADRs(){
  const res = await fetch('api/adrs'); const adrs = await res.json(); const container = document.getElementById('adr-view');
  if (!adrs.length) { container.innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span><span class="empty-title">暂无决策记录</span><span class="empty-hint">在 docs/adr/ 下添加 ADR 文件</span></div>'; return; }
  container.innerHTML = adrs.map(a =>
    '<div class="adr-item" onclick="toggleADR(this)" tabindex="0" role="button">' +
    '<div class="adr-title">' + esc(a.title) + '</div><div class="adr-meta">' + esc(a.date) + ' · ' + esc(a.status) + ' · ' + esc(a.file) + '</div>' +
    '<div class="adr-content">' + simpleMD(a.content) + '</div></div>'
  ).join('');
}
function toggleADR(el){ el.querySelector('.adr-content').classList.toggle('open'); }

// ═══ Search ═══
function bindSearch(){
  document.getElementById('search-view').innerHTML = '<input type="text" class="search-bar" placeholder="搜索模块、标注、决策..." onkeyup="doSearch(this.value)" aria-label="全局搜索"><div id="search-results"><div class="empty-state"><span class="empty-icon">🔍</span><span class="empty-title">输入关键词开始搜索</span><span class="empty-hint">支持模块名、JSDoc、标注、决策内容</span></div></div>';
}
async function doSearch(q){
  const container = document.getElementById('search-results');
  if (!q) { container.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span><span class="empty-title">输入关键词开始搜索</span></div>'; return; }
  const res = await fetch('api/search?q=' + encodeURIComponent(q)); const results = await res.json();
  if (!results.length) { container.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span><span class="empty-title">未找到匹配结果</span></div>'; return; }
  container.innerHTML = results.map(r =>
    '<div class="result-item" onclick="navigateResult(\\'' + r.type + '\\', \\'' + escAttr(r.path||r.file||'') + '\\')" tabindex="0" role="button">' +
    '<div class="result-type">' + esc(r.type === 'module' ? '模块' : '决策') + '</div>' +
    '<div class="result-title">' + esc(r.label || r.title) + '</div>' +
    '<div class="result-detail">' + esc(r.brief || r.layer || '') + '</div></div>'
  ).join('');
}
function navigateResult(type, id){
  if (type === 'module') { selectByPath(id); return; }
  document.querySelectorAll('header button[data-tab]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab=adr]').classList.add('active'); document.querySelector('[data-tab=adr]').setAttribute('aria-selected','true');
  document.getElementById('tab-adr').classList.add('active');
}

// ═══ Helpers ═══
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s){ return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/'/g,'&#39;').replace(/\\\\/g,'\\\\\\\\'); }
function simpleMD(md){ return esc(md).replace(/^### (.+)/gm,'<h3>$1</h3>').replace(/^## (.+)/gm,'<h2>$1</h2>').replace(/^# (.+)/gm,'<h1>$1</h1>').replace(/^- (.+)/gm,'<li>$1</li>').replace(/\\*\\*(.+?)\\*\\*/g,'<b>$1</b>').replace(/\\n/g,'<br>'); }
</script>
</body>
</html>`);
}

// ═══════════════════════════════════════════════════════
//  入口
// ═══════════════════════════════════════════════════════

async function main() {
  console.log('🔍 扫描项目结构...');
  graphData = await buildGraph();
  modulesList = buildModulesList();
  adrList = loadADRs();

  if (SCAN_ONLY) {
    console.log('');
    console.log('📊 扫描结果:');
    console.log('   模块数: ' + graphData.nodes.length);
    console.log('   依赖边: ' + graphData.edges.length);
    const unlabeled = graphData.nodes.filter(n => !n.hasJSDoc && !n.hasCuration).length;
    console.log('   待标注: ' + unlabeled + ' / ' + graphData.nodes.length);
    console.log('   分层分布:');
    const layers = {};
    for (const n of graphData.nodes) {
      layers[n.layer] = (layers[n.layer] || 0) + 1;
    }
    for (const [layer, count] of Object.entries(layers)) {
      console.log('     ' + layer + ': ' + count);
    }
    return;
  }

  startServer();
}

main().catch(err => {
  console.error('启动失败:', err.message);
  console.error('提示: 确保已安装 dependency-cruiser (npm install -D dependency-cruiser)');
  process.exit(1);
});
