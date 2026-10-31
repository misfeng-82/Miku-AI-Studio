/**
 * 云服务客户端（服务端）
 *
 * 配置来源优先级：
 *   1) data/cloud.json（本机覆盖，gitignore 里，不随代码上传）
 *   2) src/cloud/defaultConfig.json（随代码走，云端沙箱靠它连上）
 *
 * publishableKey 只是「哪个应用」的标识、本身不带任何权限（服务端还会校验 Origin），
 * 按云服务文档它可以出现在代码里；真正的环境 id 与厂商密钥都在服务端，不下发。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';

let cached = null;

/** 读云服务配置；没配就返回 null（此时走原来的 Key/mock 链路） */
export function publicConfig() {
  if (cached !== null) return cached;
  const paths = [
    join(config.dataDir, 'cloud.json'),
    fileURLToPath(new URL('./defaultConfig.json', import.meta.url)),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const json = JSON.parse(readFileSync(p, 'utf8'));
      if (json?.endpoint && json?.publishableKey) {
        cached = json;
        return cached;
      }
    } catch { /* 配置坏了就当没配，不影响本地链路 */ }
  }
  cached = null;
  return null;
}

/** 是否已接入云服务 */
export function cloudEnabled() {
  return publicConfig() !== null;
}

/** 拿一个客户端实例；没配返回 null */
export function cloudClient() {
  const cfg = publicConfig();
  if (!cfg) return null;
  return createWorkBuddyCloud({
    endpoint: cfg.endpoint,
    publishableKey: cfg.publishableKey,
  });
}
