# Ordklar

En Chrome-extension til dansk og engelsk korrektur i almindelige tekstfelter
og `contenteditable`-editorer, herunder den type editor X bruger.

Røde prikker viser mulige stavefejl. Lilla prikker viser forslag fra
grammatikreglerne. Hold musen over det markerede ord, og klik på en rettelse.
Du kan også bruge **Alt + Shift + O** til det første synlige forslag.

## Installer i Chrome

1. Hent [ordklar-chrome.zip](https://github.com/Singo001/x/raw/refs/heads/main/artifacts/ordklar-chrome.zip), og pak filen ud i en mappe. Hvis du bygger selv, brug `dist/`.
2. Åbn `chrome://extensions`, og slå **Udviklertilstand** til.
3. Vælg **Indlæs upakket**, og vælg mappen med `manifest.json`.
4. Fastgør Ordklar fra Chromes puslespilsikon. Vælg **Dansk** eller **English**.
5. Genindlæs faner, der var åbne før installationen, og skriv i et tekstfelt.

Efter ca. et halvt sekund vises markeringerne. Ordbogen indlæses ved første
kontrol, så den første kontrol kan tage lidt længere tid. Kontrollen arbejder
i det senest fokuserede tekstfelt. En lille status viser antallet af forslag.

## Din ordliste

Åbn **Din ordliste** fra extensionen. Du kan tilføje og fjerne termer,
importere TXT, CSV eller JSON og eksportere listen til JSON. Termer gælder
på begge sprog, og store/små bogstaver ignoreres. Importer flettes med den
eksisterende liste; dubletter fjernes. Maksimum: 10.000 termer, 100 tegn per
term og filer på 2 MB.

- TXT: én term per linje.
- CSV: termer adskilt af komma, semikolon eller linjeskift. Ingen overskriftsrække.
- JSON: en liste med strenge, fx `["DeFi", "HODL", "smart contract"]`.
- **Tilføj kryptotermer** tilføjer en redigerbar startliste.
- **Gem i ordliste** i et rettelsesforslag accepterer ordet fremover.
- **Ignorer her** skjuler det samme forslag, mens du arbejder i feltet.

## Privatliv og begrænsninger

Ingen tekst sendes over nettet. Ordbøger, kontrol og rettelsesforslag kører
lokalt i extensionen. Teksten er ikke gemt; kun indstillinger og din ordliste
ligger i `chrome.storage.local`. Ingen analyse, konto eller API-nøgle.
Extensionen har adgang til HTTP/HTTPS-sider for at kunne markere deres felter.
Du kan begrænse sideadgangen i Chromes extensionindstillinger.

Stavekontrollen bruger danske og amerikansk-engelske Hunspell-ordbøger.
Grammatikdelen er regelbaseret og finder bl.a. gentagne ord, overflødige
mellemrum, nogle danske kønsfejl (`mit grammatik` → `min grammatik`),
`for og skrive` → `for at skrive` og enkelte engelske kongruensfejl.
Den er ikke en fuldstændig grammatikanalyse og kan give fejlagtige forslag.
Ordbøger kan mangle nye ord og sammensætninger; gem dem i din ordliste.

Der kontrolleres højst de første 12.000 tegn og vises højst 100 forslag.
Links, e-mails, @handles, #hashtags og korte tickers med store bogstaver
springes over. Passwordfelter og felter, der ikke kan redigeres, kontrolleres
ikke. Chrome-sider, Chrome Web Store og specialeditorer som canvas-baserede
Google Docs understøttes ikke. Lukket Shadow DOM kan være begrænset.
Testen bruger en lokal editor med samme DOM-mønster som X; der er ikke
logget ind på eller testet direkte på X.

## Udvikling

Node.js 24 og npm. Ingen server eller eksterne nøgler er nødvendige.

```sh
npm ci
npm run build
npm test
npm run test:browser
npm run package
```

Browsertesten bruger lokalt Chromium fra `CHROMIUM_PATH` eller
`/usr/lib/chromium/chromium`. Den kører extensionen med en lokal testside og gemmer
screenshots i `test-results/`. Hvis Chromium ikke er installeret, installer
det via dit systems pakkestyring og angiv `CHROMIUM_PATH`.

Hvis miljøets Chromium blokerer extensioninstallation via administrationspolitik,
vælger browsertesten automatisk en lokal testadapter til `chrome.runtime` og
`chrome.storage`. Den afvikler de byggede scripts og tester DOM, React-felter,
hover, rettelser og indstillinger i Chromium uden at ændre browserpolitikken.
Den verificerer ikke Chromes extensioninstallation, isolerede scriptmiljøer,
permission-dialog eller service worker-livscyklus. På en almindelig installation
kører testen med den rigtige extension. Installation og brug direkte på X
skal afprøves i brugerens Chrome.

Koden er opdelt i en lokal korrekturmotor, en Manifest V3-service worker,
en indholdsmarkering og sider til indstillinger. `src/editor.js` oversætter
tekstoffsets til DOM-ranges uden at erstatte editorens HTML. Rettelser i
contenteditable bruger Chromiums redigeringskommando for at bevare undo.
Rettelser i input/textarea bruger den native værdisætter og en input-event,
så frameworks kan opdatere deres tilstand.

Se [THIRD_PARTY.md](THIRD_PARTY.md) for ordbogs- og biblioteklicenser.
