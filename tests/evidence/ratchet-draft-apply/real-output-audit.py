import re, json, sys
s=open(sys.argv[1]).read()
out=[]
for date,body in re.findall(r'## (2026-\d\d-\d\d)\n(.*?)(?=\n## 2026-|\Z)',s,re.S):
    output,inp=body.split('### Input',1)
    planned=re.findall(r'^K\d+ (.*?) \(planned (.*?)\)',inp,re.M)
    selected=re.findall(r'← TODO (.*?)\n',output)
    selected={t.strip() for t in selected}
    missing=[(t.strip(),d) for t,d in planned if t.strip() not in selected]
    row={'day':date,'open':len(planned),'placed':len(selected),'missingPlannedToday':sum(d==date for t,d in missing),'unplacedOther':sum(d!=date for t,d in missing)}
    out.append(row)
assert len(out)==5
assert sum(x['missingPlannedToday'] for x in out)==1
assert sum(bool(x['missingPlannedToday'] or x['unplacedOther']) for x in out)==4
print(json.dumps(out,indent=2))
