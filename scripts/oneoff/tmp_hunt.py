import urllib.request, zlib, json, datetime, time, threading
from concurrent.futures import ThreadPoolExecutor

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
TARGET = "蒙冤"
MAXB = 200_000  # 剧名通常在头部，读够就断

lock = threading.Lock()
done = [0]
hits = []
start = time.time()


def probe(sid):
    try:
        req = urllib.request.Request(
            f"https://hongguoduanju.com/detail?series_id={sid}",
            headers={"User-Agent": UA, "Accept-Encoding": "gzip"},
        )
        r = urllib.request.urlopen(req, timeout=25)
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        buf = b""
        while len(buf) < MAXB:
            chunk = r.read(16384)
            if not chunk:
                break
            buf += d.decompress(chunk)
            if TARGET.encode() in buf:
                txt = buf.decode("utf-8", "replace")
                with lock:
                    hits.append((sid, txt))
                r.close()
                return sid
        r.close()
    except Exception:
        pass
    finally:
        with lock:
            done[0] += 1
            if done[0] % 500 == 0:
                print(f"  {done[0]} done, {time.time()-start:.0f}s", flush=True)
    return None


lo = int(datetime.datetime(2026, 9, 8, tzinfo=datetime.UTC).timestamp()) << 32
hi = int(datetime.datetime(2026, 9, 26, tzinfo=datetime.UTC).timestamp()) << 32
cand = [i for i in json.load(open("cand.json")) if lo <= i <= hi]
print("candidates:", len(cand), flush=True)

with ThreadPoolExecutor(max_workers=24) as ex:
    for _ in ex.map(probe, cand):
        pass

print("elapsed", f"{time.time()-start:.0f}s", "hits:", len(hits))
for sid, txt in hits:
    import re
    m = re.search(r'"series_name[^:]{0,4}:\s*"([^"]{2,60})"', txt.replace("\\u002F", "/"))
    print("HIT", sid, m.group(1) if m else "?")
