# scripts/oneoff —— 一次性排查脚本归档

这里放**不是产品代码**的一次性排查脚本，只为追溯保留，**不参与运行、不被任何源码引用**。

| 文件 | 当初用来干什么 |
|---|---|
| `tmp_bfs.py` `tmp_check.py` `tmp_ctx.py` `tmp_depth.py` `tmp_extract.py` `tmp_hunt.py` `tmp_own.py` `tmp_range.py` `tmp_rank.py` `tmp_rate.py` `tmp_scan.py` `tmp_sm.py` `tmp_snow.py` `tmp_verify.py` | 2026-10 定位《蒙冤二十五年》`series_id` 时，用 `urllib` 抓红果页面、试 gzip/zlib 解压、扫 ID 区间的一批试验脚本 |
| `cand.json` | 上面那批脚本产出的候选 `series_id` 裸数组（无结构、无说明） |

**为什么单独归到这里**：这些文件原先散在工程根目录，共约 490 行，`grep -rn "tmp_\|cand\.json" src/ public/ scripts/ package.json` 零引用。留在根目录会让人误以为是工程的一部分。

**注意**：这些脚本依赖当时的网络环境和红果页面结构，**现在大概率已经跑不通**，不要当作工具使用。

想彻底清掉可以直接删整个目录，不影响任何功能。
