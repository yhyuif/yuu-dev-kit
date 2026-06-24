/**
 * @module 健康检查
 * @brief /livez + /readyz + /health 端点，IETF draft 格式
 * @layer 基础设施
 *
 * 用法:
 *   import { registerHealth } from './lib/health.js';
 *   registerHealth(server);  // 原生 Node HTTP server
 *   // → GET /livez  GET /readyz  GET /health
 *
 *   // 注册依赖检查（/readyz 用）
 *   healthChecks.set('db', async () => { await db.raw('SELECT 1'); });
 */

// ═══════════════════════════════════════════════════════════
//  依赖检查注册表
// ═══════════════════════════════════════════════════════════

const healthChecks = new Map();

/**
 * 注册一个健康检查
 * @param {string}   name    组件名（如 "db", "redis"）
 * @param {Function} check   async () => { ... } 抛异常表示不健康
 */
function addHealthCheck(name, check) {
  healthChecks.set(name, check);
}

// ═══════════════════════════════════════════════════════════
//  端点实现
// ═══════════════════════════════════════════════════════════

const serviceId = crypto?.randomUUID ? crypto.randomUUID() : 'n/a';
const startTime = Date.now();

/** 通用 /health 和 /livez — 只检查进程存活 */
function livenessHandler(_req, res) {
  res.writeHead(200, { 'Content-Type': 'application/health+json' });
  res.end(JSON.stringify({
    status: 'pass',
    service_id: serviceId,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
  }));
}

/** /readyz — 检查所有注册的依赖 */
async function readinessHandler(_req, res) {
  const checks = {};
  let overallStatus = 'pass';

  for (const [name, check] of healthChecks) {
    const checkStart = Date.now();
    try {
      await check();
      checks[`${name}:responseTime`] = [{
        componentId: name,
        componentType: 'datastore',
        observedValue: Date.now() - checkStart,
        observedUnit: 'ms',
        status: 'pass',
        time: new Date().toISOString(),
      }];
    } catch (err) {
      checks[`${name}:responseTime`] = [{
        componentId: name,
        componentType: 'datastore',
        output: err.message,
        status: 'fail',
        time: new Date().toISOString(),
      }];
      overallStatus = 'fail';
    }
  }

  const statusCode = overallStatus === 'pass' ? 200 : 503;
  res.writeHead(statusCode, { 'Content-Type': 'application/health+json' });
  res.end(JSON.stringify({
    status: overallStatus,
    service_id: serviceId,
    checks,
  }));
}

// ═══════════════════════════════════════════════════════════
//  注册到 HTTP Server
// ═══════════════════════════════════════════════════════════

/**
 * 将健康检查端点注册到原生 Node HTTP server。
 * 拦截匹配路径的请求，不匹配则放行。
 *
 * @param {import('http').Server} server
 */
function registerHealth(server) {
  const _oldEmit = server.emit;
  server.emit = function (event, ...args) {
    if (event !== 'request') return _oldEmit.call(this, event, ...args);
    const [req, res] = args;
    const url = req.url || '';
    const method = req.method || 'GET';

    if (method === 'GET' && (url === '/health' || url === '/livez')) {
      return livenessHandler(req, res);
    }
    if (method === 'GET' && url === '/readyz') {
      return readinessHandler(req, res);
    }

    return _oldEmit.call(this, event, ...args);
  };
}

export { addHealthCheck, registerHealth, livenessHandler, readinessHandler };
