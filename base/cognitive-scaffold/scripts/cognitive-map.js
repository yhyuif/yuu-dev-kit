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
    return (result && result.output && result.output.modules) ? result.output.modules : [];
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
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#e0e0e0;overflow:hidden;height:100vh;display:flex;flex-direction:column}
header{background:#16213e;padding:8px 16px;display:flex;align-items:center;gap:2px;border-bottom:1px solid #0f3460}
header button{padding:8px 16px;border:none;background:transparent;color:#a0a0c0;cursor:pointer;font-size:13px;border-radius:6px 6px 0 0;transition:all .15s}
header button:hover{color:#fff;background:#0f34604d}
header button.active{color:#fff;background:#0f3460;font-weight:600}
header .spacer{flex:1}
header .info{font-size:12px;color:#666}
main{flex:1;display:flex;overflow:hidden}
.tab{display:none;flex:1;overflow:auto}
.tab.active{display:flex}
/* Tab 1: Graph */
#graph-svg{width:100%;height:100%}
#graph-svg circle{stroke-width:2;cursor:pointer;transition:r .15s}
#graph-svg circle:hover{stroke:#fff;stroke-width:3}
#graph-svg circle.core{stroke:#ffd700}
#graph-svg circle.unlabeled{stroke-dasharray:4 2;stroke:#666}
#graph-svg line{stroke:#2a2a4a;stroke-width:1}
#graph-svg text{font-size:10px;fill:#ccc;pointer-events:none;user-select:none}
/* Side panel */
.side-panel{width:320px;background:#16213e;border-left:1px solid #0f3460;padding:16px;overflow-y:auto;display:none;flex-shrink:0}
.side-panel.open{display:block}
.side-panel h3{font-size:16px;margin-bottom:4px}
.side-panel .path{font-size:11px;color:#666;margin-bottom:12px;word-break:break-all}
.side-panel .field{margin-bottom:12px}
.side-panel label{display:block;font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase}
.side-panel input,.side-panel textarea{width:100%;padding:8px;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;border-radius:4px;font-size:13px}
.side-panel textarea{min-height:80px;resize:vertical;font-family:inherit}
.side-panel button{padding:8px 16px;background:#0f3460;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px}
.side-panel button:hover{background:#1a4a7a}
.side-panel .dep-list{font-size:12px;color:#888}
.side-panel .dep-list span{display:inline-block;background:#0f3460;padding:2px 8px;border-radius:10px;margin:2px 4px 2px 0;font-size:11px;color:#ccc;cursor:pointer}
.side-panel .tag{display:inline-block;padding:2px 8px;border-radius:10px;margin:2px;font-size:11px}
.side-panel .tag.tech-debt{background:#663300;color:#ffaa00}
.side-panel .tag.core{background:#003366;color:#66aaff}
.side-panel .tag.needs-split{background:#660033;color:#ff66aa}
/* Tab 2: Table */
#table-view{padding:16px;width:100%}
#table-view table{width:100%;border-collapse:collapse;font-size:13px}
#table-view th{text-align:left;padding:10px 12px;background:#16213e;border-bottom:2px solid #0f3460;position:sticky;top:0;z-index:1}
#table-view td{padding:8px 12px;border-bottom:1px solid #1a1a3a}
#table-view tr:hover td{background:#16213e55}
#table-view tr.unlabeled td{color:#555}
#table-view .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px}
#table-view .badge.warn{background:#663300;color:#ffaa00}
#table-view input[type=text]{padding:8px 12px;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;border-radius:4px;width:240px;margin-bottom:12px}
/* Tab 3: ADR */
#adr-view{padding:16px;width:100%;max-width:800px}
#adr-view .adr-item{margin-bottom:16px;padding:16px;background:#16213e;border-radius:8px;cursor:pointer;transition:background .15s}
#adr-view .adr-item:hover{background:#1a2a4e}
#adr-view .adr-item .adr-title{font-size:15px;font-weight:600;margin-bottom:4px}
#adr-view .adr-item .adr-meta{font-size:11px;color:#666}
#adr-view .adr-item .adr-content{display:none;margin-top:12px;font-size:13px;line-height:1.7;color:#bbb}
#adr-view .adr-item .adr-content.open{display:block}
#adr-view .adr-item .adr-content h1,#adr-view .adr-content h2{font-size:14px;color:#fff;margin:12px 0 4px}
#adr-view .adr-item .adr-content ul,#adr-view .adr-content ol{margin:4px 0;padding-left:20px}
#adr-view .adr-item .adr-content code{background:#1a1a2e;padding:1px 5px;border-radius:3px}
#adr-view .adr-item .adr-content pre{background:#1a1a2e;padding:12px;border-radius:4px;overflow-x:auto;font-size:12px}
/* Tab 4: Search */
#search-view{padding:16px;width:100%;max-width:800px}
#search-view input[type=text]{padding:12px 16px;background:#1a1a2e;border:1px solid #0f3460;color:#e0e0e0;border-radius:8px;width:100%;font-size:15px;margin-bottom:16px}
#search-view .result-item{padding:12px;margin-bottom:8px;background:#16213e;border-radius:6px;cursor:pointer}
#search-view .result-item:hover{background:#1a2a4e}
#search-view .result-item .result-type{font-size:10px;color:#666;text-transform:uppercase}
#search-view .result-item .result-title{font-size:14px;font-weight:600}
#search-view .result-item .result-detail{font-size:12px;color:#888}
.empty-state{display:flex;align-items:center;justify-content:center;height:200px;color:#555;font-size:14px}
/* Layer colors */
.layer-基础设施{fill:#6b7280}
.layer-数据获取{fill:#3b82f6}
.layer-分析引擎{fill:#f59e0b}
.layer-业务逻辑{fill:#10b981}
.layer-服务层{fill:#8b5cf6}
.layer-未分层{fill:#4b5563}
</style>
</head>
<body>
<header>
  <button class="active" data-tab="graph">依赖图</button>
  <button data-tab="table">模块清单</button>
  <button data-tab="adr">决策日志</button>
  <button data-tab="search">检索</button>
  <span class="spacer"></span>
  <span class="info" id="graph-info"></span>
</header>
<main>
  <div id="tab-graph" class="tab active">
    <svg id="graph-svg"></svg>
  </div>
  <div id="tab-table" class="tab"><div id="table-view"></div></div>
  <div id="tab-adr" class="tab"><div id="adr-view"></div></div>
  <div id="tab-search" class="tab"><div id="search-view"></div></div>
  <div class="side-panel" id="side-panel"></div>
</main>
<script>
// ─── State ───
let data = { nodes: [], edges: [] };
let selectedNode = null;
const LAYER_CLASSES = {
  '基础设施':'layer-基础设施','数据获取':'layer-数据获取','分析引擎':'layer-分析引擎',
  '业务逻辑':'layer-业务逻辑','服务层':'layer-服务层','未分层':'layer-未分层'
};

// ─── Init ───
(async function(){
  const gres = await fetch('/api/graph');
  data = await gres.json();
  document.getElementById('graph-info').textContent = data.nodes.length + ' 模块, ' + data.edges.length + ' 依赖';
  if (data.nodes.length) renderGraph();
  renderTable();
  loadADRs();
  bindTabs();
  bindSearch();
})();

// ─── Tabs ───
function bindTabs(){
  document.querySelectorAll('header button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('header button[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'graph') renderGraph();
    });
  });
}

// ─── Graph (Tab 1) ───
function renderGraph(){
  const svg = document.getElementById('graph-svg');
  const W = svg.clientWidth || 1200, H = svg.clientHeight || 800;
  svg.innerHTML = '';
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

  const nodes = data.nodes, edges = data.edges;
  if (!nodes.length) {
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x', W/2); t.setAttribute('y', H/2); t.setAttribute('text-anchor','middle');
    t.setAttribute('fill','#555'); t.textContent = '未找到模块（运行 npm install -D dependency-cruiser 后重新扫描）';
    svg.appendChild(t);
    return;
  }

  // Simple force layout
  const pos = {};
  const cx = W/2, cy = H/2, r = Math.min(W, H) * 0.35;
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  // Relax
  for (let iter = 0; iter < 50; iter++) {
    for (const n of nodes) {
      let fx = 0, fy = 0;
      const pn = pos[n.id];
      // Repulsion between all pairs
      for (const m of nodes) {
        if (n.id === m.id) continue;
        const pm = pos[m.id];
        let dx = pn.x - pm.x, dy = pn.y - pm.y;
        const dist = Math.max(1, Math.sqrt(dx*dx + dy*dy));
        const force = 500 / (dist * dist);
        fx += (dx / dist) * force; fy += (dy / dist) * force;
      }
      // Attraction along edges
      for (const e of edges) {
        if (e.source === n.id && pos[e.target]) {
          let dx = pos[e.target].x - pn.x, dy = pos[e.target].y - pn.y;
          const dist = Math.max(1, Math.sqrt(dx*dx + dy*dy));
          fx += dx * 0.01; fy += dy * 0.01;
        }
        if (e.target === n.id && pos[e.source]) {
          let dx = pos[e.source].x - pn.x, dy = pos[e.source].y - pn.y;
          const dist = Math.max(1, Math.sqrt(dx*dx + dy*dy));
          fx += dx * 0.01; fy += dy * 0.01;
        }
      }
      // Center gravity
      fx += (cx - pn.x) * 0.001;
      fy += (cy - pn.y) * 0.001;
      pn.x += fx * 0.5; pn.y += fy * 0.5;
    }
  }

  // Draw edges
  const edgeSet = new Set();
  for (const e of edges) {
    const key = [e.source, e.target].sort().join('::');
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    if (!pos[e.source] || !pos[e.target]) continue;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', pos[e.source].x); line.setAttribute('y1', pos[e.source].y);
    line.setAttribute('x2', pos[e.target].x); line.setAttribute('y2', pos[e.target].y);
    line.setAttribute('opacity', '0.3');
    svg.appendChild(line);
  }

  // Draw nodes
  for (const n of nodes) {
    const p = pos[n.id];
    if (!p) continue;
    const depCount = n.dependents ? n.dependents.length : 0;
    const radius = Math.max(6, Math.min(30, 8 + depCount * 2));

    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('cx', p.x); circle.setAttribute('cy', p.y); circle.setAttribute('r', radius);
    circle.setAttribute('data-id', n.id);
    const layerClass = LAYER_CLASSES[n.layer] || 'layer-未分层';
    circle.classList.add(layerClass);
    if (!n.hasJSDoc && !n.hasCuration) circle.classList.add('unlabeled');
    if ((n.dependents||[]).length >= 5) circle.classList.add('core');

    circle.addEventListener('click', () => selectNode(n, circle));
    svg.appendChild(circle);

    // Label
    const text = document.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('x', p.x + radius + 4); text.setAttribute('y', p.y + 4);
    text.textContent = n.label;
    svg.appendChild(text);
  }
}

function selectNode(n, circle){
  selectedNode = n;
  const panel = document.getElementById('side-panel');
  panel.classList.add('open');
  panel.innerHTML =
    '<h3>' + esc(n.label) + '</h3>' +
    '<div class="path">' + esc(n.path) + '</div>' +
    '<div class="field"><label>标注名称</label><input id="edit-label" value="' + escAttr(n.label) + '"></div>' +
    '<div class="field"><label>备注</label><textarea id="edit-notes">' + esc(n.brief) + '</textarea></div>' +
    '<div class="field"><label>标签（逗号分隔）</label><input id="edit-tags" value="' + escAttr((n.tags||[]).join(', ')) + '"></div>' +
    '<div class="field"><label>层</label><span style="font-size:13px">' + esc(n.layer) + '</span></div>' +
    '<div class="field"><label>被依赖 (' + (n.dependents||[]).length + ')</label><div class="dep-list">' + (n.dependents||[]).map(d => '<span onclick="selectByPath(\\'' + escAttr(d) + '\\')">' + esc(d.split('/').pop()) + '</span>').join('') + '</div>' +
    '<button onclick="saveCurate()">💾 保存标注</button>';
}

async function saveCurate(){
  if (!selectedNode) return;
  const label = document.getElementById('edit-label').value;
  const notes = document.getElementById('edit-notes').value;
  const tags = document.getElementById('edit-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
  await fetch('/api/curate', {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({path: selectedNode.path, label, notes, tags})
  });
  // Update local data
  const n = data.nodes.find(x => x.id === selectedNode.path);
  if (n) { n.label = label; n.brief = notes; n.tags = tags; n.hasCuration = true; }
  document.getElementById('side-panel').classList.remove('open');
  renderGraph();
  renderTable();
}

function selectByPath(p){
  document.querySelectorAll('header button[data-tab]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab=graph]').classList.add('active');
  document.getElementById('tab-graph').classList.add('active');
  const n = data.nodes.find(x => x.id === p);
  if (n) selectNode(n, null);
}

// ─── Table (Tab 2) ───
function renderTable(filter){
  let rows = data.nodes;
  if (filter) {
    const q = filter.toLowerCase();
    rows = rows.filter(n => n.label.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || n.layer.includes(q));
  }
  const container = document.getElementById('table-view');
  container.innerHTML =
    '<input type="text" placeholder="筛选模块..." oninput="renderTable(this.value)" value="' + escAttr(filter||'') + '">' +
    '<table><thead><tr><th>模块</th><th>职责</th><th>层</th><th>被依赖</th><th>状态</th></tr></thead><tbody>' +
    rows.map(n =>
      '<tr class="' + (!n.hasJSDoc && !n.hasCuration ? 'unlabeled' : '') + '" onclick="selectByPath(\\'' + escAttr(n.path) + '\\')" style="cursor:pointer">' +
      '<td><b>' + esc(n.label) + '</b><br><span style="font-size:10px;color:#666">' + esc(n.path) + '</span></td>' +
      '<td style="max-width:240px">' + esc(n.brief || '—') + '</td>' +
      '<td>' + esc(n.layer) + '</td>' +
      '<td>' + (n.dependents||[]).length + '</td>' +
      '<td>' + (!n.hasJSDoc && !n.hasCuration ? '<span class="badge warn">待标注</span>' : (n.tags||[]).map(t => '<span class="tag tag-' + escAttr(t.replace(/[^a-zA-Z0-9_-]/g,'')) + '">' + esc(t) + '</span>').join('')) + '</td>' +
      '</tr>'
    ).join('') +
    '</tbody></table>';
}

// ─── ADR (Tab 3) ───
async function loadADRs(){
  const res = await fetch('/api/adrs');
  const adrs = await res.json();
  const container = document.getElementById('adr-view');
  if (!adrs.length) {
    container.innerHTML = '<div class="empty-state">暂无决策记录（在 docs/adr/ 下添加 ADR 文件）</div>';
    return;
  }
  container.innerHTML = adrs.map(a =>
    '<div class="adr-item" onclick="toggleADR(this)">' +
    '<div class="adr-title">' + esc(a.title) + '</div>' +
    '<div class="adr-meta">' + esc(a.date) + ' · ' + esc(a.status) + ' · ' + esc(a.file) + '</div>' +
    '<div class="adr-content">' + simpleMD(a.content) + '</div>' +
    '</div>'
  ).join('');
}
function toggleADR(el){
  const content = el.querySelector('.adr-content');
  content.classList.toggle('open');
}

// ─── Search (Tab 4) ───
function bindSearch(){
  const input = document.querySelector('#search-view');
  input.innerHTML = '<input type="text" placeholder="搜索模块、标注、决策..." onkeyup="doSearch(this.value)"><div id="search-results"><div class="empty-state">输入关键词开始搜索</div></div>';
}
async function doSearch(q){
  const container = document.getElementById('search-results');
  if (!q) { container.innerHTML = '<div class="empty-state">输入关键词开始搜索</div>'; return; }
  const res = await fetch('/api/search?q=' + encodeURIComponent(q));
  const results = await res.json();
  if (!results.length) { container.innerHTML = '<div class="empty-state">未找到匹配结果</div>'; return; }
  container.innerHTML = results.map(r =>
    '<div class="result-item" onclick="navigateResult(\\'' + r.type + '\\', \\'' + escAttr(r.path||r.file||'') + '\\')">' +
    '<div class="result-type">' + esc(r.type === 'module' ? '模块' : '决策') + '</div>' +
    '<div class="result-title">' + esc(r.label || r.title) + '</div>' +
    '<div class="result-detail">' + esc(r.brief || r.layer || '') + '</div>' +
    '</div>'
  ).join('');
}
function navigateResult(type, id){
  if (type === 'module') {
    selectByPath(id);
  } else {
    document.querySelectorAll('header button[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab=adr]').classList.add('active');
    document.getElementById('tab-adr').classList.add('active');
  }
}

// ─── Helpers ───
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s){ return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/'/g,'&#39;').replace(/\\\\/g,'\\\\\\\\'); }
function simpleMD(md){
  return esc(md)
    .replace(/^### (.+)/gm,'<h3>$1</h3>')
    .replace(/^## (.+)/gm,'<h2>$1</h2>')
    .replace(/^# (.+)/gm,'<h1>$1</h1>')
    .replace(/^- (.+)/gm,'<li>$1</li>')
    .replace(/\\*\\*(.+?)\\*\\*/g,'<b>$1</b>')
    .replace(/\\n/g,'<br>');
}
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
