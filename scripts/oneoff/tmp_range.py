import urllib.request, gzip, re, time

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
sid = "7686812666374933566"  # 绿意萌熹
for rng in ["bytes=0-16383", "bytes=0-32767"]:
    req = urllib.request.Request(
        f"https://hongguoduanju.com/detail?series_id={sid}",
        headers={"User-Agent": UA, "Accept-Encoding": "gzip", "Range": rng},
    )
    t = time.time()
    r = urllib.request.urlopen(req, timeout=30)
    data = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        try:
            data = gzip.decompress(data)
        except Exception:
            pass
    print(rng, r.status, len(data), f"{time.time()-t:.2f}s")
    s = data.decode("utf-8", "replace")
    m = re.search(r'<title>([^<]{0,80})</title>', s)
    print("   title:", m.group(1) if m else None)
    print("   含剧名:", "绿意萌熹" in s)
