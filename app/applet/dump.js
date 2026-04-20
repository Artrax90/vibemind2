async function run() {
  for (const q of ['гратен', 'еду', 'шашлык']) {
    try {
      const resp = await fetch(`http://127.0.0.1:3344/api/distances?query=${encodeURIComponent(q)}`);
      const data = await resp.json();
      console.log(`\n--- ${q} ---`);
      for (const d of data) {
         console.log(`${d.distance.toFixed(3)} - ${d.title.substring(0, 30)}`);
      }
    } catch(e) {
      console.log(e);
    }
  }
}
run();
