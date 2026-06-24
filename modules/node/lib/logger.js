/**
 * @module 结构化日志
 * @brief pino 预配置实例 — JSON → stdout，开箱即用
 * @layer 基础设施
 *
 * 用法:
 *   import { logger } from './lib/logger.js';
 *   logger.info({ userId: '123' }, 'User logged in');
 *   logger.error({ err }, 'Payment failed');
 *
 * 环境变量:
 *   LOG_LEVEL=info|debug|warn|error  默认 info
 *   NODE_ENV=development             自动 pretty-print
 *   SERVICE_NAME=my-app              默认从 package.json 读取
 */

import pino from 'pino';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── 服务名 ──────────────────────────────────────────────

let serviceName = process.env.SERVICE_NAME;
if (!serviceName) {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    serviceName = pkg.name || 'unknown';
  } catch {
    serviceName = 'unknown';
  }
}

const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

// ─── pino 配置 ───────────────────────────────────────────

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  name: serviceName,

  // 生产: JSON; 开发: 彩色 pretty-print
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),

  // 时间戳: ISO 8601 UTC
  timestamp: pino.stdTimeFunctions.isoTime,

  // 自动脱敏
  redact: {
    paths: [
      'password', 'token', 'secret', 'authorization',
      'headers.authorization', 'headers.cookie',
      'body.password', 'body.token', 'body.secret',
    ],
    censor: '[REDACTED]',
  },

  // 序列化 Error 对象
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  // 注入 service 元信息
  base: {
    service: serviceName,
    environment: process.env.NODE_ENV || 'development',
  },
});

// ─── 子 logger 工厂 ──────────────────────────────────────

/** 创建带固定上下文的子 logger */
function childLogger(bindings) {
  return logger.child(bindings);
}

// ─── HTTP 请求日志中间件（适配原生 Node HTTP）─────────────

/**
 * 原生 Node HTTP 请求日志
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {number} durationMs
 */
function logRequest(req, res, durationMs) {
  // 过滤健康检查噪音
  const url = req.url || '/';
  if (/^\/(livez|readyz|health)/.test(url)) return;

  const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
  logger[level]({
    http: {
      method: req.method,
      url,
      status_code: res.statusCode,
      duration_ms: durationMs,
    },
    request_id: req.headers['x-request-id'] || '',
  }, `${req.method} ${url} ${res.statusCode}`);
}

export { logger, childLogger, logRequest };
