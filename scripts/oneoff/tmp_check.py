import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
urls = [
    "https://hongguoduanju.com/player/7684559889913351193",
    "https://p3-novel.byteimg.com/novel-pic/8c444fb5e6f34ea7c67354e3aa716364~tplv-shrink:640:0.image",
]
for u in urls:
    req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    r = urllib.request.urlopen(req, timeout=30)
    d = r.read()
    print(r.status, r.headers.get("Content-Type"), len(d), u)
    if "player" in u:
        s = d
        try:
            import gzip
            s = gzip.decompress(d)
        except Exception:
            pass
        s = s.decode("utf-8", "replace")
        print("   页面含剧名:", "蒙冤二十五年" in s)
