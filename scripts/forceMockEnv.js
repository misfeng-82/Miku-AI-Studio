/* 自测专用：把数据目录指到临时目录，让「运行时 LLM 设置」必然为空。
 *
 * 为什么需要这个文件：config.js 在**被导入时**就读 DATA_DIR，而 llm.js 的
 * effectiveConfig() 是「运行时设置 > .env > mock」——用户在本机 settings.json 里
 * 存过真 Key 时，自测里任何一次 complete() 都会打到真 API 上花钱。
 * 自测必须离线、可重复、不花钱，所以第一个 import 它就对了：
 * ESM 按 import 声明顺序求值，这个模块排在 config 之前，环境变量才来得及生效。
 *
 * 已经在环境里显式给了 DATA_DIR 的（比如探针脚本），以环境变量为准，不覆盖。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 自测必须离线：USE_MOCK 的默认值已改为 0（产品默认真实模式），这里显式兜住
process.env.USE_MOCK ??= '1';

if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'comic-drama-selftest-'));
}
