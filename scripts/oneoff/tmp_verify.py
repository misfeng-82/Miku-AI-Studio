import urllib.request, gzip, re, json, datetime

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
SID = "7684559889913351193"

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

html = unesc(get(f"https://hongguoduanju.com/detail?series_id={SID}"))
m = re.search(r'"series_id":"' + SID + r'","series_name":"([^"]{2,60})"', html)
print("series_name:", m.group(1) if m else "??")
i = html.find('"series_id":"' + SID + '"')
seg = html[i-200:i+1400]
for key in ["episode_cnt", "series_cover", "series_intro", "tags", "episode_right_text"]:
    mm = re.search(r'"' + key + r'":\s*("([^"]{0,300})"|\[[^\]]{0,120}\]|\d+)', seg)
    print(key, "=>", mm.group(1) if mm else None)
print()
print("ID 时间(UTC):", datetime.datetime.fromtimestamp(int(SID) >> 32, datetime.UTC).strftime("%Y-%m-%d %H:%M"))
