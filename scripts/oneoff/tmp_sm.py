import re, urllib.request, gzip

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    r = urllib.request.urlopen(req, timeout=timeout)
    data = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        data = gzip.decompress(data)
    return data.decode("utf-8", "replace")

idx = get("https://hongguoduanju.com/sitemap.xml")
child = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", idx)
print("children:", len(child))
print(child[:30])
c = child[0]
x = get(c)
print("first child len:", len(x))
locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", x)
last = re.findall(r"<lastmod>\s*([^<\s]+)\s*</lastmod>", x)
print("locs:", len(locs), "lastmod:", len(last))
print(locs[:3])
print(last[:3])
