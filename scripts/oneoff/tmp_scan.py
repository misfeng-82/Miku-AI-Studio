import re, urllib.request, gzip, datetime, json
from concurrent.futures import ThreadPoolExecutor

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
LOC = re.compile(r"<loc>\s*https://hongguoduanju\.com/player/(\d+)\s*</loc>")

def get(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    r = urllib.request.urlopen(req, timeout=timeout)
    data = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        data = gzip.decompress(data)
    return data.decode("utf-8", "replace")

def one(i):
    try:
        x = get(f"https://hongguoduanju.com/sitemap/hongguoduanju/index{i}.xml")
        return LOC.findall(x)
    except Exception as e:
        print("err", i, e, flush=True)
        return []

with ThreadPoolExecutor(max_workers=8) as ex:
    parts = list(ex.map(one, range(1, 29)))

ids = [int(s) for p in parts for s in p]
print("total player ids:", len(ids), flush=True)

def day(i):
    return datetime.datetime.fromtimestamp(i >> 32, datetime.UTC).strftime("%Y-%m-%d")

buckets = {}
for i in ids:
    buckets[day(i)] = buckets.get(day(i), 0) + 1
for k in sorted(buckets):
    if k >= "2026-08-01":
        print(k, buckets[k])

lo = int(datetime.datetime(2026, 9, 8, tzinfo=datetime.UTC).timestamp()) << 32
hi = int(datetime.datetime(2026, 9, 24, tzinfo=datetime.UTC).timestamp()) << 32
cand = [i for i in ids if lo <= i <= hi]
print("candidates 09-08..09-24:", len(cand), flush=True)
with open("cand.json", "w") as f:
    json.dump(cand, f)
