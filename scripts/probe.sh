set +e
O="Origin: https://perezamadorluisenrique-gif.github.io"
probe() { echo "=== $1"; curl -g -s -m 25 -D - -o /tmp/body -H "$O" "$1" | grep -iE "^(HTTP|access-control-allow-origin|content-type)"; head -c ${2:-600} /tmp/body; echo; }
probe "https://api.fda.gov/food/enforcement.json?search=report_date:[20250901+TO+20251231]&limit=1" 4000
probe "https://api.fda.gov/food/enforcement.json?search=report_date:[20230101+TO+20261231]&limit=1" 300
probe "https://api.fda.gov/drug/enforcement.json?limit=1" 200
probe "https://api.nhtsa.gov/recalls/recallsByVehicle?make=graco&model=4ever&modelYear=2020" 300
probe "https://api.nhtsa.gov/products/vehicle/makes?modelYear=2020&issueType=r&type=equipment" 300
