import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config.js';
import { internalError, notFound } from '../errors.js';
import { logger } from '../logger.js';

// 极简 JSON 文档存储：零依赖、单文件一文档、写临时文件后原子重命名
// 说明：适合单机单人使用的规模；并发写以进程内串行队列保证不互相覆盖
export class JsonStore {
  constructor(dir = config.dataDir) {
    this.dir = resolve(dir);
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.queue = Promise.resolve();
  }

  pathOf(name) {
    // name 只允许简单标识符，杜绝路径穿越
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw internalError('非法的存储键名');
    }
    return join(this.dir, `${name}.json`);
  }

  read(name, fallbackValue) {
    const p = this.pathOf(name);
    if (!existsSync(p)) {
      if (fallbackValue === undefined) throw notFound(`数据 ${name} 不存在`);
      return fallbackValue;
    }
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (err) {
      throw internalError(`数据 ${name} 已损坏，无法解析`, { reason: err.message });
    }
  }

  write(name, value) {
    const p = this.pathOf(name);
    const tmp = `${p}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
      renameSync(tmp, p);
      return value;
    } catch (err) {
      throw internalError(`写入数据 ${name} 失败`, { reason: err.message });
    }
  }

  // 所有写操作串行化，避免同一 tick 内两个请求互相覆盖
  update(name, mutator, fallbackValue) {
    this.queue = this.queue.then(() => {
      let current;
      try {
        current = this.read(name, fallbackValue);
      } catch (err) {
        if (err.code === 'NOT_FOUND') throw err;
        throw err;
      }
      const next = mutator(current);
      this.write(name, next);
      return next;
    }).catch((err) => {
      logger.error('store.update.failed', { name, reason: err.message });
      throw err;
    });
    return this.queue;
  }

  list() {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map((f) => f.slice(0, -5));
  }

  remove(name) {
    const p = this.pathOf(name);
    if (!existsSync(p)) return false;
    unlinkSync(p);
    return true;
  }
}

export const store = new JsonStore();
