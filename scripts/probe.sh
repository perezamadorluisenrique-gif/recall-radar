set +e
O="Origin: https://perezamadorluisenrique-gif.github.io"
probe() { echo "=== $1"; curl -s -m 25 -D - -o /tmp/body -H "$O" "$1" | grep -iE "^(HTTP|access-control-allow-origin|content-type)"; head -c ${2:-600} /tmp/body; echo; }
probe "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber=25338" 300
probe "https://api.nhtsa.gov/recalls/recallsByVehicle?make=honda&model=accord&modelYear=2012" 1500
probe "https://api.nhtsa.gov/products/vehicle/models?modelYear=2012&make=honda&issueType=r" 400
probe "https://api.nhtsa.gov/products/vehicle/makes?modelYear=2012&issueType=r" 300
probe "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/1HGCM82633A004352?format=json" 300
probe "https://api.nhtsa.gov/recalls/recallsByVehicle?make=graco&model=snugride&modelYear=2015" 400
probe "https://api.fda.gov/food/enforcement.json?search=report_date:[20250901+TO+20251231]&limit=2" 3000
probe "https://api.fda.gov/food/enforcement.json?search=report_date:[20230101+TO+20261231]&limit=1" 400
probe "https://world.openfoodfacts.org/api/v2/product/737628064502.json?fields=product_name,brands" 300
probe "https://api.upcitemdb.com/prod/trial/lookup?upc=885909950805" 300
probe "https://www.fsis.usda.gov/fsis/api/recall/v/1" 600
