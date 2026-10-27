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

hits = """7686826588721138713 7688683557929094169 7685314418850139160 7688627897002642494
7684185710823230489 7683174503744015385 7685428834681752601 7683882658639662104
7684315615003167768 7685988557843876926 7686800302283967550 7685615941123591193
7686398317374229528 7684870674384440344 7686019481990089790 7687090988958878744
7688017403116014616 7687940093788572734 7687913808643230745 7687558186554903577
7687515410245110846 7687505360382348312 7686120230292032537 7688692318190177304
7684285679303412798""".split()

found = {}
for sid in hits:
    try:
        html = unesc(get(f"https://hongguoduanju.com/detail?series_id={sid}"))
    except Exception as e:
        print(sid, "ERR", e)
        continue
    for m in re.finditer("蒙冤", html):
        ctx = html[max(0, m.start() - 400): m.start() + 400]
        ids = re.findall(r'\d{15,22}', ctx)
        if ids:
            found.setdefault(sid, set()).update(ids)
    print(sid, "->", sorted(found.get(sid, []))[:6], flush=True)

print("\n候选（出现蒙冤上下文里的 ID，按出现次数排）:")
from collections import Counter
c = Counter(i for s in found.values() for i in s)
for i, n in c.most_common(15):
    print(i, n)
