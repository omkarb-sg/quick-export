<#
.SYNOPSIS
    quick-export host child: export one or more Aras items into an empty folder using the
    native SolutionUpgrade engine (Libs.dll), producing native-identical XML.

.DESCRIPTION
    This is the per-export child process the Node host service spawns (one per request, for
    instance isolation). It loads IOM.dll + Libs.dll and runs
    Aras.Tools.SolutionUpgrade.ImportExportManager.ExportSolutions over a "selected items"
    table grouped by package — exactly what the Package Import/Export utility does, so the
    output is byte-identical to a native export.

    AUTH — two modes, chosen by which secret is present in the environment:
      * Token forwarding (production): $env:ARAS_TOKEN holds the browser's OAuth bearer
        token. We wrap it in an ITokenProvider and connect with it. No password is ever seen
        by this process or the service. This is the quick-export design.
      * Password grant (tests / fallback): $env:ARAS_PKG_PASSWORD holds the password and
        -ArasUser is given. We use Aras's PasswordTokenProvider (same path as aras-harness).
    Secrets come from the environment, never argv, so they don't land in the process table.

    WHY C# — calling ExportSolutions straight from PowerShell throws
    "cannot cast PSObject to Hashtable" (PS ETS wraps the table); building the table and
    running the engine entirely in a compiled helper avoids it. Do NOT inline this back to PS.

    CONTRACT with the caller (src/service/runner.ts parses stdout):
      QE_ENGINE_ERRORS: <n>          engine-reported error count (0 == clean)
      QE_XML: <absolute path>        one line per exported .xml file
      QE_OK                          success sentinel (exit 0)
      QE_FAIL: <reason>              failure (exit 1)

    Windows PowerShell 5.1 / .NET Framework only (the DLLs are .NET Framework).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $ArasUrl,
    [Parameter(Mandatory)][string] $ArasDatabase,
    [Parameter(Mandatory)][string] $OutDir,
    [Parameter(Mandatory)][string] $LogFile,
    [Parameter(Mandatory)][string] $IomDll,
    [Parameter(Mandatory)][string] $LibsDll,
    # JSON object: { "<packageName>": [ { "itemType","itemId","keyedName" }, ... ], ... }
    [Parameter(Mandatory)][string] $GroupsJson,
    # Password mode only. Token mode reads $env:ARAS_TOKEN.
    [string] $ArasUser  = '',
    # String (not [bool]) so it binds cleanly from a spawned argv; converted below.
    [string] $ExportReferenced = 'true',
    [int]    $Timeout          = 1200000
)

$ErrorActionPreference = 'Stop'

function Fail([string]$msg) { Write-Output "QE_FAIL: $msg"; exit 1 }

try {
    $token = $env:ARAS_TOKEN
    $pw    = $env:ARAS_PKG_PASSWORD
    $useToken = -not [string]::IsNullOrEmpty($token)
    if (-not $useToken -and [string]::IsNullOrEmpty($pw)) {
        Fail "No credential: set ARAS_TOKEN (token mode) or ARAS_PKG_PASSWORD + -ArasUser (password mode)"
    }
    if (-not $useToken -and [string]::IsNullOrEmpty($ArasUser)) { Fail "Password mode requires -ArasUser" }
    if (-not (Test-Path $OutDir))  { Fail "Output directory does not exist: $OutDir" }
    if (-not (Test-Path $IomDll))  { Fail "IOM.dll not found: $IomDll" }
    if (-not (Test-Path $LibsDll)) { Fail "Libs.dll not found: $LibsDll" }

    $iom  = (Resolve-Path $IomDll).Path
    $libs = (Resolve-Path $LibsDll).Path
    Add-Type -Path $iom
    Add-Type -Path $libs

    # Flatten grouped JSON into parallel primitive arrays. Only strings cross into C#.
    $groups = $GroupsJson | ConvertFrom-Json
    if ($null -eq $groups) { Fail "GroupsJson did not parse" }
    $pkgArr  = New-Object System.Collections.Generic.List[string]
    $typeArr = New-Object System.Collections.Generic.List[string]
    $idArr   = New-Object System.Collections.Generic.List[string]
    $nameArr = New-Object System.Collections.Generic.List[string]
    foreach ($pkgName in @($groups.PSObject.Properties.Name)) {
        foreach ($it in @($groups.$pkgName)) {
            $pkgArr.Add([string]$pkgName)
            $typeArr.Add([string]$it.itemType)
            $idArr.Add([string]$it.itemId)
            $kn = [string]$it.keyedName
            if ([string]::IsNullOrWhiteSpace($kn)) { $kn = [string]$it.itemId }
            $nameArr.Add($kn)
        }
    }
    if ($idArr.Count -eq 0) { Fail "No items requested for export" }

    $code = @"
using System;
using System.Collections;
using System.Threading;
using System.Threading.Tasks;
using Aras.IOM;
using Aras.IOM.OAuth;
using Aras.Tools.SolutionUpgrade;

// Wraps a pre-obtained bearer token (the browser's session token, forwarded by the
// extension) as an ITokenProvider so IOM attaches it without any password grant.
public class RawTokenProvider : ITokenProvider {
    private readonly string _token;
    public RawTokenProvider(string token) {
        _token = (token != null && token.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            ? token.Substring(7) : token;
    }
    public Task<string> GetAccessTokenAsync(CancellationToken ct) { return Task.FromResult(_token); }
}

public class ExpResult { public int Errors = 0; }

public class QeMessage : Message {
    private readonly string _p; private readonly ExpResult _r;
    public QeMessage(string p, ExpResult r) { _p = p; _r = r; }
    public override bool? Execute() {
        if (!string.IsNullOrEmpty(Text)) {
            Console.WriteLine("  [{0}] {1}", _p, Text);
            // The engine sometimes routes failures through the warning channel with an
            // "****ErrorMessage****" banner — count both so the tally is reliable.
            if (_p == "ERROR" || _p == "ERROR?" || Text.IndexOf("ErrorMessage", StringComparison.OrdinalIgnoreCase) >= 0)
                _r.Errors++;
        }
        return true;
    }
}

public class QeMessagesFactory : IMessagesFactory {
    private readonly ExpResult _r;
    public QeMessagesFactory(ExpResult r) { _r = r; }
    public Message GetErrorMessage()          { return new QeMessage("ERROR",  _r); }
    public Message GetErrorMessageQuestion()  { return new QeMessage("ERROR?", _r); }
    public Message GetWarningMessage()        { return new QeMessage("WARN",   _r); }
    public Message GetStatusMessage()         { return new QeMessage("INFO",   _r); }
    public Message GetCurrentPackageMessage() { return new QeMessage("PKG",    _r); }
}

public static class QuickExportRunner {
    // Returns the engine error count (0 == clean). Writes files into outDir.
    public static int Run(
        string url, string db, bool useToken, string token, string user, string pw,
        string outDir, string logFile, int timeout, bool exportReferenced,
        string[] pkgNames, string[] itemTypes, string[] itemIds, string[] keyedNames) {

        IServerConnection sc;
        if (useToken) {
            // 3-arg overload (no db): db is carried by the token. The 4-arg-with-db overload
            // is obsolete and CodeDom treats the obsolete warning as an error.
            sc = IomFactory.CreateHttpServerConnection(url, new RawTokenProvider(token), ProtocolType.Standard);
        } else {
            var opts = new PasswordTokenProviderOptions {
                ClientId = "IOMApp", Scope = "Innovator", Database = db,
                UserName = user, Password = pw,
                TokenEndpoint = url.TrimEnd('/') + "/OAuthServer/connect/token"
            };
            sc = IomFactory.CreateHttpServerConnection(url, new PasswordTokenProvider(opts), ProtocolType.Standard);
        }
        var inn = new Innovator(sc);

        // Probe with a REAL get (empty <AML/> does not authenticate; getUserID would then
        // throw "Not logged in"). Use the first requested item so we fail fast on bad auth.
        string probeAml = "<AML><Item type='" + itemTypes[0] + "' action='get' select='id' id='" + itemIds[0] + "'/></AML>";
        var probe = inn.applyAML(probeAml);
        if (probe.isError()) throw new Exception("Aras connection/auth failed: " + probe.getErrorDetail());
        Console.WriteLine("INFO: connected to " + url + " (db=" + db + ", auth=" + (useToken ? "token" : "password") + ")");

        // table[packageName] = Hashtable( itemId -> ExportItem(keyedName, itemId, itemType) )
        var table = new Hashtable();
        for (int i = 0; i < itemIds.Length; i++) {
            var inner = (Hashtable)table[pkgNames[i]];
            if (inner == null) { inner = new Hashtable(); table[pkgNames[i]] = inner; }
            inner[itemIds[i]] = new ExportItem(keyedNames[i], itemIds[i], itemTypes[i]);
        }

        string serverPath = url;
        try { serverPath = InnovatorServer.GetInnovatorServerPath(url); }
        catch { serverPath = url.TrimEnd('/') + "/Server/InnovatorServer.aspx"; }

        var ctx = new SolutionUpgradeContext {
            Action = ImportExport.Export, WorkingDirectory = outDir, Url = serverPath,
            DataBase = db, LogFilePath = logFile, Timeout = timeout
        };
        // Native defaults (verified against native export): referenced items in, level 1,
        // keep references to unknown packages.
        var ec = new SUExportContext {
            sLevel = "1", bExportReferencedItems = exportReferenced,
            RefToUnknownPacks = ReferencesToUnknownPackages.DoNotRemove
        };

        var r = new ExpResult();
        var ci = new CItemHelper(sc);
        ci.Login();
        var mgr = new ImportExportManager(ctx, new QeMessagesFactory(r), ci);
        mgr.ExportSolutions(ec, table);
        return r.Errors;
    }
}
"@
    Add-Type -TypeDefinition $code -ReferencedAssemblies @($iom, $libs)

    $exportRef = @('true','1','$true','yes') -contains ($ExportReferenced.ToLowerInvariant())

    $errors = [QuickExportRunner]::Run(
        $ArasUrl, $ArasDatabase, $useToken, [string]$token, $ArasUser, [string]$pw,
        $OutDir, $LogFile, $Timeout, $exportRef,
        $pkgArr.ToArray(), $typeArr.ToArray(), $idArr.ToArray(), $nameArr.ToArray())

    $xml = Get-ChildItem -Path $OutDir -Recurse -Filter *.xml -File -ErrorAction SilentlyContinue
    $xmlCount = ($xml | Measure-Object).Count
    if ($xmlCount -eq 0) { Fail "Export produced no .xml files in $OutDir (see messages/log)" }

    Write-Output "QE_ENGINE_ERRORS: $errors"
    $xml | ForEach-Object { Write-Output ("QE_XML: " + $_.FullName) }
    Write-Output "INFO: exported $xmlCount xml file(s) from $($idArr.Count) requested item(s)"
    Write-Output "QE_OK"
    exit 0
}
catch { Fail "$($_.Exception.Message)" }
