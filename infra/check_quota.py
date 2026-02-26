import json, subprocess
r = subprocess.run(['az','vm','list-usage','--location','eastus2','-o','json'], capture_output=True, text=True)
data = json.loads(r.stdout)
for d in data:
    name = d.get('localName','')
    if 'DSv3' in name or 'Total Regional' in name or 'DSv2' in name:
        print(f"{name}: {d['currentValue']}/{d['limit']}")
