import urllib.request
import json
import urllib.parse

def check(query):
    q = urllib.parse.quote(query)
    req = urllib.request.Request(f"http://127.0.0.1:3000/api/distances?query={q}")
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            print(f"--- {query} ---")
            for d in data:
                print(f"{d['distance']:.3f} - {d['title']}")
    except Exception as e:
        print("Error:", e)

check("гратен")
check("еду")
check("шашлык")
