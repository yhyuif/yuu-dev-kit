/**
 * @module 统一错误处理
 * @brief RFC 9457 Problem Details — AppError 基类 + HTTP 中间件
 * @layer 基础设施
 *
 * 用法:
 *   import { AppError, ValidationError, errorHandler } from './lib/errors.js';
 *   throw new ValidationError('email', 'Email is required');
 *   // → HTTP 422 { type, title, status, detail, request_id, errors: [...] }
 *
 * 错误码层级:
 *   AUTH_ERROR / AUTH_INVALID_CREDENTIALS / AUTH_EXPIRED_TOKEN
 *   VALIDATION_ERROR / VALIDATION_MISSING_FIELD / VALIDATION_INVALID_FORMAT
 *   NOT_FOUND / RESOURCE_NOT_FOUND
 *   INTERNAL_ERROR
 */

import { randomUUID } from 'node:crypto';

// ═══════════════════════════════════════════════════════════
//  AppError 基类
// ═══════════════════════════════════════════════════════════

class AppError extends Error {
  /**
   * @param {string} code      应用错误码（UPPER_SNAKE_CASE）
   * @param {number} status    HTTP 状态码
   * @param {string} detail   人类可读描述
   * @param {object} [opts]
   * @param {string} [opts.type]  问题类型 URI（默认 about:blank）
   * @param {string} [opts.title] 简短标题
   * @param {object[]} [opts.errors] 字段级错误列表
   * @param {Error} [opts.cause]    原始错误
   */
  constructor(code, status, detail, opts = {}) {
    super(detail);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.type = opts.type || 'about:blank';
    this.title = opts.title || this._defaultTitle(status);
    this.errors = opts.errors || [];
    this.requestId = randomUUID();
    if (opts.cause) this.cause = opts.cause;
  }

  _defaultTitle(status) {
    if (status === 400) return 'Bad Request';
    if (status === 401) return 'Unauthorized';
    if (status === 403) return 'Forbidden';
    if (status === 404) return 'Not Found';
    if (status === 409) return 'Conflict';
    if (status === 422) return 'Validation Error';
    if (status === 429) return 'Too Many Requests';
    if (status >= 500) return 'Internal Server Error';
    return 'Error';
  }

  /** 转为 RFC 9457 格式的 JSON 对象 */
  toJSON() {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      request_id: this.requestId,
      code: this.code,
      ...(this.errors.length > 0 && { errors: this.errors }),
    };
  }
}

// ═══════════════════════════════════════════════════════════
//  具体错误类型
// ═══════════════════════════════════════════════════════════

class ValidationError extends AppError {
  constructor(field, detail) {
    super('VALIDATION_ERROR', 422, detail, {
      errors: [{ detail, pointer: `/data/attributes/${field}` }],
    });
    this.name = 'ValidationError';
  }
}

class AuthError extends AppError {
  constructor(code = 'AUTH_ERROR', status = 401, detail = 'Authentication required') {
    super(code, status, detail);
    this.name = 'AuthError';
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource', detail) {
    super('RESOURCE_NOT_FOUND', 404, detail || `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(detail) {
    super('RESOURCE_CONFLICT', 409, detail);
    this.name = 'ConflictError';
  }
}

class RateLimitError extends AppError {
  constructor(detail = 'Too many requests') {
    super('RATE_LIMIT_EXCEEDED', 429, detail);
    this.name = 'RateLimitError';
  }
}

class InternalError extends AppError {
  constructor(detail = 'Internal server error', cause) {
    super('INTERNAL_ERROR', 500, detail, { cause });
    this.name = 'InternalError';
  }
}

// ═══════════════════════════════════════════════════════════
//  HTTP 错误处理中间件（原生 Node HTTP + Express 兼容）
// ═══════════════════════════════════════════════════════════

/**
 * 包装 HTTP handler，自动捕获异常并返回 RFC 9457 格式响应。
 * 兼容原生 Node http.createServer 和 Express handler。
 *
 * @param {Function} handler  async (req, res) => { ... }
 * @param {object}   [opts]
 * @param {Function} [opts.logger]  错误日志方法（默认 console.error）
 * @returns {Function} (req, res) => { ... }
 */
function errorHandler(handler, opts = {}) {
  const log = opts.logger || console.error;

  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const appErr = err instanceof AppError
        ? err
        : new InternalError('Internal server error', err);

      // 服务端日志（含堆栈）
      log({
        err: appErr.cause || err,
        request_id: appErr.requestId,
        http: { method: req.method, url: req.url },
      }, `Error ${appErr.code}`);

      // 客户端响应（不含堆栈）
      const body = appErr.toJSON();
      const isProd = process.env.NODE_ENV === 'production';

      res.writeHead(appErr.status, {
        'Content-Type': 'application/problem+json',
        'X-Request-ID': appErr.requestId,
      });

      // 生产环境额外剥离 detail（避免泄露内部信息给非 status >= 500）
      if (isProd && appErr.status >= 500) {
        body.detail = 'Internal server error';
      }

      res.end(JSON.stringify(body));
    }
  };
}

export {
  AppError,
  ValidationError,
  AuthError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
  errorHandler,
};
