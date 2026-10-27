import urllib.request, zlib, re

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
sid = "7686812666374933566"
name = "绿意萌熹"
req = urllib.request.Request(f"https://hongguoduanju.com/detail?series_id={sid}",
                             headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
r = urllib.request.urlopen(req, timeout=30)
d = zlib.decompressobj(16 + zlib.MAX_WBITS)
buf = b""
pos = None
while True:
    c = r.read(16384)
    if not c:
        break
    buf += d.decompress(c)
    if name.encode() in buf and pos is None:
        pos = buf.find(name.encode())
print("总长度:", len(buf))
print("剧名首次出现位置(解压后字节):", pos)
print("og:title:", re.search(r'og:title"\s+content="([^"]{0,80})', buf.decode("utf-8", "replace")) is not None)
s = buf.decode("utf-8", "replace")
i = s.find(name)
print("上下文:", repr(s[max(0,i-160):i+60]) if i >= 0 else "none")
