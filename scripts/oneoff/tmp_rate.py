import urllib.request, zlib, json, random, datetime, time, threading
from concurrent.futures import ThreadPoolExecutor

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
lock = threading.Lock()
stat = {"ok": 0, "err": 0, "named": 0}
errs = {}

cand = json.load(open("cand.json"))
lo = int(datetime.datetime(2026, 9, 12, tzinfo=datetime.UTC).timestamp()) << 32
hi = int(datetime.datetime(2026, 9, 13, tzinfo=datetime.UTC).timestamp()) << 32
day = [i for i in cand if lo <= i <= hi]
random.seed(1)
sample = random.sample(day, min(300, len(day)))
print("sample", len(sample), flush=True)

def probe(sid):
    try:
        req = urllib.request.Request(
            f"https://hongguoduanju.com/detail?series_id={sid}",
            headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
        r = urllib.request.urlopen(req, timeout=20)
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        buf = b""
        while len(buf) < 60000:
            c = r.read(8192)
            if not c:
                break
            buf += d.decompress(c)
        r.close()
        s = buf.decode("utf-8", "replace")
        with lock:
            stat["ok"] += 1
            if "series_name" in s:
                stat["named"] += 1
    except Exception as e:
        with lock:
            stat["err"] += 1
            errs[type(e).__name__] = errs.get(type(e).__name__, 0) + 1

t = time.time()
with ThreadPoolExecutor(max_workers=24) as ex:
    list(ex.map(probe, sample))
print(stat, errs, f"{time.time()-t:.0f}s", f"{len(sample)/(time.time()-t):.1f} req/s")
