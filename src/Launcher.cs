using System;
using System.IO;
using System.Diagnostics;
using System.Net;
using System.Windows.Forms;

namespace OptimusLauncher
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            try
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string installedExe = Path.Combine(localAppData, "optimus", "Optimus.exe");
                
                // 1. If already installed in AppData, launch directly
                if (File.Exists(installedExe))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = installedExe,
                        UseShellExecute = true
                    });
                    return;
                }

                // 2. Check if local packaged binary exists
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string localPackagedExe = Path.Combine(baseDir, "out", "Optimus-win32-x64", "Optimus.exe");
                if (File.Exists(localPackagedExe))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = localPackagedExe,
                        WorkingDirectory = Path.GetDirectoryName(localPackagedExe),
                        UseShellExecute = true
                    });
                    return;
                }

                // 3. Check for local installer
                string localSetup = Path.Combine(baseDir, "out", "make", "squirrel.windows", "x64", "Optimus-0.8.0 Setup.exe");
                if (!File.Exists(localSetup))
                {
                    localSetup = Path.Combine(baseDir, "Optimus-0.8.0 Setup.exe");
                }
                if (File.Exists(localSetup))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = localSetup,
                        UseShellExecute = true
                    });
                    return;
                }

                // 4. If Node.js is installed, run via npm
                if (File.Exists(Path.Combine(baseDir, "package.json")) && IsCommandAvailable("node"))
                {
                    if (!Directory.Exists(Path.Combine(baseDir, "node_modules")))
                    {
                        Process installProc = Process.Start(new ProcessStartInfo
                        {
                            FileName = "cmd.exe",
                            Arguments = "/c npm install",
                            WorkingDirectory = baseDir,
                            WindowStyle = ProcessWindowStyle.Hidden,
                            CreateNoWindow = true
                        });
                        if (installProc != null) installProc.WaitForExit();
                    }

                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = "/c npm start",
                        WorkingDirectory = baseDir,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        CreateNoWindow = true
                    });
                    return;
                }

                // 5. Automatic download from GitHub Release
                string tempSetup = Path.Combine(Path.GetTempPath(), "Optimus-Setup.exe");
                string downloadUrl = "https://github.com/KattaHemaVarshini-28/Optimus/releases/download/v0.8.0/Optimus-0.8.0-Setup.exe";

                DialogResult result = MessageBox.Show(
                    "Optimus runtime is not installed on this computer yet.\n\nWould you like to automatically download and install Optimus now?",
                    "Optimus",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information);

                if (result == DialogResult.Yes)
                {
                    ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
                    using (WebClient client = new WebClient())
                    {
                        client.Headers.Add("User-Agent", "OptimusLauncher");
                        client.DownloadFile(downloadUrl, tempSetup);
                    }

                    if (File.Exists(tempSetup))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = tempSetup,
                            UseShellExecute = true
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Error starting Optimus: " + ex.Message, "Optimus Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        static bool IsCommandAvailable(string cmd)
        {
            try
            {
                Process p = new Process();
                p.StartInfo.FileName = "where.exe";
                p.StartInfo.Arguments = cmd;
                p.StartInfo.UseShellExecute = false;
                p.StartInfo.CreateNoWindow = true;
                p.Start();
                p.WaitForExit();
                return p.ExitCode == 0;
            }
            catch { return false; }
        }
    }
}
