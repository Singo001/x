import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';

execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
await mkdir('artifacts', { recursive: true });
await writeFile('dist/INSTALLATION.txt', `Ordklar — installation i Chrome\n\n1. Pak hele ZIP-filen ud i en mappe.\n2. Åbn chrome://extensions i Chrome.\n3. Slå Udviklertilstand til øverst til højre.\n4. Klik Indlæs upakket, og vælg mappen med manifest.json.\n5. Fastgør Ordklar via puslespilsikonet, og vælg Dansk eller English.\n6. Genindlæs faner, der var åbne før installationen.\n\nSkriv i et tekstfelt. Vent et øjeblik, hold musen over en rød eller lilla\nmarkering, og vælg en rettelse. Egne ord gemmes i Din ordliste.\n\nTekst behandles lokalt. Grammatikdelen dækker almindelige fejl, ikke\nalle sproglige nuancer. Chromes egne sider og visse specialeditorer\nunderstøttes ikke. Se README for detaljer.\n`);
await copyFile('README.md', 'dist/README.md');
execFileSync('python', ['-c', `from pathlib import Path\nfrom zipfile import ZipFile, ZIP_DEFLATED\nwith ZipFile('artifacts/ordklar-chrome.zip', 'w', ZIP_DEFLATED) as archive:\n    for path in sorted(Path('dist').rglob('*')):\n        if path.is_file():\n            archive.write(path, path.relative_to('dist'))\n`], { stdio: 'inherit' });
console.log('Installerbar ZIP: artifacts/ordklar-chrome.zip');
