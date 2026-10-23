# Minimale statische webserver voor deze PoC.
# Nodig omdat ES-modules en .wasm niet via file:// geladen mogen worden.
#
# Starten:  powershell -ExecutionPolicy Bypass -File serve.ps1
# Andere poort:  powershell -ExecutionPolicy Bypass -File serve.ps1 -port 8001
# Andere profielmap:  ... -profielen "D:\Catalogus\Profiles"
# Stoppen:  Ctrl+C
#
# De profielcatalogus staat BUITEN dit project, op een pad dat per PC anders kan
# zijn, en mag nooit gewijzigd worden. Een browserpagina kan zelf geen pad op de
# C-schijf openen - dat is een beveiligingsgrens, geen ontbrekende functie. Deze
# server deelt die map daarom uit onder /profielen/, en alleen om te lezen:
# GET en HEAD worden geantwoord, al het andere krijgt 405. Zo blijft de map
# alleen-lezen door de opzet, niet doordat de app zich netjes gedraagt.

param(
    [int]$port = 8000,
    [string]$profielen = 'C:\Configurator\Profiles'
)

$root = (Resolve-Path $PSScriptRoot).Path

$profielenRoot = $null
if ($profielen) {
    if (Test-Path $profielen -PathType Container) {
        $profielenRoot = (Resolve-Path $profielen).Path
    }
}

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.wasm' = 'application/wasm'
    '.css'  = 'text/css; charset=utf-8'
    '.stp'  = 'application/octet-stream'
    '.step' = 'application/octet-stream'
}

# Zet een pad uit een verzoek om naar een pad op schijf, en geeft $null terug als
# het buiten de toegestane map uitkomt. Zonder deze controle haalt
# /profielen/../../Windows/win.ini gewoon een bestand op. StartsWith op de map
# alleen is niet genoeg: "C:\Configurator\Profiles-oud" begint ook met
# "C:\Configurator\Profiles", dus de scheidingsstreep hoort erbij.
function VeiligPad($basis, $rel) {
    if (-not $basis) { return $null }
    try {
        $samen = [System.IO.Path]::GetFullPath((Join-Path $basis $rel))
    } catch {
        return $null
    }
    $grens = $basis.TrimEnd('\') + '\'
    if ($samen.StartsWith($grens, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $samen
    }
    return $null
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

# Zonder deze afvang meldt PowerShell de fout, gaat daarna gewoon door, en
# schrijft alsnog "Server draait op ..." - waardoor het lijkt alsof het werkt.
try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "Poort $port is al bezet." -ForegroundColor Red
    Write-Host "Er draait waarschijnlijk nog een serve.ps1 in een ander venster."
    Write-Host ""
    Write-Host "Stoppen kan zo:"
    Write-Host "  Get-CimInstance Win32_Process -Filter ""Name = 'powershell.exe'"" |"
    Write-Host "    Where-Object { `$_.CommandLine -like '*serve.ps1*' } |"
    Write-Host "    ForEach-Object { Stop-Process -Id `$_.ProcessId -Force }"
    Write-Host ""
    Write-Host "Of gebruik een andere poort:  .\serve.ps1 -port 8001"
    exit 1
}

Write-Host "Server draait op http://localhost:$port/  (Ctrl+C om te stoppen)"
if ($profielenRoot) {
    $aantal = (Get-ChildItem $profielenRoot -Directory).Count
    Write-Host "Profielen  /profielen/ -> $profielenRoot  ($aantal mappen, alleen-lezen)"
} else {
    Write-Host "Profielen  NIET beschikbaar: '$profielen' bestaat niet." -ForegroundColor Yellow
    Write-Host "           De app meldt dat zelf; starten met -profielen ""<pad>""."
}

# EEN mislukt verzoek mag de server niet omleggen.
#
# Hier stond geen afvang binnen de lus. Breekt een browser een verzoek af -
# en dat gebeurt: hij annuleert het ophalen van de 48 MB wasm zodra je de
# pagina ververst - dan gooit OutputStream.Write, vliegt de uitzondering de
# while-lus uit, stopt de `finally` de listener en is de server weg. Op één
# testdag is dat drie keer gebeurd, en elke keer leek het of de app stuk was
# terwijl alleen de server er niet meer was.
#
# Nu wordt elk verzoek apart afgevangen: gaat er één mis, dan gaat de volgende
# gewoon door.
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
        $methode = $context.Request.HttpMethod
        $rel = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
        if ($rel -eq '') { $rel = 'index.html' }

        # Waar de app het ingestelde pad kan opvragen. Nodig omdat de app in een
        # foutmelding moet kunnen laten zien WELKE map er niet gevonden is, en
        # dat pad kent hij zelf niet - het is een serverinstelling.
        if ($rel -eq 'profielen-info.json') {
            $pad = if ($profielenRoot) { $profielenRoot } else { $profielen }
            $info = [ordered]@{
                pad         = $pad
                beschikbaar = [bool]$profielenRoot
                manifest    = ($profielenRoot -and
                               (Test-Path (Join-Path $profielenRoot 'manifest.json') -PathType Leaf))
            }
            $json = [System.Text.Encoding]::UTF8.GetBytes(($info | ConvertTo-Json -Compress))
            $context.Response.ContentType = $mime['.json']
            $context.Response.ContentLength64 = $json.Length
            $context.Response.OutputStream.Write($json, 0, $json.Length)
            $context.Response.Close()
            continue
        }

        $uitCatalogus = $rel -eq 'profielen' -or $rel.StartsWith('profielen/')

        if ($uitCatalogus -and $methode -ne 'GET' -and $methode -ne 'HEAD') {
            # De catalogus is alleen-lezen. Niet "wij schrijven er niet in", maar
            # "er is geen manier om er iets in te schrijven".
            $context.Response.StatusCode = 405
            $context.Response.AddHeader('Allow', 'GET, HEAD')
            $context.Response.Close()
            continue
        }

        if ($uitCatalogus) {
            $full = VeiligPad $profielenRoot ($rel.Substring('profielen'.Length).TrimStart('/'))
        } else {
            $full = VeiligPad $root $rel
        }

        if ($full -and (Test-Path $full -PathType Leaf)) {
            $ext = [System.IO.Path]::GetExtension($full).ToLower()
            $type = $mime[$ext]
            if (-not $type) { $type = 'application/octet-stream' }
            $bestand = Get-Item -LiteralPath $full

            # Zonder een cache-aanwijzing mag een browser zelf gokken of hij een
            # bestand opnieuw ophaalt. Dan verander je iets in de app, ververs je
            # de pagina, en zie je het niet - en ga je in je eigen code zoeken
            # naar een fout die er niet is. Dat is hier een keer gebeurd.
            #
            # Voor de bestanden van de app: altijd navragen bij de server.
            # Voor de profielcatalogus niet: die bestanden veranderen alleen bij
            # een nieuwe levering, en de url draagt het exportmoment al
            # (?v=...), dus een nieuwe levering is vanzelf een ander adres. Die
            # mogen dus gerust een dag blijven staan - het zijn er 2337.
            if ($uitCatalogus) {
                $context.Response.AddHeader('Cache-Control', 'public, max-age=86400')
            } else {
                $context.Response.AddHeader('Cache-Control', 'no-cache')
            }

            # NAVRAGEN MOET WEL GRATIS ZIJN, en dat was het niet.
            #
            # 'no-cache' betekent "vraag het altijd na", niet "haal het altijd
            # opnieuw op". Maar navragen kan alleen als de server erbij zegt
            # WANNEER het bestand voor het laatst veranderd is: dan stuurt de
            # browser dat tijdstip de volgende keer mee en kan het antwoord
            # "niet veranderd" zijn. Die kop stond er niet, en dus was er niets
            # om na te vragen - elke paginalading haalde alles opnieuw op,
            # inclusief opencascade.full.wasm van 48 MB. Nagemeten: 41 seconden
            # voor dat ene bestand, van de schijf ernaast, bij ELKE verversing.
            #
            # Op de seconde afgerond, want zo staat een datum in een HTTP-kop.
            # Zonder dat afronden is het bestand altijd een fractie nieuwer dan
            # wat de browser terugstuurt en antwoordt de server nooit 304.
            $gewijzigd = $bestand.LastWriteTimeUtc
            $gewijzigd = [datetime]::new($gewijzigd.Year, $gewijzigd.Month,
                $gewijzigd.Day, $gewijzigd.Hour, $gewijzigd.Minute,
                $gewijzigd.Second, [System.DateTimeKind]::Utc)
            $context.Response.AddHeader('Last-Modified', $gewijzigd.ToString('R'))

            $sinds = $context.Request.Headers['If-Modified-Since']
            if ($sinds) {
                $toen = [datetime]::MinValue
                $stijl = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor `
                         [System.Globalization.DateTimeStyles]::AdjustToUniversal
                if ([datetime]::TryParse($sinds,
                        [System.Globalization.CultureInfo]::InvariantCulture,
                        $stijl, [ref]$toen) -and $gewijzigd -le $toen) {
                    # 304 heeft GEEN inhoud - ook geen Content-Type, want er
                    # wordt niets meegestuurd om een type aan te geven.
                    $context.Response.StatusCode = 304
                    $context.Response.ContentLength64 = 0
                    $context.Response.Close()
                    continue
                }
            }

            $context.Response.ContentType = $type
            $context.Response.ContentLength64 = $bestand.Length
            # STREAMEN en niet eerst helemaal inlezen.
            #
            # Hier stond ReadAllBytes. Dat zet het hele bestand in het
            # geheugen, en opencascade.full.wasm is 48 MB. Nagemeten met zes
            # keer achter elkaar ophalen: 84 -> 132 -> 180 -> 228 -> 276 ->
            # 324 MB, waarna de opruimer pas ingreep. Elke ophaling kostte dus
            # 48 MB op de grote-objectenhoop. Op een testdag waarop de zelftest
            # een paar keer draait is de server daardoor drie keer vanzelf
            # omgevallen - en elke keer leek het alsof de app stuk was terwijl
            # alleen de server er niet meer was.
            #
            # Met een FileStream gaat het in blokken door, en blijft het
            # geheugen vlak.
            if ($methode -ne 'HEAD') {
                $bron = [System.IO.File]::OpenRead($full)
                try { $bron.CopyTo($context.Response.OutputStream, 65536) }
                finally { $bron.Dispose() }
            }
        } else {
            $context.Response.StatusCode = 404
        }
        $context.Response.Close()
        } catch {
            # Vrijwel altijd een afgebroken verbinding. Melden en doorgaan;
            # het alternatief was dat de hele server ermee ophield.
            Write-Host "  verzoek mislukt: $($_.Exception.Message)" -ForegroundColor DarkYellow
            try { $context.Response.Close() } catch { }
        }
    }
} finally {
    $listener.Stop()
}
