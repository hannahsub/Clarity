import csv, json, os, sys
BASE = os.path.dirname(os.path.dirname(__file__))
DATA = os.path.join(BASE, 'data')
OUT = os.path.join(BASE, 'rules_static.json')

def map_types(*sh):
    mapping = {'main':'main_frame','sub':'sub_frame','xhr':'xmlhttprequest','script':'script','other':'other'}
    out = []
    for s in sh:
        for t in [x.strip().lower() for x in s.split(',') if x.strip()]:
            if t in mapping: out.append(mapping[t])
    return out or ['main_frame','sub_frame']

rows=[]
for fname in ['blocklist.csv','strict_mirrors.csv']:
    with open(os.path.join(DATA,fname), newline='') as f:
        r=csv.DictReader(f)
        for row in r:
            rows.append(row)

rules=[]; rid=1
for row in rows:
    pat = row['pattern'].strip()
    tvals = [row.get('types','')]
    types = map_types(*tvals)
    rules.append({"id": rid, "priority": 1, "action": {"type":"block"},
                  "condition": {"urlFilter": f"||{pat}", "resourceTypes": types}})
    rid += 1
rules.append({
  "id": rid, "priority": 1, "action": {"type":"redirect","redirect":{"extensionPath":"/content/blocked.html"}},
  "condition": {"urlFilter":"||*/v1/chat/completions","resourceTypes":["xmlhttprequest","main_frame","sub_frame","other"]}
})

with open(OUT,"w") as f: json.dump(rules, f, indent=2)
print(f"Wrote {len(rules)} rules to {OUT}")
