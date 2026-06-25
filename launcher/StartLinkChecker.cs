using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Link Checker Portable Launcher")]
[assembly: AssemblyDescription("Starts the Link Checker local GUI server and opens the browser.")]
[assembly: AssemblyCompany("Link Checker")]
[assembly: AssemblyProduct("Link Checker")]
[assembly: AssemblyCopyright("Copyright (c) 2026")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]
[assembly: AssemblyInformationalVersion("1.0.0-portable")]

internal static class StartLinkChecker
{
    private const int DefaultPort = 8787;
    private const int PortProbeAttempts = 20;
    private const int StartupTimeoutMilliseconds = 8000;
    private const int DefaultIdleShutdownMilliseconds = 300000;
    private static readonly Regex GuiUrlPattern = new Regex(
        @"Link Checker GUI is running at (?<url>http://127\.0\.0\.1:\d+)",
        RegexOptions.Compiled);

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();

        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        string nodeExe = Path.Combine(appDir, "runtime", "node.exe");
        string serverScript = Path.Combine(appDir, "gui-server.mjs");
        string checkerScript = Path.Combine(appDir, "link-checker.mjs");
        string publicDir = Path.Combine(appDir, "public");

        string missing = FindMissingRequirement(nodeExe, serverScript, checkerScript, publicDir);
        if (missing != null)
        {
            ShowError(
                "Link Checker cannot start because a required file is missing.",
                missing + Environment.NewLine + Environment.NewLine +
                "Please extract the complete portable folder again, then run Start Link Checker.exe from that folder.");
            return 1;
        }

        Process serverProcess = null;
        try
        {
            string existingUrl = FindExistingGuiUrl(args);
            if (existingUrl != null)
            {
                OpenBrowser(existingUrl);
                return 0;
            }

            var startup = StartServer(appDir, nodeExe, serverScript, args);
            serverProcess = startup.Process;

            string url = WaitForGuiUrl(serverProcess, startup.Output, startup.Error, startup.UrlReady);
            OpenBrowser(url);
            return 0;
        }
        catch (Exception error)
        {
            if (serverProcess != null && !serverProcess.HasExited)
            {
                TryKill(serverProcess);
            }

            ShowError("Link Checker GUI failed to start.", error.Message);
            return 1;
        }
    }

    private static string FindMissingRequirement(string nodeExe, string serverScript, string checkerScript, string publicDir)
    {
        if (!File.Exists(nodeExe))
        {
            return "Missing: runtime\\node.exe";
        }

        if (!File.Exists(serverScript))
        {
            return "Missing: gui-server.mjs";
        }

        if (!File.Exists(checkerScript))
        {
            return "Missing: link-checker.mjs";
        }

        if (!Directory.Exists(publicDir))
        {
            return "Missing: public\\";
        }

        return null;
    }

    private static ServerStartup StartServer(string appDir, string nodeExe, string serverScript, string[] args)
    {
        var output = new StringBuilder();
        var error = new StringBuilder();
        var urlReady = new ManualResetEventSlim(false);

        var process = new Process();
        process.StartInfo = new ProcessStartInfo
        {
            FileName = nodeExe,
            Arguments = Quote(serverScript) + BuildServerArguments(args),
            WorkingDirectory = appDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        ApplyEnvironmentOptions(process.StartInfo, args);

        process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
        {
            if (eventArgs.Data == null)
            {
                return;
            }

            lock (output)
            {
                output.AppendLine(eventArgs.Data);
            }

            if (GuiUrlPattern.IsMatch(eventArgs.Data))
            {
                urlReady.Set();
            }
        };

        process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
        {
            if (eventArgs.Data == null)
            {
                return;
            }

            lock (error)
            {
                error.AppendLine(eventArgs.Data);
            }
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("Node process did not start.");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        return new ServerStartup(process, output, error, urlReady);
    }

    private static string FindExistingGuiUrl(string[] args)
    {
        int requestedPort;
        if (TryGetRequestedPort(args, out requestedPort))
        {
            string requestedUrl = "http://127.0.0.1:" + requestedPort;
            return IsLinkCheckerGui(requestedUrl) ? requestedUrl : null;
        }

        for (int offset = 0; offset < PortProbeAttempts; offset++)
        {
            string url = "http://127.0.0.1:" + (DefaultPort + offset);
            if (IsLinkCheckerGui(url))
            {
                return url;
            }
        }

        return null;
    }

    private static bool TryGetRequestedPort(string[] args, out int port)
    {
        port = 0;
        for (int index = 0; index < args.Length - 1; index++)
        {
            if (!String.Equals(args[index], "--port", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return Int32.TryParse(args[index + 1], out port) && port >= 1024 && port <= 65535;
        }

        return false;
    }

    private static bool IsLinkCheckerGui(string url)
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(url + "/");
            request.Method = "GET";
            request.Timeout = 400;
            request.ReadWriteTimeout = 400;

            using (var response = (HttpWebResponse)request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                string body = reader.ReadToEnd();
                return response.StatusCode == HttpStatusCode.OK &&
                    body.IndexOf("<title>Link Checker</title>", StringComparison.OrdinalIgnoreCase) >= 0 &&
                    body.IndexOf("/app.js", StringComparison.OrdinalIgnoreCase) >= 0;
            }
        }
        catch
        {
            return false;
        }
    }

    private static string BuildServerArguments(string[] args)
    {
        var serverArgs = new List<string>();
        foreach (string arg in args)
        {
            if (String.Equals(arg, "--system-ca", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            serverArgs.Add(Quote(arg));
        }

        if (!HasIdleShutdownOption(args))
        {
            serverArgs.Add("--idle-shutdown-ms");
            serverArgs.Add(DefaultIdleShutdownMilliseconds.ToString());
        }

        return serverArgs.Count == 0 ? "" : " " + String.Join(" ", serverArgs.ToArray());
    }

    private static bool HasIdleShutdownOption(string[] args)
    {
        foreach (string arg in args)
        {
            if (String.Equals(arg, "--idle-shutdown-ms", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(arg, "--no-idle-shutdown", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static void ApplyEnvironmentOptions(ProcessStartInfo startInfo, string[] args)
    {
        bool systemCa = false;
        foreach (string arg in args)
        {
            if (String.Equals(arg, "--system-ca", StringComparison.OrdinalIgnoreCase))
            {
                systemCa = true;
                break;
            }
        }

        if (!systemCa)
        {
            return;
        }

        string current = startInfo.EnvironmentVariables["NODE_OPTIONS"] ?? "";
        if (current.IndexOf("--use-system-ca", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            return;
        }

        startInfo.EnvironmentVariables["NODE_OPTIONS"] = String.IsNullOrWhiteSpace(current)
            ? "--use-system-ca"
            : current + " --use-system-ca";
    }

    private static string WaitForGuiUrl(
        Process process,
        StringBuilder output,
        StringBuilder error,
        ManualResetEventSlim urlReady)
    {
        if (!urlReady.Wait(StartupTimeoutMilliseconds))
        {
            if (process.HasExited)
            {
                throw new InvalidOperationException(
                    "The server process exited before the GUI URL was available." +
                    Environment.NewLine + Environment.NewLine +
                    BuildDiagnostics(output, error));
            }

            throw new TimeoutException(
                "Timed out waiting for the GUI URL." +
                Environment.NewLine + Environment.NewLine +
                BuildDiagnostics(output, error));
        }

        string stdout;
        lock (output)
        {
            stdout = output.ToString();
        }

        Match match = GuiUrlPattern.Match(stdout);
        if (!match.Success)
        {
            throw new InvalidOperationException(
                "The server started, but the GUI URL could not be read." +
                Environment.NewLine + Environment.NewLine +
                BuildDiagnostics(output, error));
        }

        return match.Groups["url"].Value;
    }

    private static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true
        });
    }

    private static string BuildDiagnostics(StringBuilder output, StringBuilder error)
    {
        string stdout;
        string stderr;
        lock (output)
        {
            stdout = output.ToString().Trim();
        }
        lock (error)
        {
            stderr = error.ToString().Trim();
        }

        if (String.IsNullOrWhiteSpace(stdout) && String.IsNullOrWhiteSpace(stderr))
        {
            return "No diagnostic output was captured.";
        }

        return "Output:" + Environment.NewLine +
            (String.IsNullOrWhiteSpace(stdout) ? "(none)" : stdout) +
            Environment.NewLine + Environment.NewLine +
            "Errors:" + Environment.NewLine +
            (String.IsNullOrWhiteSpace(stderr) ? "(none)" : stderr);
    }

    private static string Quote(string value)
    {
        if (String.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void TryKill(Process process)
    {
        try
        {
            process.Kill();
        }
        catch
        {
            // Best effort only; the error dialog already explains the startup failure.
        }
    }

    private static void ShowError(string title, string message)
    {
        MessageBox.Show(message, title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private sealed class ServerStartup
    {
        public ServerStartup(Process process, StringBuilder output, StringBuilder error, ManualResetEventSlim urlReady)
        {
            Process = process;
            Output = output;
            Error = error;
            UrlReady = urlReady;
        }

        public Process Process { get; private set; }
        public StringBuilder Output { get; private set; }
        public StringBuilder Error { get; private set; }
        public ManualResetEventSlim UrlReady { get; private set; }
    }
}
