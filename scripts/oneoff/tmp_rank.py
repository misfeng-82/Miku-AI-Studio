import re, urllib.request, gzip, io, json, sys

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    r = urllib.request.urlopen(req, timeout=30)
    data = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        data = gzip.decompress(data)
    return data.decode("utf-8", "replace")

for path in ["/rank/hot-ai-drama", "/rank/hot-comic-drama"]:
    try:
        html = get("https://hongguoduanju.com" + path)
    except Exception as e:
        print(path, "ERR", e)
        continue
    pairs = re.findall(r'aria-label="查看([^"]{2,40})"[^>]*?href="/detail\?series_id=(\d+)"', html)
    if not pairs:
        pairs = re.findall(r'href="/detail\?series_id=(\d+)"[^>]*?aria-label="查看([^"]{2,40})"', html)
        pairs = [(b, a) for a, b in pairs]
    print("===", path, len(pairs))
    for i, (name, sid) in enumerate(pairs[:40], 1):
        mark = "  <<<< HIT" if "蒙冤" in name else ""
        print(f"{i:2d} {sid} {name}{mark}")
