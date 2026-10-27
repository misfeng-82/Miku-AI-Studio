import urllib.request, gzip, re

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    r = urllib.request.urlopen(req, timeout=30)
    d = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        d = gzip.decompress(d)
    return d.decode("utf-8", "replace")

def unesc(s):
    for a, b in [("\\u002F", "/"), ("\\&quot;", '"'), ("&quot;", '"'), ('\\"', '"')]:
        s = s.replace(a, b)
    return s

for sid in ["7687940093788572734", "7686120230292032537"]:
    html = unesc(get(f"https://hongguoduanju.com/detail?series_id={sid}"))
    print("==== page", sid, "len", len(html))
    for m in list(re.finditer("蒙冤", html))[:2]:
        print(repr(html[max(0, m.start()-500): m.start()+200]))
        print("---")
