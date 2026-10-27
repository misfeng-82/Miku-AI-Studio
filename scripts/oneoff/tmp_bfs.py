import re, urllib.request, gzip, json, time, sys

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    r = urllib.request.urlopen(req, timeout=timeout)
    data = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        data = gzip.decompress(data)
    return data.decode("utf-8", "replace")

def unesc(s):
    return s.replace("\\u002F", "/").replace("&quot;", '"').replace('\\"', '"').replace("\\&quot;", '"')

NAME_ID = re.compile(r'\\?"series_name\\?":\s*\\?"([^"\\]{2,60})\\?",\s*\\?"series_id\\?":\s*\\?"?(\d{6,25})')
NAME_ID_R = re.compile(r'\\?"series_id\\?":\s*\\?"?(\d{6,25})\\?",\s*\\?"series_name\\?":\s*\\?"([^"\\]{2,60})')

seeds = [t for t in """
7694939439503510590 7692043430955863102 7694648775943392280 7695347627382017048 7696023326375808024
7690494161551625241 7692805707552279576 7694225107375377433 7691615145977449496 7688352674999176254
7694243659176217662 7688680481499384894 7693840102283299902 7695754334847388696 7695652257643121689
7695791392928304190 7690596204589091864 7688666572499471422 7693447411011701785
7696437705822981182 7696095984266251326 7695704804978330649 7693516944581872664 7692463987333532697
7694959546460015641 7696737673263713304 7691938290202577944 7688646466708966462 7696419143196609561
7696923205193174040 7696071263730551870 7685699444766952473 7695700156041137214 7687961499481934910
7688651092246154264 7675288927619533886 7694291604915358744 7696705177721523225 7672595482966772760
""".split() if t.isdigit()]

known = {}
queue = list(seeds)
seen = set()
TARGET = "蒙冤"
hit = None
round_no = 0

while queue and round_no < 3 and not hit:
    round_no += 1
    nxt = []
    print(f"--- round {round_no}: {len(queue)} ids ---", flush=True)
    for sid in queue:
        if sid in seen:
            continue
        seen.add(sid)
        try:
            html = unesc(get(f"https://hongguoduanju.com/detail?series_id={sid}"))
        except Exception as e:
            continue
        for m in NAME_ID.finditer(html):
            known[m.group(1)] = m.group(2)
        for m in NAME_ID_R.finditer(html):
            known[m.group(2)] = m.group(1)
        for name, i in list(known.items()):
            if TARGET in name:
                hit = (name, i)
    if hit:
        break
    for i in list(known.values()):
        if i not in seen:
            nxt.append(i)
    print(f"    known={len(known)} seen={len(seen)}", flush=True)
    # BFS 会爆炸，只取新发现里的一批做下一轮
    queue = nxt[:120]

print("TOTAL known:", len(known))
for name, i in known.items():
    if TARGET in name:
        print("HIT:", name, i)
if not hit:
    print("NOT FOUND; 相关候选:")
    for name, i in known.items():
        if any(k in name for k in ("归来", "举世", "二十五年", "冤")):
            print("  ?", name, i)
